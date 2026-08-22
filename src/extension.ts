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
} from "./dap";
import { initLog, log, logVerbose, closeLog, showLog, getLogContents, showErrorWithLog } from "./log";
import { EvaluateCodeLensProvider } from "./codelens";

let panel: vscode.WebviewPanel | undefined;
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
    initLog();
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
                    onDidSendMessage(message: { type: string; event?: string; body?: { threadId?: number } }) {
                        if (message.type === "event" && message.event === "stopped") {
                            log("DAP stopped event", { threadId: message.body?.threadId, evaluationInFlight });
                            lastStoppedThreadId = message.body?.threadId;
                            if (!evaluationInFlight) {
                                refreshAllWatches(context);
                            } else {
                                log("Suppressed watch refresh (evaluation in flight)");
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

    panel.webview.onDidReceiveMessage(
        (msg: WebviewToExtension) => handleWebviewMessage(msg, context),
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
                let evalResult;
                if (msg.mode === "statements" && lang === "python") {
                    const plan = planPythonSnippet(msg.code);
                    log("evaluate python plan", { kind: plan.kind, hasTail: plan.tail !== undefined });
                    evalResult = await evaluatePythonPlan(session, plan, frameId);
                } else if (msg.mode === "statements" && lang === "javascript") {
                    const prepared = prepareJavaScriptSnippet(msg.code);
                    logVerbose("evaluate prepared js", { prepared });
                    evalResult = await evaluateInFrame(session, prepared, frameId);
                } else {
                    evalResult = await evaluateInFrame(session, msg.code, frameId);
                }
                log("evaluate DAP result", { evalResult });

                // Program state may have changed — force VS Code to refetch
                // the Variables panel (no extension API exists; see
                // refreshVariablesPanel). Watches are refreshed manually
                // afterwards because the synthetic stopped event arrives
                // while evaluationInFlight suppresses the automatic path.
                const autoRefresh = vscode.workspace
                    .getConfiguration("evaluate")
                    .get<boolean>("autoRefreshVariables", true);
                if (!evalResult.error && autoRefresh) {
                    const refreshed = await refreshVariablesPanel(session, lastStoppedThreadId);
                    if (refreshed) {
                        setTimeout(() => refreshAllWatches(context), 150);
                    }
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
                    log("evaluate sending ERROR to webview", { requestId: msg.requestId, error: evalResult.error });
                    sendToWebview({
                        type: "evaluateError",
                        requestId: msg.requestId,
                        error: evalResult.error,
                    });
                } else {
                    log("evaluate sending RESULT to webview", { requestId: msg.requestId, result: evalResult.result });
                    sendToWebview({
                        type: "evaluateResult",
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
            sendToWebview({
                type: "state",
                watches,
                history,
                lastMode: lastMode as import("./types").EvalMode | undefined,
                lastCode: lastCode,
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
            </div>
            <div id="codeInput" class="code-editor"></div>
            <div class="button-bar">
                <button id="btnEvaluate" class="primary">Evaluate</button>
                <button id="btnHistoryPrev" title="Previous (Up)">&#9650;</button>
                <button id="btnHistoryNext" title="Next (Down)">&#9660;</button>
                <button id="btnCopy" title="Copy Result">Copy</button>
                <button id="btnClear" title="Clear Output">Clear</button>
            </div>
        </div>

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
