# PyCharm-like Evaluate Expression

A VS Code / Cursor extension that provides a **multi-line Evaluate Expression panel** for debugging, inspired by PyCharm's Evaluate Expression dialog.

## Features

- **Multi-line code editor** — evaluate many lines at once, not just single expressions
- **Statement mode** — automatically wraps code in a function so `return`, loops, and multi-line logic work
- **Expression mode** — evaluate a single expression as-is
- **Watches** — add expressions to a watch list that auto-refreshes when the debugger stops
- **History** — navigate through previous evaluations with Alt+Up/Down
- **Works with any DAP debugger** — primary target is Python (debugpy), but the DAP protocol works with other languages too

## Usage

1. Start a debug session and pause at a breakpoint
2. Open the Evaluate panel: `Ctrl+Alt+E` (or Command Palette → "Evaluate: Open Panel")
3. Type multi-line code in the editor
4. Click **Evaluate** (or press `Ctrl+Enter`)
5. See the result in the output area

### Keybindings

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+E` | Open the Evaluate panel |
| `Ctrl+Alt+Enter` | Evaluate selected text from the editor |
| `Ctrl+Enter` | Evaluate (when focused in the panel's textarea) |
| `Alt+Up` / `Alt+Down` | Navigate evaluation history |

## Scoping Note

In **Statements mode**, code is wrapped in a function for execution. This means:
- **Mutations to existing objects** (e.g., `self.next = None`) work as expected
- **New local variables** created inside the snippet do NOT persist in the paused frame

## Known Limitations

- **Variables panel does not auto-refresh** after evaluating statements that mutate objects. VS Code does not expose an API for extensions to force-refresh the Variables panel without advancing execution. **Workaround:** after mutating a variable via the Evaluate panel, either step once (F10/F11) or type the variable name in the Debug Console to see the updated value.

## Development

```bash
npm install
npm run compile
# Press F5 in VS Code/Cursor to launch the Extension Development Host
```

## Requirements

- VS Code 1.85+ or Cursor
- A debug adapter that supports the DAP `evaluate` request (e.g., Python + debugpy)
