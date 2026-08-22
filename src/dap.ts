import * as vscode from "vscode";
import { EvalMode } from "./types";
import { log, logVerbose } from "./log";

/**
 * Best-effort frame resolution. Prefers the cached stopped thread if
 * available, otherwise falls back to the first thread returned by DAP.
 * Returns undefined when no usable frame can be found.
 */
export async function getBestFrameId(
    session: vscode.DebugSession,
    lastStoppedThreadId?: number
): Promise<number | undefined> {
    let threadId = lastStoppedThreadId;

    if (threadId === undefined) {
        const threadsResp = await session.customRequest("threads");
        const threads: { id: number; name: string }[] = threadsResp?.threads ?? [];
        if (threads.length === 0) {
            return undefined;
        }
        threadId = threads[0].id;
    }

    try {
        const stackResp = await session.customRequest("stackTrace", {
            threadId,
            levels: 1,
        });
        const frames: { id: number }[] = stackResp?.stackFrames ?? [];
        return frames.length > 0 ? frames[0].id : undefined;
    } catch {
        return undefined;
    }
}

const PYTHON_SESSION_TYPES = ["python", "debugpy"];
const JS_SESSION_TYPES = ["node", "node2", "pwa-node", "pwa-chrome", "chrome", "pwa-msedge", "msedge"];

/**
 * Maps a DAP session type to a CodeMirror language name.
 */
export function getLanguageForSessionType(sessionType: string): string {
    if (PYTHON_SESSION_TYPES.includes(sessionType)) {
        return "python";
    }
    if (JS_SESSION_TYPES.includes(sessionType)) {
        return "javascript";
    }
    if (sessionType === "cppdbg" || sessionType === "cppvsdbg") {
        return "cpp";
    }
    return "python";
}

/**
 * Wraps code for evaluation via DAP, dispatching to a language-specific
 * wrapper based on the debug session type. In "expression" mode the
 * code is always returned as-is regardless of language.
 */
export function wrapSnippet(code: string, mode: EvalMode, sessionType: string): string {
    if (mode === "expression") {
        return code;
    }

    const lang = getLanguageForSessionType(sessionType);
    switch (lang) {
        case "python":
            return wrapPythonSnippet(code);
        case "javascript":
            return wrapJavaScriptSnippet(code);
        default:
            return code;
    }
}

/**
 * Execution plan for Python statements mode.
 *
 * "direct" is the preferred strategy: the statements are sent to debugpy's
 * repl context unwrapped. debugpy execs them against a merged copy of the
 * frame's globals+locals and writes the changes back into the real frame
 * (pydevd's update_globals_and_locals / save_locals), so NEW variables
 * persist in the paused frame — not just mutations to existing objects.
 * If the snippet ends with a bare expression, it is split off as `tail`
 * and evaluated separately so its value can be shown (PyCharm behavior).
 *
 * "wrapper" is a legacy fallback used only when the snippet uses `return`
 * for flow control in a way that is not valid at module level. It wraps
 * the code in a function, which supports `return` but cannot persist new
 * locals into the frame.
 */
export interface PythonEvalPlan {
    kind: "direct" | "wrapper";
    /** direct: statements to exec (may be empty if the snippet is a single expression) */
    body?: string;
    /** direct: trailing bare expression whose value should be shown */
    tail?: string;
    /** wrapper: fully wrapped legacy snippet */
    wrapped?: string;
}

function bracketsBalanced(code: string): boolean {
    // Heuristic: ignores brackets inside string literals. A wrong answer
    // only means we skip the tail-expression split, which is safe.
    let depth = 0;
    for (const ch of code) {
        if (ch === "(" || ch === "[" || ch === "{") { depth++; }
        else if (ch === ")" || ch === "]" || ch === "}") { depth--; }
    }
    return depth === 0;
}

/**
 * Analyzes a Python statements-mode snippet and decides how to execute it.
 */
