/**
 * Minimal mock of the vscode module so that pure-function unit tests
 * can import from src/ files without requiring the real VS Code host.
 * Registered via .mocharc.yml `require` before any test files load.
 */

const Module = require("module");
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request: string, parent: unknown) {
    if (request === "vscode") {
        return request;
    }
    return originalResolve.call(this, request, parent);
};

const originalLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "vscode") {
        return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
