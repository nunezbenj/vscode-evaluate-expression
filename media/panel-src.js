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
    const panelSettings = { autoModeSwitch: true, smartPaste: true };

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
            if (!panelSettings.smartPaste || !text || !text.includes("\n")) {
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
            placeholder((navigator.platform || "").indexOf("Mac") === 0
                ? "Type or paste code \u00b7 \u2318Enter to evaluate \u00b7 \u2325\u2191\u2193 history"
                : "Type or paste code \u00b7 Ctrl+Enter to evaluate \u00b7 Alt+\u2191\u2193 history"),
            contentChangeListener,
            EditorView.lineWrapping,
            EditorState.tabSize.of(4),
        ],
    });

    const editor = new EditorView({
        state: editorState,
        parent: codeInputEl,
    });

    // The editor is a fixed-height, user-resizable box (PyCharm style):
    // content scrolls inside it instead of resizing the panel, so the
    // buttons below never move during history navigation. Remember the
    // height the user drags it to across panel reloads.
    const savedState = vscode.getState() || {};
    if (typeof savedState.editorHeight === "number" && savedState.editorHeight >= 80) {
        codeInputEl.style.height = savedState.editorHeight + "px";
    }
    function saveEditorHeight() {
        const h = codeInputEl.offsetHeight;
        if (h >= 80) {
            vscode.setState(Object.assign({}, vscode.getState() || {}, { editorHeight: h }));
        }
    }

    // Splitter: drag the divider between the editor and the Result area
    // to reallocate space between them (PyCharm-style panes). Clamped so
    // both areas keep a usable minimum; double-click resets; the corner
    // resize handle still works as an alternative.
    const splitterEl = document.getElementById("splitter");
    if (splitterEl) {
        let dragStartY = 0;
        let dragStartHeight = 0;

        const onSplitterMove = (ev) => {
            const maxH = Math.max(120, window.innerHeight - 280);
            const h = Math.min(maxH, Math.max(80, dragStartHeight + (ev.clientY - dragStartY)));
            codeInputEl.style.height = h + "px";
        };

        const onSplitterUp = () => {
            document.removeEventListener("pointermove", onSplitterMove);
            document.removeEventListener("pointerup", onSplitterUp);
            document.removeEventListener("pointercancel", onSplitterUp);
            splitterEl.classList.remove("dragging");
            document.body.classList.remove("splitter-dragging");
            saveEditorHeight();
        };

        splitterEl.addEventListener("pointerdown", (ev) => {
            ev.preventDefault();
            dragStartY = ev.clientY;
            dragStartHeight = codeInputEl.offsetHeight;
            splitterEl.classList.add("dragging");
            document.body.classList.add("splitter-dragging");
            document.addEventListener("pointermove", onSplitterMove);
            document.addEventListener("pointerup", onSplitterUp);
            document.addEventListener("pointercancel", onSplitterUp);
        });

        splitterEl.addEventListener("dblclick", () => {
            codeInputEl.style.height = "200px";
            saveEditorHeight();
        });
    }

    if (typeof ResizeObserver !== "undefined") {
        let heightSaveTimer;
        new ResizeObserver(() => {
            if (heightSaveTimer) {
                clearTimeout(heightSaveTimer);
            }
            heightSaveTimer = setTimeout(saveEditorHeight, 300);
        }).observe(codeInputEl);
    }

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
        if (panelSettings.autoModeSwitch && mode === "expression" && code.includes("\n") && code.trim().includes("\n")) {
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
        // Safety net: if the debug session dies mid-evaluation no reply ever
        // arrives; don't leave the button disabled forever.
        setTimeout(() => {
            if (pendingRequestId === requestId && btnEvaluate.disabled) {
                btnEvaluate.disabled = false;
                pendingRequestId = null;
                resultOutput.textContent = "No response from the debugger (session ended?). Try again.";
                resultOutput.className = "result-output error";
            }
        }, 30000);

        vscode.postMessage({
            command: "evaluate",
            code: code,
            mode: mode,
            requestId: requestId,
        });
    });

    // --- Debug HUD: step controls (1.6.0) ---
    let runState = "stopped"; // updated by debugRunState messages
    let sessionActive = false;
    let sessionName = "";

    // Status pill: colored dot + state + session name (VS Code-style)
    function renderStatusPill() {
        const textEl = debugStatus.querySelector(".status-text");
        const nameEl = debugStatus.querySelector(".status-name");
        if (!sessionActive) {
            debugStatus.className = "debug-status";
            textEl.textContent = "No debug session";
            nameEl.textContent = "";
            nameEl.title = "";
            return;
        }
        const paused = runState === "stopped";
        debugStatus.className = "debug-status " + (paused ? "paused" : "running");
        textEl.textContent = paused ? "Paused" : "Running";
        nameEl.textContent = sessionName ? "\u00b7 " + sessionName : "";
        nameEl.title = sessionName;
    }
    const btnContinue = document.getElementById("btnContinue");
    const btnPause = document.getElementById("btnPause");
    const btnStepOver = document.getElementById("btnStepOver");
    const btnStepInto = document.getElementById("btnStepInto");
    const btnStepOut = document.getElementById("btnStepOut");
    const stepBar = document.getElementById("stepBar");

    function sendDebugAction(action) {
        vscode.postMessage({ command: "debugAction", action: action });
    }
    if (btnContinue) { btnContinue.addEventListener("click", () => sendDebugAction("continue")); }
    if (btnPause) { btnPause.addEventListener("click", () => sendDebugAction("pause")); }
    if (btnStepOver) { btnStepOver.addEventListener("click", () => sendDebugAction("stepOver")); }
    if (btnStepInto) { btnStepInto.addEventListener("click", () => sendDebugAction("stepInto")); }
    if (btnStepOut) { btnStepOut.addEventListener("click", () => sendDebugAction("stepOut")); }

    function applyRunState() {
        const stopped = runState === "stopped";
        if (btnContinue) { btnContinue.hidden = !stopped; }
        if (btnPause) { btnPause.hidden = stopped; }
        for (const b of [btnStepOver, btnStepInto, btnStepOut]) {
            if (b) { b.disabled = !stopped; }
        }
    }
    applyRunState();

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

    const btnClearCode = document.getElementById("btnClearCode");
    if (btnClearCode) {
        btnClearCode.addEventListener("click", () => {
            setEditorValue("");
            vscode.postMessage({ command: "contentChanged", code: "" });
            editor.focus();
        });
    }

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
                    lastResultClass = "result-output success";
                    renderEvalOutcome(msg.output, msg.result, "eval-value-success", msg.node);
                    btnEvaluate.disabled = false;
                    pendingRequestId = null;
                }
                break;

            case "resultChildren": {
                const containerEl = childFetchPending.get(msg.requestId);
                if (containerEl) {
                    childFetchPending.delete(msg.requestId);
                    renderChildren(containerEl, msg);
                }
                break;
            }
            case "evaluateError":
                if (msg.requestId === pendingRequestId) {
                    lastResultText = msg.error;
                    lastResultClass = "result-output error";
                    renderEvalOutcome(msg.output, msg.error, "eval-value-error");
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

            case "debugRunState":
                runState = msg.state;
                applyRunState();
                renderStatusPill();
                break;
            case "debugStateChanged":
                if (stepBar) { stepBar.style.visibility = msg.active ? "visible" : "hidden"; }
                sessionActive = msg.active;
                sessionName = msg.name || "";
                renderStatusPill();
                restoreResult();
                break;

            case "languageChanged":
                setEditorLanguage(msg.language);
                break;

            case "state":
                if (msg.settings) {
                    panelSettings.autoModeSwitch = msg.settings.autoModeSwitch !== false;
                    panelSettings.smartPaste = msg.settings.smartPaste !== false;
                }
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

    // ---- Structured result tree (1.5.0) ----
    let childFetchSeq = 0;
    const childFetchPending = new Map(); // requestId -> container element

    function typeBadge(node) {
        if (typeof node.indexed === "number" && node.indexed > 0) { return "[" + node.indexed + "]"; }
        if (typeof node.named === "number" && node.named > 0) { return "{" + node.named + "}"; }
        return "";
    }

    function makeTreeNode(labelName, valueText, ref, badge) {
        const row = document.createElement("div");
        row.className = "tree-row";
        const twisty = document.createElement("span");
        twisty.className = "twisty" + (ref > 0 ? "" : " leaf");
        twisty.textContent = ref > 0 ? "\u25b8" : "";
        row.appendChild(twisty);
        const label = document.createElement("span");
        label.className = "tree-label";
        if (labelName !== null) {
            const nm = document.createElement("span");
            nm.className = "tree-name";
            nm.textContent = labelName + " = ";
            label.appendChild(nm);
        }
        if (badge) {
            const b = document.createElement("span");
            b.className = "tree-badge";
            b.textContent = badge + " ";
            label.appendChild(b);
        }
        const val = document.createElement("span");
        val.className = "tree-value";
        val.textContent = valueText;
        label.appendChild(val);
        row.appendChild(label);

        const wrap = document.createElement("div");
        wrap.className = "tree-node";
        wrap.appendChild(row);

        if (ref > 0) {
            const childrenEl = document.createElement("div");
            childrenEl.className = "tree-children";
            childrenEl.hidden = true;
            wrap.appendChild(childrenEl);
            let loaded = false;
            row.addEventListener("click", () => {
                const open = !childrenEl.hidden;
                if (open) {
                    childrenEl.hidden = true;
                    twisty.textContent = "\u25b8";
                    return;
                }
                childrenEl.hidden = false;
                twisty.textContent = "\u25be";
                if (!loaded) {
                    loaded = true;
                    requestChildren(ref, childrenEl, 0);
                }
            });
        }
        return wrap;
    }

    function requestChildren(ref, containerEl, start) {
        const reqId = "children-" + (++childFetchSeq);
        childFetchPending.set(reqId, containerEl);
        const loadingEl = document.createElement("div");
        loadingEl.className = "tree-loading";
        loadingEl.textContent = "loading\u2026";
        containerEl.appendChild(loadingEl);
        vscode.postMessage({ command: "getResultChildren", ref: ref, requestId: reqId, start: start, count: 100 });
    }

    function renderChildren(containerEl, msg) {
        const loading = containerEl.querySelector(".tree-loading");
        if (loading) { loading.remove(); }
        if (msg.error || !msg.children) {
            const err = document.createElement("div");
            err.className = "tree-stale";
            err.textContent = "(no longer available \u2014 re-evaluate to expand)";
            containerEl.appendChild(err);
            return;
        }
        for (const c of msg.children) {
            containerEl.appendChild(makeTreeNode(c.name, c.value, c.ref, typeBadge(c)));
        }
        if (msg.children.length === 100) {
            const moreEl = document.createElement("div");
            moreEl.className = "tree-more";
            moreEl.textContent = "\u22ef more";
            const already = containerEl.querySelectorAll(".tree-node").length;
            moreEl.addEventListener("click", () => {
                moreEl.remove();
                requestChildren(msg.ref, containerEl, already);
            }, { once: true });
            containerEl.appendChild(moreEl);
        }
    }

    // Shows captured program output (print etc.) above the result value so
    // the Debug Console doesn't need to stay open. Output keeps the normal
    // foreground; the value keeps the success/error color.
    function renderEvalOutcome(output, value, valueClass, node) {
        resultOutput.className = "result-output";
        resultOutput.textContent = "";
        if (output && output.length > 0) {
            const outEl = document.createElement("span");
            outEl.className = "eval-output";
            outEl.textContent = output.replace(/\n$/, "");
            resultOutput.appendChild(outEl);
            resultOutput.appendChild(document.createTextNode("\n"));
            const sepEl = document.createElement("span");
            sepEl.className = "eval-sep";
            sepEl.textContent = "\u2500\u2500\u2500";
            resultOutput.appendChild(sepEl);
            resultOutput.appendChild(document.createTextNode("\n"));
        }
        if (node && node.ref > 0) {
            resultOutput.appendChild(makeTreeNode(null, node.valueText || value, node.ref, typeBadge(node)));
        } else {
            const valEl = document.createElement("span");
            valEl.className = valueClass;
            valEl.textContent = value;
            resultOutput.appendChild(valEl);
        }
        lastResultText = (output ? output + "\n" : "") + value;
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // Request initial state
    vscode.postMessage({ command: "getState" });
})();