export function planPythonSnippet(code: string): PythonEvalPlan {
    const normalized = normalizeWhitespace(code);
    const dedented = dedentCode(normalized);
    const lines = dedented.split("\n");
    const lastIdx = findLastNonEmptyLineIndex(lines);
    if (lastIdx < 0) {
        return { kind: "direct", body: "" };
    }

    const topLevelReturns = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /^return\b/.test(l))
        .map(({ i }) => i);
    const hasIndentedReturn = lines.some((l) => /^\s+return\b/.test(l));
    const definesFunction = lines.some((l) => /^\s*(def |async def |class )|lambda/.test(l));

    // `return` used for flow control (early return inside an if/for, or an
    // indented return outside any user-defined function) cannot run at
    // module level → fall back to the legacy function wrapper.
    const midBlockTopLevelReturn = topLevelReturns.some((i) => i !== lastIdx);
    if (midBlockTopLevelReturn || (hasIndentedReturn && !definesFunction)) {
        return { kind: "wrapper", wrapped: wrapPythonSnippet(code) };
    }

    const lastLine = lines[lastIdx];
    const lastAtTopLevel = lastLine.match(/^\s*/)![0].length === 0;
    const bodyBefore = lines.slice(0, lastIdx).join("\n");
    const prevEndsWithContinuation = /\\\s*$/.test(bodyBefore.trimEnd());
    const canSplit = lastAtTopLevel && bracketsBalanced(bodyBefore) && !prevEndsWithContinuation;

    // Trailing `return <expr>` at top level: treat as "show me this value".
    if (topLevelReturns.length === 1 && topLevelReturns[0] === lastIdx) {
        const tail = lastLine.replace(/^return\b\s*/, "");
        if (!canSplit) {
            return { kind: "wrapper", wrapped: wrapPythonSnippet(code) };
        }
        return { kind: "direct", body: bodyBefore, tail: tail.length > 0 ? tail : undefined };
    }

    if (canSplit && looksLikeBareExpression(lastLine)) {
        return { kind: "direct", body: bodyBefore, tail: lastLine };
    }

    return { kind: "direct", body: lines.join("\n") };
}

/**
 * Prepares JavaScript statements-mode code. Raw code sent to the debugger
 * behaves like the DevTools console: the completion value of the last
 * statement is returned, and declarations persist as far as V8 allows.
 * Only code that uses a top-level `return` (with no function of its own)
 * needs the legacy IIFE wrapper.
 */
export function prepareJavaScriptSnippet(code: string): string {
    const normalized = normalizeWhitespace(code);
    const hasReturn = normalized.split("\n").some((l) => /^return\b/.test(l.trimStart()));
    const definesFunction = /function\b|=>/.test(normalized);
    if (hasReturn && !definesFunction) {
        return wrapJavaScriptSnippet(code);
    }
    return normalized;
}

/**
 * Wraps multi-line Python code in a function so statements work inside
 * debugpy's evaluate/repl context. The wrapper defines a function, calls
 * it, and stores the result so mutations to existing objects in the
 * paused frame work correctly. (Legacy path — see PythonEvalPlan.)
 */
export function wrapPythonSnippet(code: string): string {
    const normalized = normalizeWhitespace(code);
    const dedented = dedentCode(normalized);
    const lines = dedented.split("\n");

    const lastIdx = findLastNonEmptyLineIndex(lines);
    if (lastIdx >= 0 && looksLikeBareExpression(lines[lastIdx])) {
        const leadingSpaces = lines[lastIdx].match(/^\s*/)![0].length;
        if (leadingSpaces === 0) {
            lines[lastIdx] = "return " + lines[lastIdx];
        }
    }

    const indented = lines.map((line) => "    " + line).join("\n");

    return `def __eval__():\n${indented}\n__eval_result__ = __eval__()`;
}

/**
 * Wraps multi-line JavaScript/TypeScript code in an IIFE so statements
 * produce a return value in Node.js / Chrome debuggers.
 */
export function wrapJavaScriptSnippet(code: string): string {
    const normalized = normalizeWhitespace(code);
    const lines = normalized.split("\n");

    const lastIdx = findLastNonEmptyLineIndex(lines);
    if (lastIdx >= 0) {
        const trimmed = lines[lastIdx].trimStart();
        const isStatement = /^(var |let |const |if |for |while |switch |try |throw |return |class |function |import |export )/.test(trimmed);
        if (!isStatement && !/[;{}]\s*$/.test(trimmed)) {
            lines[lastIdx] = lines[lastIdx].replace(trimmed, "return " + trimmed);
        }
    }

    return `(() => {\n${lines.join("\n")}\n})()`;
}

export function normalizeWhitespace(code: string): string {
    return code
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\t/g, "    ")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n");
}

export function dedentCode(code: string): string {
    const lines = code.split("\n");
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    if (nonEmptyLines.length === 0) {
        return code;
    }
    const minIndent = Math.min(...nonEmptyLines.map((l) => l.match(/^\s*/)![0].length));
    if (minIndent === 0) {
        return code;
    }
    return lines.map((l) => l.slice(minIndent)).join("\n");
}

export function findLastNonEmptyLineIndex(lines: string[]): number {
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().length > 0) {
            return i;
        }
    }
    return -1;
}

