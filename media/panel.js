(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    const codeInput = document.getElementById("codeInput");
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

    function getMode() {
        const checked = document.querySelector('input[name="mode"]:checked');
        return checked ? checked.value : "statements";
    }

    function generateRequestId() {
        return "req_" + (++requestCounter) + "_" + Date.now();
    }

    // --- Evaluate ---
    btnEvaluate.addEventListener("click", () => {
        const code = codeInput.value.trim();
        if (!code) {
            return;
        }
        const requestId = generateRequestId();
        pendingRequestId = requestId;

        resultOutput.textContent = "Evaluating…";
        resultOutput.className = "result-output loading";
        btnEvaluate.disabled = true;

        vscode.postMessage({
            command: "evaluate",
            code: code,
            mode: getMode(),
            requestId: requestId,
        });
    });

    // Ctrl+Enter in textarea triggers evaluate
    codeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            btnEvaluate.click();
        }
        if (e.key === "ArrowUp" && e.altKey) {
            e.preventDefault();
            vscode.postMessage({ command: "historyPrev" });
        }
        if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            vscode.postMessage({ command: "historyNext" });
        }
        // Allow Tab to insert spaces instead of moving focus
        if (e.key === "Tab") {
            e.preventDefault();
            const start = codeInput.selectionStart;
            const end = codeInput.selectionEnd;
            codeInput.value = codeInput.value.substring(0, start) + "    " + codeInput.value.substring(end);
            codeInput.selectionStart = codeInput.selectionEnd = start + 4;
        }
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
                // Fallback: select text
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
        const code = codeInput.value.trim();
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
                    w.error || w.result || "—"
                )}</span>
                <span class="watch-remove" data-id="${w.id}" title="Remove">✕</span>
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
                codeInput.value = msg.code;
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

            case "state":
                renderWatches(msg.watches);
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
