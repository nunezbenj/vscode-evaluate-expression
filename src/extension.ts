import * as vscode from "vscode";
import * as path from "path";
import { WebviewToExtension, ExtensionToWebview, WatchItem } from "./types";
import {
    getBestFrameId,
    getLanguageForSessionType,
    evaluateInFrame,
    planPythonSnippet,
    evaluatePythonPlan,
    prepareJavaScriptSnippet,
    refreshVariablesPanel,
    cleanPythonTraceback,
    fetchAnchoredResultRef,
    fetchResultChildren,
} from "./dap";
import { initLog, log, logVerbose, closeLog, showLog, getLogContents, getLogDir, showErrorWithLog } from "./log";
import { EvaluateCodeLensProvider } from "./codelens";

let panel: vscode.WebviewPanel | undefined;
// When our goto-based refresh is about to fire a synthetic stopped event
// while the panel was the active (possibly floating) window, re-assert the
// panel's focus when that event lands — the fixed-delay approach raced the
// event and lost when evaluations were fast.
let revealPanelOnStopUntil = 0;
let evictEditorFromPanelGroupUntil = 0;

/**
 * If the active text editor is a real file sharing the Evaluate panel's
 * view column, move it out to a code group. This handles Step Into
 * revealing a previously-unopened file inside the panel's group —
 * including a detached (floating) panel window, where the group lock does
 * not apply because the floating window is a separate window. The panel
 * itself is a webview, not a text editor, so it is never the target.
 */
function findPanelTabGroup(): vscode.TabGroup | undefined {
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes("evaluateExpression")) {
                return group;
            }
        }
    }
    return undefined;
}

/**
 * Design rule: debugger-revealed files always belong in a code group; the
 * Evaluate panel's group (docked, or the floating HUD window) stays
 * panel-only. Structural check via the Tab Groups API — independent of
 * focus and timing (activeTextEditor is undefined while the panel has
 * focus, which defeated earlier attempts): find the group holding the
 * panel tab; any file tabs in it are moved to a code group and closed
 * there. Idempotent, so it is safe to call repeatedly after a step.
 */
async function evictEditorFromPanelGroup() {
    try {
        if (!panel) {
            return;
        }
        const panelGroup = findPanelTabGroup();
        if (!panelGroup) {
            return;
        }
        const strays = panelGroup.tabs.filter((t) => t.input instanceof vscode.TabInputText);
        logVerbose("panel group tabs", {
            column: panelGroup.viewColumn,
            tabs: panelGroup.tabs.map((t) => t.label),
            strays: strays.length,
        });
        if (strays.length === 0) {
            return;
        }
        const target =
            vscode.window.tabGroups.all.find(
                (g) => g !== panelGroup && g.tabs.some((t) => t.input instanceof vscode.TabInputText)
            )?.viewColumn ?? vscode.ViewColumn.One;
        for (const tab of strays) {
            const uri = (tab.input as vscode.TabInputText).uri;
            log("relocating stray file tab out of panel group", {
                file: uri.fsPath,
                from: panelGroup.viewColumn,
                to: target,
            });
            await vscode.window.showTextDocument(uri, { viewColumn: target, preserveFocus: true, preview: tab.isPreview });
            await vscode.window.tabGroups.close(tab);
        }
        panel.reveal(undefined, false);
    } catch (err: unknown) {
        log("evictEditorFromPanelGroup error", { error: err instanceof Error ? err.message : String(err) });
    }
}

// While an evaluation is running, program output (print etc.) travels as
// DAP "output" events to the Debug Console, not in the evaluate response.
// Capture those events here so the panel can show output next to the
// result (user request: avoid keeping the Debug Console open alongside).
let outputCapture: string[] | null = null;
let lastStoppedThreadId: number | undefined;
let evaluationInFlight = false;
let evaluationCooldownTimer: ReturnType<typeof setTimeout> | undefined;
const EVAL_COOLDOWN_MS = 500;

