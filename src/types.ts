export type EvalMode = "expression" | "statements";

// Webview -> Extension messages
export type WebviewToExtension =
    | { command: "evaluate"; code: string; mode: EvalMode; requestId: string }
    | { command: "addWatch"; expression: string }
    | { command: "removeWatch"; id: string }
    | { command: "refreshWatches" }
    | { command: "historyPrev" }
    | { command: "historyNext" }
    | { command: "getState" };

// Extension -> Webview messages
export type ExtensionToWebview =
    | { type: "evaluateResult"; requestId: string; result: string }
    | { type: "evaluateError"; requestId: string; error: string }
    | { type: "watchesUpdated"; watches: WatchItem[] }
    | { type: "historyEntry"; code: string; index: number; total: number }
    | { type: "debugStateChanged"; active: boolean }
    | { type: "state"; watches: WatchItem[]; history: string[] };

export interface WatchItem {
    id: string;
    expression: string;
    result?: string;
    error?: string;
}
