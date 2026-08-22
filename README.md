[![Version](https://img.shields.io/visual-studio-marketplace/v/nunezbenj.pycharm-evaluate)](https://marketplace.visualstudio.com/items?itemName=nunezbenj.pycharm-evaluate)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/nunezbenj.pycharm-evaluate)](https://marketplace.visualstudio.com/items?itemName=nunezbenj.pycharm-evaluate)
[![License](https://img.shields.io/github/license/nunezbenj/vscode-evaluate-expression)](LICENSE)

# PyCharm-like Evaluate Expression

A VS Code / Cursor extension that provides a **multi-line Evaluate Expression panel** for debugging, inspired by PyCharm's Evaluate Expression dialog.

## Why This Extension?

VS Code's Debug Console only supports single-line expressions. If you're coming from PyCharm, you know how powerful it is to evaluate multi-line code blocks — loops, conditionals, function calls — all at once while paused at a breakpoint. This extension brings that workflow to VS Code and Cursor.

## Screenshot

> **Tip:** For the best experience, detach the panel into a floating window (see [Floating Window](#tip-floating-window) below).

![Evaluate Expression floating window](images/screenshot-floating.png)


## Features

- **Syntax-highlighted code editor** — CodeMirror 6 with Python/JavaScript highlighting, line numbers, auto-indent, and bracket matching
- **Multi-line code editor** — evaluate many lines at once, not just single expressions
- **Statement mode** — automatically wraps code in a function so `return`, loops, and multi-line logic work
- **Expression mode** — evaluate a single expression as-is
- **Multi-language support** — Python, JavaScript/TypeScript (Node.js, Chrome), and generic DAP debuggers; CodeMirror language mode switches automatically
- **CodeLens integration** — "Evaluate Selection" and "Add to Watches" links appear above selected code during debugging
- **Watches** — add expressions to a watch list that auto-refreshes when the debugger stops
- **History** — navigate through previous evaluations with Alt+Up/Down
- **Right-click context menu** — select code, right-click → "Evaluate: Run Selection" during debugging
- **Persistent preferences** — remembers your last mode (Statements/Expression) and code between sessions
- **Debug logging** — built-in diagnostic log for easy bug reporting

## Usage

1. Start a debug session and pause at a breakpoint
2. Open the Evaluate panel: `Ctrl+Alt+E` (or Command Palette → "Evaluate: Open Panel")
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

- **New locals don't persist when using mid-block `return`** (see Scoping Note above).
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

### v1.4.0
- **New:** **Cleaner error output** — debugger-internal frames (pydevd/debugpy) are hidden from tracebacks; you see your code and the exception, with the full trace in the debug log
- **New:** **Auto-mode** — multi-line code automatically switches the panel to Statements mode, so pasted blocks just run
- **New:** **Editor placeholder** showing the key shortcuts when the panel is empty
- **New:** **Smart paste** — code pasted into the panel is auto-dedented, so snippets copied from inside a function evaluate without IndentationErrors. A hint now points to Statements mode when multi-line code fails in Expression mode
- **New:** **Evaluate button in the debug toolbar** — a calculator icon next to the step controls opens the Evaluate panel with one click, no keyboard shortcut needed (PyCharm-style discoverability)
- **New:** New variables created in Statements mode now **persist in the paused frame** (Python). Code is executed directly via debugpy's repl/exec path instead of a function wrapper, so `x = 5` shows up in Variables just like PyCharm
- **New:** The **Variables panel auto-refreshes** after every evaluation. Implemented via a no-op DAP `goto` (Set Next Statement to the current line), which triggers a full VS Code refresh without advancing execution. Configurable via `evaluate.autoRefreshVariables`
- **New:** Watches refresh automatically after evaluations that change program state
- **Improved:** Trailing `return expr` in Statements mode is now treated as "show this value" and no longer forces the function wrapper
- **Improved:** JavaScript statements run unwrapped (DevTools-console semantics) unless a top-level `return` requires the IIFE

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