// Persistent state
let history: string[] = [];
let historyIndex = -1;
let watches: WatchItem[] = [];
let watchIdCounter = 0;

export function activate(context: vscode.ExtensionContext) {
    initLog(context);
    log("activate() called");

    history = context.workspaceState.get<string[]>("evaluate.history", []);
    watches = context.workspaceState.get<WatchItem[]>("evaluate.watches", []);
    watchIdCounter = context.workspaceState.get<number>("evaluate.watchIdCounter", 0);

    context.subscriptions.push(
        vscode.commands.registerCommand("evaluate.openPanel", () => {
            openPanel(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("evaluate.runSelection", () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const rawSelection = editor.document.getText(editor.selection);
            if (!rawSelection) {
                return;
            }
            const selection = dedent(rawSelection);
            openPanel(context);
            sendToWebview({ type: "historyEntry", code: selection, index: -1, total: history.length });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("evaluate.addWatch", () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const selection = editor.document.getText(editor.selection);
            if (!selection) {
                return;
            }
            addWatch(selection, context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("evaluate.refreshWatches", () => {
            refreshAllWatches(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("evaluate.showLog", () => {
            showLog();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("evaluate.openPreviousLogs", async () => {
            const dir = getLogDir();
            if (!dir) {
                vscode.window.showInformationMessage("Log directory unavailable.");
                return;
            }
            const fs = require("fs") as typeof import("fs");
            const path = require("path") as typeof import("path");
            const files = fs
                .readdirSync(dir)
                .filter((f: string) => f.endsWith(".log"))
                .sort()
                .reverse();
            if (files.length === 0) {
                vscode.window.showInformationMessage("No log files yet.");
                return;
            }
            const pick = await vscode.window.showQuickPick(files, {
                placeHolder: "Session log files (newest first — pick an older one for a crashed session)",
            });
            if (pick) {
                const doc = await vscode.workspace.openTextDocument(path.join(dir, pick));
                await vscode.window.showTextDocument(doc, { preview: true });
            }
        }),
        vscode.commands.registerCommand("evaluate.copyDiagnostics", async () => {
            const extVersion =
                vscode.extensions.getExtension("nunezbenj.pycharm-evaluate")?.packageJSON?.version ?? "unknown";
            const cfg = vscode.workspace.getConfiguration("evaluate");
            const session = vscode.debug.activeDebugSession;
            const logTail = getLogContents().split("\n").slice(-400).join("\n");
            const report = [
                "=== Evaluate Expression diagnostic report ===",
                `Extension: ${extVersion}  VS Code: ${vscode.version}  OS: ${process.platform}/${process.arch}`,
                `Remote: ${vscode.env.remoteName ?? "none"}  UI kind: ${vscode.env.uiKind === vscode.UIKind.Web ? "web" : "desktop"}`,
                `Active debug session: ${session ? session.type + " (" + session.name + ")" : "none"}`,
                `Settings: autoRefreshVariables=${cfg.get("autoRefreshVariables")} autoModeSwitch=${cfg.get("autoModeSwitch")} smartPaste=${cfg.get("smartPaste")} verboseLogging=${cfg.get("verboseLogging")} showCodeLens=${cfg.get("showCodeLens")}`,
                `Log directory (persists across reloads): ${getLogDir() ?? "unavailable"}`,
                "",
                "--- last 400 log lines ---",
                logTail,
            ].join("\n");
            await vscode.env.clipboard.writeText(report);
            vscode.window.showInformationMessage(
                "Diagnostic report copied. It includes recently evaluated code and results — review before sharing, then paste into a GitHub issue."
            );
        }),
        vscode.commands.registerCommand("evaluate.copyLog", async () => {
            const contents = getLogContents();
            if (!contents) {
                vscode.window.showInformationMessage("No log data yet.");
                return;
            }
            await vscode.env.clipboard.writeText(contents);
            vscode.window.showInformationMessage(
                "Debug log copied to clipboard. Paste it into a GitHub issue for bug reporting."
            );
        })
    );

    // Track which thread last stopped so getBestFrameId can use it
    context.subscriptions.push(
        vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => {
            if (e.event === "stopped") {
                lastStoppedThreadId = e.body?.threadId;
            }
        })
    );

    // Notify webview when debug state changes; auto-refresh watches on stop
    context.subscriptions.push(
        vscode.debug.onDidChangeActiveDebugSession((session) => {
            log("onDidChangeActiveDebugSession", {
                active: !!session,
                type: session?.type,
                name: session?.name,
                evaluationInFlight,
            });
            sendToWebview({ type: "debugStateChanged", active: !!session });
            if (session) {
                sendToWebview({
                    type: "languageChanged",
                    language: getLanguageForSessionType(session.type),
                });
            } else {
                lastStoppedThreadId = undefined;
            }
        })
    );

    // Use registerDebugAdapterTrackerFactory to catch DAP stopped events
    // that onDidReceiveDebugSessionCustomEvent may miss
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory("*", {
            createDebugAdapterTracker(session) {
                return {
                    onDidSendMessage(message: { type: string; event?: string; body?: { threadId?: number; category?: string; output?: string } }) {
                        if (message.type === "event" && message.event === "continued") {
                            sendToWebview({ type: "debugRunState", state: "running" });
                        }
                        if (
                            message.type === "event" &&
                            message.event === "output" &&
                            outputCapture !== null &&
                            (message.body?.category === "stdout" || message.body?.category === "stderr" || message.body?.category === undefined)
                        ) {
                            outputCapture.push(String(message.body?.output ?? ""));
                        }
                        if (message.type === "event" && message.event === "stopped") {
                            sendToWebview({ type: "debugRunState", state: "stopped" });
                            if (panel) {
                                evictEditorFromPanelGroupUntil = 0;
                                // Any stop can reveal a file into the panel's
                                // group (a detached HUD is its own window, so
                                // the group lock can't protect it), whether the
                                // step came from our panel or the floating
                                // window's own toolbar. Design rule: revealed
                                // files always go to a code group. Structural
                                // check is idempotent; run it at several settle
                                // points to absorb Remote-SSH reveal latency and
                                // a late re-reveal by the debugger.
                                for (const delay of [150, 500, 1200, 2500, 4000]) {
                                    setTimeout(() => evictEditorFromPanelGroup(), delay);
                                }
                            }
                            log("DAP stopped event", { threadId: message.body?.threadId, evaluationInFlight });
                            lastStoppedThreadId = message.body?.threadId;
                            if (!evaluationInFlight) {
                                refreshAllWatches(context);
                            } else {
                                log("Suppressed watch refresh (evaluation in flight)");
                            }
                            if (revealPanelOnStopUntil > Date.now()) {
                                revealPanelOnStopUntil = 0;
                                // VS Code focuses the main window while
                                // processing this event; re-assert the panel
                                // just after, with a second late pass in case
                                // the OS-level focus change lands slowly.
                                for (const delay of [150, 600]) {
                                    setTimeout(() => {
                                        try {
                                            panel?.reveal(undefined, false);
                                        } catch {
                                            // panel disposed — ignore
                                        }
                                    }, delay);
                                }
                            }
                        }
                    },
                };
            },
        })
    );

    const codeLensProvider = new EvaluateCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [
                { language: "python" },
                { language: "javascript" },
                { language: "typescript" },
                { language: "javascriptreact" },
                { language: "typescriptreact" },
                { language: "c" },
                { language: "cpp" },
                { language: "csharp" },
                { language: "go" },
                { language: "rust" },
                { language: "java" },
            ],
            codeLensProvider
        )
    );
}

function openPanel(context: vscode.ExtensionContext) {
    if (panel) {
        panel.reveal(vscode.ViewColumn.Beside);
        return;
    }

    panel = vscode.window.createWebviewPanel(
        "evaluateExpression",
        "Evaluate Expression",
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "media"))],
        }
    );

    panel.webview.html = getWebviewHtml(panel.webview, context.extensionPath);

    // Keep the panel's editor group to itself: a locked group does not
    // receive editors VS Code opens on its own (e.g. the debugger revealing
    // a file on Step Into), so those land in the code group instead of
    // stacking up next to the panel. The panel is the active editor right
    // after creation, so the command targets its group.
    if (vscode.workspace.getConfiguration("evaluate").get<boolean>("lockPanelGroup", true)) {
        vscode.commands.executeCommand("workbench.action.lockEditorGroup").then(undefined, () => undefined);
    }

    panel.webview.onDidReceiveMessage(
        (msg: WebviewToExtension) =>
            handleWebviewMessage(msg, context).catch((err: unknown) => {
                // Our own failures must be loud and captured, not silent:
                // log with stack (persisted to disk) and point the user at
                // the diagnostic report so "it crashed" is always traceable.
                const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
                log("UNHANDLED ERROR in webview message handler", { command: (msg as { command?: string }).command, detail });
                showErrorWithLog(
                    "Evaluate Expression hit an internal error (diagnostics captured — run 'Evaluate: Copy Diagnostic Report')."
                );
            }),
        undefined,
        context.subscriptions
    );

    panel.onDidDispose(() => {
        panel = undefined;
    });

    // Send initial state
    sendToWebview({
        type: "state",
        watches,
        history,
    });

    sendToWebview({
        type: "debugStateChanged",
        active: !!vscode.debug.activeDebugSession,
    });

    const activeSession = vscode.debug.activeDebugSession;
    if (activeSession) {
        sendToWebview({
            type: "languageChanged",
            language: getLanguageForSessionType(activeSession.type),
        });
    }
}

async function handleWebviewMessage(msg: WebviewToExtension, context: vscode.ExtensionContext) {
    switch (msg.command) {
        case "debugAction": {
            const actionMap: Record<string, string> = {
                continue: "workbench.action.debug.continue",
                pause: "workbench.action.debug.pause",
                stepOver: "workbench.action.debug.stepOver",
                stepInto: "workbench.action.debug.stepInto",
                stepOut: "workbench.action.debug.stepOut",
            };
            const cmd = actionMap[msg.action];
            if (cmd && vscode.debug.activeDebugSession) {
                log("debugAction", { action: msg.action, panelActive: panel?.active });
                // A step that lands in a file that isn't open makes VS Code
                // open and focus it — right for the main window, but it
                // pulls the user out of a floating HUD. If the action came
                // from the focused panel, bring focus back once the stop
                // settles (same mechanism as the evaluate refresh). Steps
                // land fast; Continue may run a long time, so its window is
                // short to avoid surprising focus grabs later.
                if (panel?.active && msg.action !== "pause") {
                    revealPanelOnStopUntil = Date.now() + (msg.action === "continue" ? 3000 : 5000);
                    // Step Into may reveal a new file into the panel's group;
                    // arm eviction for steps (not continue, which rarely
                    // reveals and may run long).
                    if (msg.action !== "continue") {
                        evictEditorFromPanelGroupUntil = Date.now() + 5000;
                    }
                }
                await vscode.commands.executeCommand(cmd);
            }
            break;
        }
        case "getResultChildren": {
            try {
                const session = vscode.debug.activeDebugSession;
                if (!session) {
                    throw new Error("No active debug session");
                }
                const children = await fetchResultChildren(session, msg.ref, msg.start, msg.count);
                sendToWebview({ type: "resultChildren", requestId: msg.requestId, ref: msg.ref, children });
            } catch {
                sendToWebview({ type: "resultChildren", requestId: msg.requestId, ref: msg.ref, error: "stale" });
            }
            break;
        }
        case "evaluate": {
            const session = vscode.debug.activeDebugSession;
            if (!session) {
                const errMsg = "No active debug session. Start debugging and pause at a breakpoint first.";
                showErrorWithLog(errMsg);
                sendToWebview({
                    type: "evaluateError",
                    requestId: msg.requestId,
                    error: errMsg,
                });
                return;
            }

            log("evaluate START", { requestId: msg.requestId, mode: msg.mode, codeLen: msg.code.length });
            logVerbose("evaluate code", { code: msg.code });
            evaluationInFlight = true;
            if (evaluationCooldownTimer) {
                clearTimeout(evaluationCooldownTimer);
            }

            try {
                const frameId = await getBestFrameId(session, lastStoppedThreadId);
                log("evaluate frameId resolved", { frameId, lastStoppedThreadId });
                const lang = getLanguageForSessionType(session.type);
                outputCapture = [];
                let evalResult;
                if (lang === "python") {
                    const plan = planPythonSnippet(msg.code);
                    log("evaluate python plan", { kind: plan.kind, mode: msg.mode, hasTail: plan.tail !== undefined });
                    evalResult = await evaluatePythonPlan(session, plan, frameId);
                } else if (msg.mode === "statements" && lang === "javascript") {
                    const prepared = prepareJavaScriptSnippet(msg.code);
                    logVerbose("evaluate prepared js", { prepared });
                    evalResult = await evaluateInFrame(session, prepared, frameId);
                } else {
                    evalResult = await evaluateInFrame(session, msg.code, frameId);
                }
                // Give trailing output events a brief moment to arrive,
                // then stop capturing before watch/refresh activity starts.
                await new Promise((resolve) => setTimeout(resolve, 120));
                const capturedOutput = (evalResult?.output ?? "") + (outputCapture ?? []).join("");
                outputCapture = null;
                log("evaluate DAP result", { evalResult, capturedOutputLen: capturedOutput.length });

                // Program state may have changed — force VS Code to refetch
                // the Variables panel (no extension API exists; see
                // refreshVariablesPanel). Watches are refreshed manually
                // afterwards because the synthetic stopped event arrives
                // while evaluationInFlight suppresses the automatic path.
                const autoRefresh = vscode.workspace
                    .getConfiguration("evaluate")
                    .get<boolean>("autoRefreshVariables", true);
                let resultNode: import("./dap").ResultNodeInfo | null = null;
                if (!evalResult.error && autoRefresh) {
                    // The synthetic stopped event makes VS Code focus the
                    // main workbench window (debug.focusWindowOnBreak), which
                    // sends a floating Evaluate window to the background. If
                    // the panel was active when the user evaluated, give it
                    // focus back once the stop has been processed.
                    const panelWasActive = panel?.active === true;
                    if (panelWasActive) {
                        // Arm before the goto so the stopped event can't win
                        // the race; the tracker clears it on arrival.
                        revealPanelOnStopUntil = Date.now() + 3000;
                    }
                    const refreshed = await refreshVariablesPanel(session, lastStoppedThreadId);
                    if (!refreshed) {
                        revealPanelOnStopUntil = 0;
                    } else {
                        setTimeout(() => refreshAllWatches(context), 150);
                    }
                    if (evalResult.anchored) {
                        // References die at the goto's stop; re-resolve the
                        // frame and fetch a fresh reference to the anchored
                        // result so the tree is expandable after refresh.
                        const freshFrameId = refreshed
                            ? await getBestFrameId(session, lastStoppedThreadId)
                            : frameId;
                        if (freshFrameId !== undefined) {
                            resultNode = await fetchAnchoredResultRef(session, freshFrameId);
                        }
                    }
                } else if (!evalResult.error && evalResult.anchored && frameId !== undefined) {
                    resultNode = await fetchAnchoredResultRef(session, frameId);
                }

                // Save to history
                if (!history.includes(msg.code)) {
                    history.push(msg.code);
                    if (history.length > 100) {
                        history.shift();
                    }
                    context.workspaceState.update("evaluate.history", history);
                }
                historyIndex = -1;

                if (evalResult.error) {
                    log("evaluate raw error", { requestId: msg.requestId, error: evalResult.error });
                    let errorText = cleanPythonTraceback(evalResult.error);
                    if (msg.mode === "expression" && msg.code.includes("\n")) {
                        errorText += "\n\nHint: multi-line code usually needs Statements mode (toggle above the editor).";
                    }
                    log("evaluate sending ERROR to webview", { requestId: msg.requestId, error: errorText });
                    sendToWebview({
                        type: "evaluateError",
                        requestId: msg.requestId,
                        error: errorText,
                        output: capturedOutput,
                    });
                } else {
                    log("evaluate sending RESULT to webview", { requestId: msg.requestId, result: evalResult.result });
                    sendToWebview({
                        type: "evaluateResult",
                        output: capturedOutput,
                        node: resultNode ?? undefined,
                        requestId: msg.requestId,
                        result: evalResult.result ?? "",
                    });
                }
            } finally {
                log("evaluate DONE, starting cooldown");
                evaluationCooldownTimer = setTimeout(() => {
                    evaluationInFlight = false;
                    log("evaluate cooldown expired, evaluationInFlight=false");
                }, EVAL_COOLDOWN_MS);
            }
            break;
        }

        case "addWatch": {
            addWatch(msg.expression, context);
            break;
        }

        case "removeWatch": {
            watches = watches.filter((w) => w.id !== msg.id);
            context.workspaceState.update("evaluate.watches", watches);
            sendToWebview({ type: "watchesUpdated", watches });
            break;
        }

        case "refreshWatches": {
            await refreshAllWatches(context);
            break;
        }

        case "historyPrev": {
            if (history.length === 0) {
                return;
            }
            if (historyIndex === -1) {
                historyIndex = history.length - 1;
            } else if (historyIndex > 0) {
                historyIndex--;
            }
            sendToWebview({
                type: "historyEntry",
                code: history[historyIndex],
                index: historyIndex,
                total: history.length,
            });
            break;
        }

        case "historyNext": {
            if (history.length === 0 || historyIndex === -1) {
                return;
            }
            if (historyIndex < history.length - 1) {
                historyIndex++;
                sendToWebview({
                    type: "historyEntry",
                    code: history[historyIndex],
                    index: historyIndex,
                    total: history.length,
                });
            } else {
                historyIndex = -1;
                sendToWebview({
                    type: "historyEntry",
                    code: "",
                    index: -1,
                    total: history.length,
                });
            }
            break;
        }

        case "modeChanged": {
            context.workspaceState.update("evaluate.lastMode", msg.mode);
            break;
        }

        case "contentChanged": {
            context.workspaceState.update("evaluate.lastCode", msg.code);
            break;
        }

        case "getState": {
            const lastMode = context.workspaceState.get<string>("evaluate.lastMode");
            const lastCode = context.workspaceState.get<string>("evaluate.lastCode");
            const cfg = vscode.workspace.getConfiguration("evaluate");
            sendToWebview({
                type: "state",
                watches,
                history,
                lastMode: lastMode as import("./types").EvalMode | undefined,
                lastCode: lastCode,
                settings: {
                    autoModeSwitch: cfg.get<boolean>("autoModeSwitch", true),
                    smartPaste: cfg.get<boolean>("smartPaste", true),
                },
            });
            sendToWebview({
                type: "debugStateChanged",
                active: !!vscode.debug.activeDebugSession,
            });
            const currentSession = vscode.debug.activeDebugSession;
            if (currentSession) {
                sendToWebview({
                    type: "languageChanged",
                    language: getLanguageForSessionType(currentSession.type),
                });
            }
            break;
        }
    }
}

function addWatch(expression: string, context: vscode.ExtensionContext) {
    const id = `watch_${++watchIdCounter}`;
    watches.push({ id, expression });
    context.workspaceState.update("evaluate.watches", watches);
    context.workspaceState.update("evaluate.watchIdCounter", watchIdCounter);
    sendToWebview({ type: "watchesUpdated", watches });
    refreshSingleWatch(watches[watches.length - 1], context);
}

async function refreshAllWatches(context: vscode.ExtensionContext) {
    const session = vscode.debug.activeDebugSession;
    if (!session || watches.length === 0) {
        return;
    }

    const frameId = await getBestFrameId(session, lastStoppedThreadId);

    for (const watch of watches) {
        const evalResult = await evaluateInFrame(session, watch.expression, frameId);
        watch.result = evalResult.result;
        watch.error = evalResult.error;
    }

    context.workspaceState.update("evaluate.watches", watches);
    sendToWebview({ type: "watchesUpdated", watches });
}

async function refreshSingleWatch(watch: WatchItem, _context: vscode.ExtensionContext) {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
        return;
    }

    const frameId = await getBestFrameId(session, lastStoppedThreadId);
    const evalResult = await evaluateInFrame(session, watch.expression, frameId);
    watch.result = evalResult.result;
    watch.error = evalResult.error;

    sendToWebview({ type: "watchesUpdated", watches });
}


function sendToWebview(msg: ExtensionToWebview) {
    log("sendToWebview", { type: msg.type });
    panel?.webview.postMessage(msg);
}

function getWebviewHtml(webview: vscode.Webview, extensionPath: string): string {
    const mediaPath = path.join(extensionPath, "media");
    const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(mediaPath, "panel.css")));
    const jsUri = webview.asWebviewUri(vscode.Uri.file(path.join(mediaPath, "panel.js")));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${cssUri}">
    <title>Evaluate Expression</title>
</head>
<body>
    <div class="container">
        <div class="toolbar">
            <span class="title">Evaluate Expression</span>
            <span class="debug-status" id="debugStatus">No debug session</span>
        </div>

        <div class="editor-section">
            <div class="mode-bar">
                <label>
                    <input type="radio" name="mode" value="statements" checked>
                    Statements
                </label>
                <label>
                    <input type="radio" name="mode" value="expression">
                    Expression
                </label>
                <span class="history-info" id="historyInfo"></span>
                <span class="step-bar" id="stepBar">
                    <button id="btnContinue" class="step-btn" title="Continue (F5)">&#9205;</button>
                    <button id="btnPause" class="step-btn" title="Pause" hidden>&#9208;</button>
                    <button id="btnStepOver" class="step-btn" title="Step Over (F10)">&#8631;</button>
                    <button id="btnStepInto" class="step-btn" title="Step Into (F11)">&#8595;</button>
                    <button id="btnStepOut" class="step-btn" title="Step Out (Shift+F11)">&#8593;</button>
                </span>
            </div>
            <div id="codeInput" class="code-editor"></div>
            <div class="button-bar">
                <button id="btnEvaluate" class="primary">Evaluate</button>
                <button id="btnHistoryPrev" title="Previous (Up)">&#9650;</button>
                <button id="btnHistoryNext" title="Next (Down)">&#9660;</button>
                <button id="btnCopy" title="Copy Result">Copy</button>
                <button id="btnClearCode" title="Clear the code editor">Clear Code</button>
                <button id="btnClear" title="Clear the Result output">Clear Result</button>
            </div>
        </div>

        <div id="splitter" class="splitter" title="Drag to resize code/result areas — double-click to reset"></div>

        <div class="result-section">
            <div class="section-header">Result</div>
            <pre id="resultOutput" class="result-output"></pre>
        </div>

        <div class="watches-section">
            <div class="section-header">
                Watches
                <button id="btnAddWatch" title="Add watch from code input">+ Add</button>
                <button id="btnRefreshWatches" title="Refresh all watches">Refresh</button>
            </div>
            <div id="watchesList" class="watches-list"></div>
        </div>
    </div>
    <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}

export function dedent(code: string): string {
    const normalized = code.replace(/\t/g, "    ");
    const lines = normalized.split("\n");
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    if (nonEmptyLines.length === 0) {
        return normalized;
    }
    const minIndent = Math.min(...nonEmptyLines.map((l) => l.match(/^\s*/)![0].length));
    if (minIndent === 0) {
        return normalized;
    }
    return lines.map((l) => l.slice(minIndent)).join("\n");
}

export function deactivate() {
    log("deactivate() called");
    closeLog();
    panel?.dispose();
}
