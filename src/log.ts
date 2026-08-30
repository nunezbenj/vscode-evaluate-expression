import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

let outputChannel: vscode.OutputChannel | undefined;
let verboseEnabled = false;
let logBuffer: string[] = [];
const MAX_BUFFER_LINES = 5000;
let logFileStream: fs.WriteStream | undefined;
let logDirPath: string | undefined;
const KEEP_LOG_FILES = 5;

/** Persist logs to disk so a crash or window reload doesn't destroy the
 * evidence — "it crashed yesterday, can't reproduce" stays diagnosable. */
function initLogFile(context: vscode.ExtensionContext) {
    try {
        logDirPath = context.logUri.fsPath;
        fs.mkdirSync(logDirPath, { recursive: true });
        const existing = fs
            .readdirSync(logDirPath)
            .filter((f) => f.startsWith("evaluate-") && f.endsWith(".log"))
            .sort();
        for (const f of existing.slice(0, Math.max(0, existing.length - (KEEP_LOG_FILES - 1)))) {
            try { fs.unlinkSync(path.join(logDirPath, f)); } catch { /* ignore */ }
        }
        const name = "evaluate-" + new Date().toISOString().replace(/[:.]/g, "-") + ".log";
        logFileStream = fs.createWriteStream(path.join(logDirPath, name), { flags: "a" });
    } catch {
        logFileStream = undefined; // disk logging is best-effort
    }
}

export function getLogDir(): string | undefined {
    return logDirPath;
}

export function initLog(context?: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("Evaluate Expression");
    if (context) {
        initLogFile(context);
    }

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
    logFileStream?.write(line + "\n");
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
    logFileStream?.end();
    logFileStream = undefined;
    outputChannel?.dispose();
    outputChannel = undefined;
    logBuffer = [];
}
