import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;
let verboseEnabled = false;
let logBuffer: string[] = [];
const MAX_BUFFER_LINES = 5000;

export function initLog() {
    outputChannel = vscode.window.createOutputChannel("Evaluate Expression");

    verboseEnabled = vscode.workspace
        .getConfiguration("evaluate")
        .get<boolean>("verboseLogging", false);

    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("evaluate.verboseLogging")) {
            verboseEnabled = vscode.workspace
                .getConfiguration("evaluate")
                .get<boolean>("verboseLogging", false);
            log(`Verbose logging ${verboseEnabled ? "enabled" : "disabled"}`);
        }
    });

    logBuffer = [];
    logEnvironmentInfo();
}

function logEnvironmentInfo() {
    const ext = vscode.extensions.getExtension("nunezbenj.pycharm-evaluate");
    const extVersion = ext?.packageJSON?.version ?? "unknown";
    log("=== Evaluate Expression activated ===");
    log(`Extension version: ${extVersion}`);
    log(`VS Code version: ${vscode.version}`);
    log(`OS: ${process.platform} ${process.arch}`);
    log(`Node.js: ${process.version}`);
}

export function log(msg: string, data?: unknown) {
    const ts = new Date().toISOString();
    let line = `[${ts}] ${msg}`;
    if (data !== undefined) {
        try {
            line += " " + JSON.stringify(data, null, 0);
        } catch {
            line += " [unserializable]";
        }
    }
    outputChannel?.appendLine(line);
    logBuffer.push(line);
    if (logBuffer.length > MAX_BUFFER_LINES) {
        logBuffer.shift();
    }
}

export function logVerbose(msg: string, data?: unknown) {
    if (verboseEnabled) {
        log("[VERBOSE] " + msg, data);
    }
}

export function showLog() {
    outputChannel?.show(true);
}

export function getLogContents(): string {
    return logBuffer.join("\n");
}

export function showErrorWithLog(message: string) {
    log(`ERROR: ${message}`);
    vscode.window.showErrorMessage(message, "Show Log").then((action) => {
        if (action === "Show Log") {
            showLog();
        }
    });
}

export function closeLog() {
    outputChannel?.dispose();
    outputChannel = undefined;
    logBuffer = [];
}