const STATEMENT_PREFIXES = [
    "return ", "return\t", "import ", "from ", "class ", "def ",
    "if ", "else:", "elif ", "for ", "while ", "try:", "except ",
    "except:", "finally:", "with ", "raise ", "pass", "break",
    "continue", "del ", "assert ", "yield ", "async ", "await ",
    "global ", "nonlocal ", "print(", "print (",
];

export function looksLikeBareExpression(line: string): boolean {
    const trimmed = line.trimStart();
    if (trimmed.length === 0) {
        return false;
    }
    if (/^[^=!<>]*[^=!<>]=[^=]/.test(trimmed)) {
        return false;
    }
    if (/[+\-*/%&|^]=/.test(trimmed)) {
        return false;
    }
    for (const prefix of STATEMENT_PREFIXES) {
        if (trimmed.startsWith(prefix) || trimmed === prefix.trimEnd()) {
            return false;
        }
    }
    return true;
}

export interface EvalResult {
    result?: string;
    error?: string;
}

function formatExecResult(result: string | undefined): string {
    if (result === undefined || result === "" || result === "None") {
        return "(executed successfully)";
    }
    return result;
}

/**
 * Executes a Python statements-mode plan.
 *
 * Direct plans exec the body in debugpy's repl context (new locals persist
 * in the paused frame via pydevd's save_locals), then evaluate the trailing
 * expression — also in repl context, so its side effects persist too — and
 * report its value.
 */
export async function evaluatePythonPlan(
    session: vscode.DebugSession,
    plan: PythonEvalPlan,
    frameId?: number
): Promise<EvalResult> {
    if (frameId === undefined) {
        return { error: "No stack frame available. Pause at a breakpoint." };
    }

    if (plan.kind === "wrapper") {
        log("evaluatePythonPlan: legacy wrapper path");
        return evaluateInFrame(session, plan.wrapped!, frameId, true);
    }

    try {
        let bodyResult: string | undefined;
        const body = (plan.body ?? "").trim().length > 0 ? plan.body! : undefined;
        if (body) {
            log("evaluatePythonPlan: exec body", { bodyLen: body.length, hasTail: !!plan.tail });
            logVerbose("evaluatePythonPlan: body", { body });
            const resp = await session.customRequest("evaluate", {
                expression: body,
                frameId,
                context: "repl",
            });
            bodyResult = resp?.result;
        }

        if (plan.tail !== undefined && plan.tail.trim().length > 0) {
            log("evaluatePythonPlan: eval tail", { tail: plan.tail });
            const tailResp = await session.customRequest("evaluate", {
                expression: plan.tail,
                frameId,
                context: "repl",
            });
            return { result: formatExecResult(tailResp?.result) };
        }

        return { result: formatExecResult(bodyResult) };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: msg };
    }
}

// Sessions where the goto-based refresh has been observed to fail; skip
// them instead of retrying on every evaluation.
const gotoRefreshUnsupported = new Set<string>();

const INTERNAL_FRAME_RE = /[\\/](_pydevd_bundle|pydevd|_vendored|debugpy)[\\/]|[\\/]pydevd\.py/;

/**
 * Strips debug-adapter-internal frames from a Python traceback so the
 * panel shows only the user's code and the actual exception, PyCharm
 * style. The unfiltered text should still be written to the debug log.
 * Non-traceback errors are returned unchanged.
 */
export function cleanPythonTraceback(errorText: string): string {
    if (!errorText.includes("Traceback (most recent call last):")) {
        return errorText;
    }

    const lines = errorText.split("\n");
    const out: string[] = [];
    let skippingFrame = false;
    let droppedFrames = 0;

    for (const line of lines) {
        if (/^\s*File "/.test(line)) {
            skippingFrame = INTERNAL_FRAME_RE.test(line);
            if (skippingFrame) {
                droppedFrames++;
                continue;
            }
            out.push(line);
            continue;
        }
        // Continuation lines of a frame: source line and ^^^ markers
        if (skippingFrame && (/^\s+\S/.test(line) || /^\s*[\^~\s]+$/.test(line))) {
            continue;
        }
        skippingFrame = false;
        out.push(line);
    }

    let cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();

    // If every frame was internal, drop the now-empty traceback header
    // and keep just the exception itself.
    cleaned = cleaned.replace(/Traceback \(most recent call last\):\s*\n(?=\S)(?!\s*File)/g, "");
    if (droppedFrames > 0) {
        cleaned += `\n\n(${droppedFrames} debugger-internal frame${droppedFrames === 1 ? "" : "s"} hidden — full traceback in the debug log)`;
    }
    return cleaned.trim();
}

