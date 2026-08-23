[![License](https://img.shields.io/github/license/nunezbenj/vscode-evaluate-expression)](LICENSE)

# PyCharm-like Evaluate Expression

A VS Code / Cursor extension that provides a **multi-line Evaluate Expression panel** for debugging, inspired by PyCharm's Evaluate Expression dialog.

## What's New in 1.4.0 🎉

The two biggest limitations are gone, plus a full UX polish pass:

- **New variables persist** — `x = compute()` in Statements mode now shows up in the Variables panel, exactly like PyCharm. No more function-wrapper scoping surprises.
- **Variables panel auto-refreshes** after every evaluation — mutations and new variables appear immediately, no stepping required.
- **One-click access** — a calculator button in the debug toolbar opens the panel.
- **Smart paste** — code copied from inside a function is auto-dedented and just runs.
- **Auto-mode** — multi-line code switches to Statements mode automatically.
- **Cleaner errors** — debugger-internal frames are hidden from tracebacks.
- **Resizable layout** — drag the divider between code and Result; separate Clear Code / Clear Result buttons; shortcut hints in the empty editor.

## Why This Extension?

VS Code's Debug Console only supports single-line expressions. If you're coming from PyCharm, you know how powerful it is to evaluate multi-line code blocks — loops, conditionals, function calls — all at once while paused at a breakpoint. This extension brings that workflow to VS Code and Cursor.

## Screenshot

Evaluating a multi-line snippet while paused at a breakpoint: the new variable `total` **persists in the paused frame and appears in the Variables panel immediately**, and the trailing expression's value is shown as the result.

![Evaluate Expression panel: new variable persisted into the Variables panel](images/screenshot-floating.png)

> **Tip:** For a PyCharm-style floating dialog, detach the panel into its own window — see [Floating Window](#tip-floating-window).


## Features

- **Multi-line evaluation in the paused frame** — run loops, conditionals, and whole blocks at a breakpoint; new variables and mutations persist and appear in the Variables panel
- **Variables, Watches, and Call Stack auto-refresh** after each evaluation (configurable via `evaluate.autoRefreshVariables`)
- **Debug-toolbar button** — one-click access next to the step controls
- **Syntax-highlighted editor** — CodeMirror 6 with Python/JavaScript highlighting, line numbers, auto-indent, bracket matching, and smart paste (auto-dedent)
- **Statements & Expression modes** — with automatic switching for multi-line code
- **Resizable panes** — drag the divider between the code editor and Result (double-click to reset; size is remembered)
- **Clean error output** — your exception and your frames, without debugger internals (full traceback in the debug log)
- **Multi-language support** — Python (debugpy), JavaScript/TypeScript (Node.js, Chrome), and generic DAP debuggers
- **CodeLens & context menu** — "Evaluate Selection" and "Add to Watches" on selected code during debugging
- **Watches** — expression list that refreshes when the debugger stops and after evaluations
- **History** — navigate previous evaluations with Alt+Up/Down
- **Persistent preferences** — remembers mode, code, and layout between sessions
- **Debug logging** — built-in diagnostic log for easy bug reporting

## Usage

1. Start a debug session and pause at a breakpoint
2. Open the Evaluate panel: click the **calculator button** in the debug toolbar (or `Ctrl+Alt+E`, or Command Palette → "Evaluate: Open Panel")
3. Type multi-line code in the editor
4. Click **Evaluate** (or press `Ctrl+Enter`)
5. See the result in the output area

### Tip: Floating Window

For the best experience, detach the Evaluate panel into its own window:

1. Right-click the **"Evaluate Expression"** tab
2. Select **"Move into New Window"**

This mimics PyCharm's floating Evaluate dialog and lets you keep your code fully visible while evaluating expressions. You can position it on a second monitor or anywhere on your screen.

### Keybindings

| Shortcut | Fallback | Action |
|----------|----------|--------|
| `Ctrl+Alt+E` | `Ctrl+Shift+F8` | Open the Evaluate panel |
| `Ctrl+Alt+Enter` | `Ctrl+Shift+F9` | Evaluate selected text from the editor |
| `Ctrl+Enter` | — | Evaluate (when focused in the panel's textarea) |
| `Alt+Up` / `Alt+Down` | — | Navigate evaluation history |

> **Note:** If `Ctrl+Alt+E` doesn't work in your environment (e.g., Remote-SSH sessions), use the fallback `Ctrl+Shift+F8` or open via Command Palette → "Evaluate: Open Panel". You can also customize keybindings in `File → Preferences → Keyboard Shortcuts`.

### Context Menu

When paused at a breakpoint, select code in the editor and right-click to see:
- **Evaluate: Run Selection** — sends the selected code to the Evaluate panel
- **Evaluate: Add Selection to Watches** — adds the selected expression to the watch list

## Scoping Note

In **Statements mode** (Python), code is executed directly in the paused frame via debugpy's repl/exec path. This means:
- **Mutations to existing objects** (e.g., `self.next = None`) work as expected
- **New variables** created in the snippet (e.g., `x = compute()`) **persist in the paused frame** and appear in the Variables panel — same behavior as PyCharm's Evaluate Expression
- If the snippet ends with a bare expression, its value is shown as the result

The only exception: snippets that use `return` for flow control mid-block (e.g., an early `return` inside an `if`) fall back to a function-wrapped execution, where new locals do not persist. A trailing `return expr` on the last line works fine — it's treated as "show me this value."

For **JavaScript/TypeScript**, code runs like in the DevTools console: the last statement's completion value is shown, and declarations persist as far as the V8 debugger allows.

## Known Limitations

- **Python:** new locals don't persist when the snippet uses `return` for mid-block flow control — that pattern falls back to a function-wrapped execution (see Scoping Note above). A trailing `return expr` is fine.
- **JavaScript/TypeScript:** the V8 debugger does not allow adding *new* local variables to a paused frame; mutations to existing objects work, and declarations persist only as far as the runtime allows.
- **Auto-refresh of the Variables panel** relies on the debug adapter supporting the DAP `goto` request (debugpy does). On adapters without it, refresh is skipped automatically — step once (F10) to see updated values, or disable via `evaluate.autoRefreshVariables`.

## Bug Reporting

If you encounter an issue:

1. Enable verbose logging: `Settings → evaluate.verboseLogging → true`
2. Reproduce the issue
3. Copy the log: `Ctrl+Shift+P` → "Evaluate: Copy Debug Log to Clipboard"
4. Paste into a [GitHub issue](https://github.com/nunezbenj/vscode-evaluate-expression/issues)

The log includes extension version, VS Code version, OS, and detailed DAP communication.

## Development

```bash
npm install
npm run compile
# Press F5 in VS Code/Cursor to launch the Extension Development Host
```

## Requirements

- VS Code 1.85+ or Cursor
- A debug adapter that supports the DAP `evaluate` request (e.g., Python + debugpy)

## Changelog

### v1.4.1
- **Fixed:** A floating (detached) Evaluate window no longer drops behind the main window when you hit Evaluate — the panel re-asserts focus when the refresh's stop event is processed (with a late second pass), instead of racing it on a timer. For completely flicker-free behavior you can also set VS Code's `debug.focusWindowOnBreak` to `false`
- **New:** Opt-out settings for the 1.4.0 automatics: `evaluate.autoModeSwitch` and `evaluate.smartPaste` (both on by default)
- **Fixed:** The Evaluate button can no longer get stuck disabled if the debug session ends mid-evaluation
- **Improved:** Editor placeholder shows Mac keybindings (⌘Enter / ⌥↑↓) on macOS
- **Docs:** Screenshot section matches the new capture, Known Limitations covers the JS/TS frame-locals constraint, removed retired marketplace badges

### v1.4.0
- **New:** New variables created in Statements mode now **persist in the paused frame** (Python). Code executes directly via debugpy's repl/exec path instead of a function wrapper, so `x = 5` appears in Variables just like PyCharm
- **New:** The **Variables panel auto-refreshes** after every evaluation, via a no-op DAP `goto` (Set Next Statement to the current line) that triggers a full VS Code refresh without advancing execution. Configurable via `evaluate.autoRefreshVariables`; watches refresh too
- **New:** **Evaluate button in the debug toolbar** — a calculator icon next to the step controls opens the panel with one click
- **New:** **Smart paste** — multi-line pastes are auto-dedented, so snippets copied from inside a function evaluate without IndentationErrors
- **New:** **Auto-mode** — multi-line code automatically switches the panel to Statements mode
- **New:** **Cleaner error output** — debugger-internal frames (pydevd/debugpy) are hidden from tracebacks, with the full trace in the debug log
- **New:** **Draggable divider** between the code editor and Result reallocates space between them; double-click resets; size is remembered
- **New:** Separate **Clear Code** and **Clear Result** buttons
- **New:** Shortcut hints shown as a placeholder in the empty editor
- **Improved:** Stable editor height — content scrolls instead of resizing the panel during history navigation
- **Improved:** Trailing `return expr` in Statements mode is treated as "show this value" and no longer forces the function wrapper
- **Improved:** JavaScript statements run unwrapped (DevTools-console semantics) unless a top-level `return` requires the IIFE
- **Fixed:** `package-lock.json` regenerated against the official npm registry (previously pinned to a mirror, breaking installs)

### v1.3.0
- **New:** Syntax-highlighted code editor powered by CodeMirror 6 (Python highlighting, line numbers, auto-indent, bracket matching)
- **New:** Multi-language support — JavaScript/TypeScript wrapping (IIFE) for Node.js/Chrome debuggers; language auto-detection from debug session type
- **New:** CodeLens integration — "Evaluate Selection" and "Add to Watches" links appear inline above selected code during debugging (configurable via `evaluate.showCodeLens`)
- **New:** CodeMirror language mode switches automatically to match the active debugger (Python, JavaScript/TypeScript)
- **Fix:** `IndentationError` on multi-line statements in Statements mode (whitespace normalization and auto-dedent)
- **Fix:** Over-indented code from "Evaluate Selection" now correctly dedented (tab normalization)
- **Fix:** `return` injection no longer breaks indentation when last line is inside a nested block (e.g. `for`/`if`/`while`)

### v1.1.0
- **Fix:** Added fallback keybindings (`Ctrl+Shift+F8`, `Ctrl+Shift+F9`) for Remote-SSH compatibility
- **Fix:** Selected code from editor is now auto-dedented before evaluation
- **New:** Right-click context menu for "Evaluate: Run Selection" and "Add to Watches" during debugging
- **New:** Panel remembers last used mode (Statements/Expression) and code input between sessions
- **Improved:** Comprehensive README with badges, keybinding table, floating window tip, and bug reporting guide

### v1.0.2
- Added calculator-style extension icon

### v1.0.1
- Added VS Code Output Channel for user-visible debug logging
- Added `evaluate.verboseLogging` setting
- Added "Evaluate: Copy Debug Log to Clipboard" command
- Added environment info (version, OS) to log header
- Error notifications now include a "Show Log" button

### v1.0.0
- Initial release: multi-line Evaluate Expression panel
- Statements and Expression modes
- Watch expressions with auto-refresh
- History navigation
- DAP-based evaluation (Python/debugpy primary target)

## License

[MIT](LICENSE)
