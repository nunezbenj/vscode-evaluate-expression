import * as fs from "fs";
import * as path from "path";

let logPath = "";
let logStream: fs.WriteStream | undefined;

export function initLog(extensionPath: string) {
    logPath = path.join(extensionPath, "debug.log");
    // Truncate on each activation so the file doesn't grow forever
    logStream = fs.createWriteStream(logPath, { flags: "w" });
    log("=== Evaluate Extension activated ===");
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
    logStream?.write(line + "\n");
}

export function closeLog() {
    logStream?.end();
    logStream = undefined;
}