/**
 * Forces VS Code to refetch the Variables panel (and watches/call stack)
 * after an evaluation mutated program state.
 *
 * VS Code offers no extension API for this: its variables view only
 * refetches on UI-initiated repl input, UI-initiated setVariable, or DAP
 * events (`stopped`/`invalidated`) that only the adapter can emit. The one
 * adapter-side mechanism an extension can trigger is a `gotoTargets` →
 * `goto` round-trip targeting the exact line we are already paused on
 * (Set Next Statement to the current line). Execution does not move, but
 * the adapter emits a real `stopped` event (reason "goto") and VS Code
 * refreshes everything. debugpy supports this; adapters that don't are
 * detected once and skipped thereafter.
 *
 * Returns true if the refresh round-trip was issued.
 */
export async function refreshVariablesPanel(
    session: vscode.DebugSession,
    lastStoppedThreadId?: number
): Promise<boolean> {
    if (gotoRefreshUnsupported.has(session.id)) {
        return false;
    }

    try {
        let threadId = lastStoppedThreadId;
        if (threadId === undefined) {
            const threadsResp = await session.customRequest("threads");
            const threads: { id: number }[] = threadsResp?.threads ?? [];
            if (threads.length === 0) {
                return false;
            }
            threadId = threads[0].id;
        }

        const stackResp = await session.customRequest("stackTrace", { threadId, levels: 1 });
        const frame = stackResp?.stackFrames?.[0];
        if (!frame || !frame.source || typeof frame.line !== "number") {
            return false;
        }

        const targetsResp = await session.customRequest("gotoTargets", {
            source: frame.source,
            line: frame.line,
        });
        const targets: { id: number; line: number }[] = targetsResp?.targets ?? [];
        const target = targets.find((t) => t.line === frame.line);
        if (!target) {
            log("refreshVariablesPanel: no goto target for current line", { line: frame.line });
            return false;
        }

        await session.customRequest("goto", { threadId, targetId: target.id });
        log("refreshVariablesPanel: goto round-trip issued", { threadId, line: frame.line });
        return true;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log("refreshVariablesPanel: unsupported for this session, disabling", { error: msg });
        gotoRefreshUnsupported.add(session.id);
        return false;
    }
}

/**
 * Evaluates code in the given debug frame.
 *
 * For statement mode (isStatementMode=true), sends the multi-line
 * wrapper directly to DAP's REPL context (no exec()), then does a
 * second request to retrieve __eval_result__. This ensures mutations
 * to frame-local variables (like foo.index = 4) take effect in the
 * actual paused frame rather than in exec()'s copy of locals.
 */
export async function evaluateInFrame(
    session: vscode.DebugSession,
    expression: string,
    frameId?: number,
    isStatementMode: boolean = false
): Promise<EvalResult> {
    if (frameId === undefined) {
        return { error: "No stack frame available. Pause at a breakpoint." };
    }

    try {
        log("evaluateInFrame: sending to DAP", { expressionLen: expression.length, isStatementMode });
        logVerbose("evaluateInFrame: full expression", { expression });

        const resp = await session.customRequest("evaluate", {
            expression,
            frameId,
            context: "repl",
        });

        log("evaluateInFrame: DAP response", { result: resp.result, variablesReference: resp.variablesReference });
        logVerbose("evaluateInFrame: full DAP response", resp);

        if (isStatementMode) {
            // Step 2: retrieve the result stored by the wrapper
            try {
                const resultResp = await session.customRequest("evaluate", {
                    expression: "__eval_result__",
                    frameId,
                    context: "watch",
                });
                log("evaluateInFrame: step2 __eval_result__", { result: resultResp.result });
                logVerbose("evaluateInFrame: step2 full response", resultResp);

                // Clean up
                try {
                    await session.customRequest("evaluate", {
                        expression: "del __eval__, __eval_result__",
                        frameId,
                        context: "repl",
                    });
                } catch { /* best effort cleanup */ }

                const resultStr = resultResp.result ?? "";
                if (resultStr === "None" || resultStr === "") {
                    return { result: "(executed successfully)" };
                }
                return { result: resultStr };
            } catch {
                // __eval_result__ doesn't exist — try cleanup and report success
                try {
                    await session.customRequest("evaluate", {
                        expression: "del __eval__",
                        frameId,
                        context: "repl",
                    });
                } catch { /* best effort */ }

                return { result: "(executed successfully)" };
            }
        }

        return { result: resp.result ?? String(resp) };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: msg };
    }
}
