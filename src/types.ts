export type EvalMode = "expression" | "statements";

// Webview -> Extension messages
export type WebviewToExtension =
    | { command: "evaluate"; code: string; mode: EvalMode; requestId: string }
    | { command: "addWatch"; expression: string }
    | { command: "removeWatch"; id: string }
    | { command: "refreshWatches" }
    | { command: "historyPrev" }
    | { command: "historyNext" }
    | { command: "modeChanged"; mode: EvalMode }
    | { command: "contentChanged"; code: string }
    | { command: "getState" }
    | { command: "getResultChildren"; ref: number; requestId: string; start?: number; count?: number }
    | { command: "debugAction"; action: "continue" | "pause" | "stepOver" | "stepInto" | "stepOut" };

// Extension -> Webview messages
export type ExtensionToWebview =
    | { type: "evaluateResult"; requestId: string; result: string; output?: string; node?: { ref: number; valueText: string; indexed?: number; named?: number } }
    | { type: "evaluateError"; requestId: string; error: string; output?: string }
    | { type: "watchesUpdated"; watches: WatchItem[] }
    | { type: "historyEntry"; code: string; index: number; total: number }
    | { type: "debugStateChanged"; active: boolean }
    | { type: "languageChanged"; language: string }
    | { type: "state"; watches: WatchItem[]; history: string[]; lastMode?: EvalMode; lastCode?: string
    settings?: { autoModeSwitch: boolean; smartPaste: boolean };
}
    | { type: "debugRunState"; state: "stopped" | "running" }
    | { type: "resultChildren"; requestId: string; ref: number; children?: { name: string; value: string; ref: number; indexed?: number; named?: number }[]; error?: string };

export interface WatchItem {
    id: string;
    expression: string;
    result?: string;
    error?: string;
}
