[![Version](https://img.shields.io/visual-studio-marketplace/v/nunezbenj.pycharm-evaluate)](https://marketplace.visualstudio.com/items?itemName=nunezbenj.pycharm-evaluate)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/nunezbenj.pycharm-evaluate)](https://marketplace.visualstudio.com/items?itemName=nunezbenj.pycharm-evaluate)
[![License](https://img.shields.io/github/license/nunezbenj/vscode-evaluate-expression)](LICENSE)

# PyCharm-like Evaluate Expression

A VS Code / Cursor extension that provides a **multi-line Evaluate Expression panel** for debugging, inspired by PyCharm's Evaluate Expression dialog.

## Why This Extension?

VS Code's Debug Console only supports single-line expressions. If you're coming from PyCharm, you know how powerful it is to evaluate multi-line code blocks — loops, conditionals, function calls — all at once while paused at a breakpoint. This extension brings that workflow to VS Code and Cursor.

## Screenshot

> **Tip:** For the best experience, detach the panel into a floating window (see [Floating Window](#tip-floating-window) below).

<!-- TODO: Replace with actual screenshot -->
<!-- ![Evaluate Expression floating window](images/screenshot-floating.png) -->
*Screenshot coming soon — see instructions below to take your own.*

## Features

- **Multi-line code editor** — evaluate many lines at once, not just single expressions
- **Statement mode** — automatically wraps code in a function so `return`, loops, and multi-line logic work
- **Expression mode** — evaluate a single expression as-is
- **Watches** — add expressions to a watch list that auto-refreshes when the debugger stops
- **History** — navigate through previous evaluations with Alt+Up/Down
- **Right-click context menu** — select code, right-click → "Evaluate: Run Selection" during debugging
- **Persistent preferences** — remembers your last mode (Statements/Expression) and code between sessions
- **Debug logging** — built-in diagnostic log for easy bug reporting
- **Works with any DAP debugger** — primary target is Python (debugpy), but the DAP protocol works with other languages too

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

In **Statements mode**, code is wrapped in a function for execution. This means:
- **Mutations to existing objects** (e.g., `self.next = None`) work as expected
- **New local variables** created inside the snippet do NOT persist in the paused frame

## Known Limitations

- **Variables panel does not auto-refresh** after evaluating statements that mutate objects. VS Code does not expose an API for extensions to force-refresh the Variables panel without advancing execution. **Workaround:** after mutating a variable via the Evaluate panel, either step once (F10/F11) or type the variable name in the Debug Console to see the updated value.

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
