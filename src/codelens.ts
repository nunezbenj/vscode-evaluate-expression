import * as vscode from "vscode";

export class EvaluateCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    private _debugActive = false;
    private _refreshTimer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        vscode.debug.onDidChangeActiveDebugSession((session) => {
            this._debugActive = !!session;
            this._onDidChangeCodeLenses.fire();
        });

        vscode.window.onDidChangeTextEditorSelection(() => {
            if (!this._debugActive) {
                return;
            }
            if (this._refreshTimer) {
                clearTimeout(this._refreshTimer);
            }
            this._refreshTimer = setTimeout(() => {
                this._onDidChangeCodeLenses.fire();
            }, 250);
        });
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!this._debugActive) {
            return [];
        }

        const config = vscode.workspace.getConfiguration("evaluate");
        if (!config.get<boolean>("showCodeLens", true)) {
            return [];
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== document) {
            return [];
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            return [];
        }

        const range = new vscode.Range(selection.start.line, 0, selection.start.line, 0);

        return [
            new vscode.CodeLens(range, {
                title: "$(debug-start) Evaluate Selection",
                command: "evaluate.runSelection",
                tooltip: "Evaluate the selected code in the debug session",
            }),
            new vscode.CodeLens(range, {
                title: "$(eye) Add to Watches",
                command: "evaluate.addWatch",
                tooltip: "Add selected expression to watch list",
            }),
        ];
    }
}
