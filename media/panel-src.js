import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, placeholder } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { indentOnInput, bracketMatching, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const codeInputEl = document.getElementById("codeInput");
    const resultOutput = document.getElementById("resultOutput");
    const debugStatus = document.getElementById("debugStatus");
    const historyInfo = document.getElementById("historyInfo");
    const watchesList = document.getElementById("watchesList");

    const btnEvaluate = document.getElementById("btnEvaluate");
    const btnHistoryPrev = document.getElementById("btnHistoryPrev");
    const btnHistoryNext = document.getElementById("btnHistoryNext");
    const btnCopy = document.getElementById("btnCopy");
    const btnClear = document.getElementById("btnClear");
    const btnAddWatch = document.getElementById("btnAddWatch");
    const btnRefreshWatches = document.getElementById("btnRefreshWatches");

    let pendingRequestId = null;
    let requestCounter = 0;
    let lastResultText = "";
    let lastResultClass = "result-output";
    let contentDebounceTimer = null;

    // --- CodeMirror 6 setup ---
    const vsCodeTheme = EditorView.theme({
        "&": {
            backgroundColor: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
            fontSize: "var(--vscode-editor-font-size, 13px)",
            fontFamily: "var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace)",
            border: "1px solid var(--vscode-input-border)",
            borderRadius: "3px",
            minHeight: "120px",
        },
        "&.cm-focused": {
            outline: "1px solid var(--vscode-focusBorder)",
        },
        ".cm-content": {
            padding: "8px 4px",
            fontFamily: "inherit",
            caretColor: "var(--vscode-editorCursor-foreground, #fff)",
        },
        ".cm-line": {
            padding: "0 4px",
        },
        ".cm-gutters": {
            backgroundColor: "var(--vscode-editorGutter-background, var(--vscode-input-background))",
            color: "var(--vscode-editorLineNumber-foreground, #858585)",
            border: "none",
            borderRight: "1px solid var(--vscode-input-border)",
        },
        ".cm-activeLineGutter": {
            backgroundColor: "var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.05))",
        },
        ".cm-activeLine": {
            backgroundColor: "var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.05))",
        },
        ".cm-selectionBackground, ::selection": {
            backgroundColor: "var(--vscode-editor-selectionBackground, #264f78) !important",
        },
        ".cm-cursor": {
            borderLeftColor: "var(--vscode-editorCursor-foreground, #fff)",
        },
        ".cm-matchingBracket": {
            backgroundColor: "var(--vscode-editorBracketMatch-background, rgba(0,100,200,0.3))",
            outline: "1px solid var(--vscode-editorBracketMatch-border, #888)",
        },
    });

    const evaluateKeymap = keymap.of([
        {
            key: "Ctrl-Enter",
            run: () => {
                btnEvaluate.click();
                return true;
            },
        },
        {
            key: "Meta-Enter",
            run: () => {
                btnEvaluate.click();
                return true;
            },
        },
        {
            key: "Alt-ArrowUp",
            run: () => {
                vscode.postMessage({ command: "historyPrev" });
                return true;
            },
        },
        {
            key: "Alt-ArrowDown",
            run: () => {
                vscode.postMessage({ command: "historyNext" });
                return true;
            },
        },
    ]);

    const languageConf = new Compartment();

    function getLanguageExtension(lang) {
        switch (lang) {
            case "javascript":
                return javascript({ typescript: true });
            case "python":
            default:
                return python();
        }
    }

    function setEditorLanguage(lang) {
        editor.dispatch({
            effects: languageConf.reconfigure(getLanguageExtension(lang)),
        });
    }

    const contentChangeListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
            if (contentDebounceTimer) {
                clearTimeout(contentDebounceTimer);
            }
            contentDebounceTimer = setTimeout(() => {
                vscode.postMessage({ command: "contentChanged", code: getEditorValue() });
            }, 500);
        }
    });

    // Smart paste: code copied from an editor usually carries the leading
    // indentation of its original context (e.g. inside a function body).
    // Strip the common indent so the snippet is valid at top level, the way
    // PyCharm's Evaluate dialog does. Only applies to multi-line pastes at
    // a line start, so pasting a fragment mid-line is untouched.
    function dedentText(text) {
        const normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
        const lines = normalized.split("\n");
        const nonEmpty = lines.filter((l) => l.trim().length > 0);
        if (nonEmpty.length === 0) {
            return normalized;
        }
        const minIndent = Math.min(...nonEmpty.map((l) => l.match(/^\s*/)[0].length));
        if (minIndent === 0) {
            return normalized;
        }
        return lines.map((l) => l.slice(minIndent)).join("\n");
    }

    const smartPaste = EditorView.domEventHandlers({
        paste(event, view) {
            const text = event.clipboardData && event.clipboardData.getData("text/plain");
            if (!text || !text.includes("\n")) {
                return false; // single-line paste: default behavior
            }
            const { from, to } = view.state.selection.main;
            const line = view.state.doc.lineAt(from);
            const beforeCursor = view.state.doc.sliceString(line.from, from);
            if (beforeCursor.trim().length > 0) {
                return false; // pasting mid-line: don't touch indentation
            }
            event.preventDefault();
            const dedented = dedentText(text);
            view.dispatch({
                changes: { from, to, insert: dedented },
                selection: { anchor: from + dedented.length },
                scrollIntoView: true,
            });
            return true;
        },
    });

    const editorState = EditorState.create({
        doc: "",
        extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightActiveLine(),
            history(),
            indentOnInput(),
            bracketMatching(),
            languageConf.of(python()),
            oneDark,
            vsCodeTheme,
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            evaluateKeymap,
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            smartPaste,
            placeholder("Type or paste code \u00b7 Ctrl+Enter to evaluate \u00b7 Alt+\u2191\u2193 history"),
            contentChangeListener,
            EditorView.lineWrapping,
            EditorState.tabSize.of(4),
        ],
    });

    const editor = new EditorView({
        state: editorState,
        parent: codeInputEl,
    });

    function getEditorValue() {
        return editor.state.doc.toString();
    }

    function setEditorValue(value) {
        editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: value },
        });
    }

    // --- Helpers ---
    function getMode() {
        const checked = document.querySelector('input[name="mode"]:checked');
        return checked ? checked.value : "statements";
    }

    function generateRequestId() {
        return "req_" + (++requestCounter) + "_" + Date.now();
    }

    function normalizeCode(raw) {
        return raw
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .replace(/\t/g, "    ");
    }

    // --- Evaluate ---
    btnEvaluate.addEventListener("click", () => {
        const code = normalizeCode(getEditorValue()).trim();
        if (!code) {
            return;
        }
        const requestId = generateRequestId();
        pendingRequestId = requestId;

        // Auto-mode: multi-line code can't be a single expression — switch
        // to Statements (visibly, so the toggle reflects what ran) the way
        // PyCharm's dialog adapts when it expands to multi-line.
        let mode = getMode();
        if (mode === "expression" && code.includes("\n") && code.trim().includes("\n")) {
            const stmtRadio = document.querySelector('input[name="mode"][value="statements"]');
            if (stmtRadio) {
                stmtRadio.checked = true;
                mode = "statements";
                vscode.postMessage({ command: "modeChanged", mode: mode });
            }
        }

        resultOutput.textContent = "Evaluating\u2026";
        resultOutput.className = "result-output loading";
        btnEvaluate.disabled = true;

        vscode.postMessage({
            command: "evaluate",
            code: code,
            mode: mode,
            requestId: requestId,
        });
    });

    // --- Mode change persistence ---
    document.querySelectorAll('input[name="mode"]').forEach((radio) => {
        radio.addEventListener("change", () => {
            vscode.postMessage({ command: "modeChanged", mode: getMode() });
        });
    });

    // --- History ---
    btnHistoryPrev.addEventListener("click", () => {
        vscode.postMessage({ command: "historyPrev" });
    });

    btnHistoryNext.addEventListener("click", () => {
        vscode.postMessage({ command: "historyNext" });
    });

    // --- Copy ---
    btnCopy.addEventListener("click", () => {
        const text = resultOutput.textContent;
        if (text) {
            navigator.clipboard.writeText(text).catch(() => {
                const range = document.createRange();
                range.selectNodeContents(resultOutput);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            });
        }
    });

    // --- Clear ---
    btnClear.addEventListener("click", () => {
        resultOutput.textContent = "";
        resultOutput.className = "result-output";
        lastResultText = "";
        lastResultClass = "result-output";
    });

    // --- Watches ---
    btnAddWatch.addEventListener("click", () => {
        const code = getEditorValue().trim();
        if (!code) {
            return;
        }
        vscode.postMessage({ command: "addWatch", expression: code });
    });

    btnRefreshWatches.addEventListener("click", () => {
        vscode.postMessage({ command: "refreshWatches" });
    });

    function renderWatches(watches) {
        if (!watches || watches.length === 0) {
            watchesList.innerHTML = '<div class="watches-empty">No watches added</div>';
            return;
        }
        watchesList.innerHTML = watches
            .map(
                (w) => `
            <div class="watch-item">
                <span class="watch-expr">${escapeHtml(w.expression)}</span>
                <span class="watch-result ${w.error ? "error" : ""}">${escapeHtml(
                    w.error || w.result || "\u2014"
                )}</span>
                <span class="watch-remove" data-id="${w.id}" title="Remove">\u2715</span>
            </div>`
            )
            .join("");

        watchesList.querySelectorAll(".watch-remove").forEach((el) => {
            el.addEventListener("click", () => {
                vscode.postMessage({ command: "removeWatch", id: el.dataset.id });
            });
        });
    }

    // --- Message handler ---
    window.addEventListener("message", (event) => {
        const msg = event.data;

        switch (msg.type) {
            case "evaluateResult":
                if (msg.requestId === pendingRequestId) {
                    lastResultText = msg.result;
                    lastResultClass = "result-output success";
                    resultOutput.textContent = lastResultText;
                    resultOutput.className = lastResultClass;
                    btnEvaluate.disabled = false;
                    pendingRequestId = null;
                }
                break;

            case "evaluateError":
                if (msg.requestId === pendingRequestId) {
                    lastResultText = msg.error;
                    lastResultClass = "result-output error";
                    resultOutput.textContent = lastResultText;
                    resultOutput.className = lastResultClass;
                    btnEvaluate.disabled = false;
                    pendingRequestId = null;
                }
                break;

            case "watchesUpdated":
                renderWatches(msg.watches);
                restoreResult();
                break;

            case "historyEntry":
                setEditorValue(msg.code);
                if (msg.index >= 0) {
                    historyInfo.textContent = `${msg.index + 1} / ${msg.total}`;
                } else {
                    historyInfo.textContent = "";
                }
                break;

            case "debugStateChanged":
                if (msg.active) {
                    debugStatus.textContent = "Debug session active";
                    debugStatus.className = "debug-status active";
                } else {
                    debugStatus.textContent = "No debug session";
                    debugStatus.className = "debug-status";
                }
                restoreResult();
                break;

            case "languageChanged":
                setEditorLanguage(msg.language);
                break;

            case "state":
                renderWatches(msg.watches);
                if (msg.lastMode) {
                    const radio = document.querySelector(`input[name="mode"][value="${msg.lastMode}"]`);
                    if (radio) {
                        radio.checked = true;
                    }
                }
                if (msg.lastCode && !getEditorValue()) {
                    setEditorValue(msg.lastCode);
                }
                restoreResult();
                break;
        }
    });

    function restoreResult() {
        if (lastResultText && !pendingRequestId) {
            resultOutput.textContent = lastResultText;
            resultOutput.className = lastResultClass;
        }
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // Request initial state
    vscode.postMessage({ command: "getState" });
})();
