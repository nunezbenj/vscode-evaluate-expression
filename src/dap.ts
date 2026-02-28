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

/**
 * Wraps multi-line Python code in a function so statements (including
 * `return`) work inside debugpy's evaluate/repl context.
 *
 * In "expression" mode the code is returned as-is.
 *
 * Scoping note: new locals created inside the wrapper do NOT become
 * locals in the paused frame. Mutations to existing objects (e.g.
 * `self.next = None`) work well and are the primary use case.
 */
/**
 * Returns the code to send to DAP for statement mode.
 * The wrapper defines a function, calls it, and stores the result.
 * This is sent directly (not via exec()) so mutations to locals
 * in the paused frame work correctly.
 */
export function wrapPythonSnippet(code: string, mode: EvalMode): string {
    if (mode === "expression") {
        return code;
    }

    const lines = code.split("\n");

    const lastIdx = findLastNonEmptyLineIndex(lines);
    if (lastIdx >= 0 && looksLikeBareExpression(lines[lastIdx])) {
        lines[lastIdx] = "return " + lines[lastIdx].trimStart();
    }

    const indented = lines.map((line) => "    " + line).join("\n");

    return `def __eval__():\n${indented}\n__eval_result__ = __eval__()`;
}

function findLastNonEmptyLineIndex(lines: string[]): number {
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

function looksLikeBareExpression(line: string): boolean {
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
