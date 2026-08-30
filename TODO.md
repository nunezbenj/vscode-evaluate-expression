# TODO / Roadmap

Working notes for development. Not packaged in the VSIX (see `.vscodeignore`).
User-facing requests and bugs live in [GitHub Issues](https://github.com/nunezbenj/vscode-evaluate-expression/issues).

## Next (1.5.0 candidates)


- [ ] **Clickable history** — dropdown or list of previous evaluations (with
      preview) instead of only Alt+Up/Down cycling. Consider pinning favorites.
- [ ] **Frame picker** — evaluate in a selected stack frame, not always the top
      frame (DAP already gives us the frames; UI is a small dropdown).
- [ ] **Settings for the new automatics** — opt-out toggles for auto-mode
      switching and smart-paste dedent, for users who want manual control.

## Later / ideas

- [ ] Watches: edit in place, remove single watch, reorder, persist per workspace
- [ ] Copy result as repr vs str toggle
- [ ] Evaluate on Ctrl+Enter from the editor selection without opening the panel
      (show result as notification/inline hover)
- [ ] JS/TS: investigate what locals persistence is possible per V8 limitations;
      document clearly in README
- [ ] Upstream ask: propose a VS Code extension API for refreshing the Variables
      view (would replace the goto workaround; see refreshVariablesPanel in
      src/dap.ts for why no API exists today)
- [ ] Localization of panel strings

## Done in 1.6.0

- [x] Step controls in the panel (Continue/Pause, Over/Into/Out), run-state aware

## Done in 1.5.0

- [x] Structured result tree — anchored on builtins.__eval_last__ so references
      survive the goto refresh; lazy child fetch via DAP variables, 100-per-page
- [x] Python expression mode unified onto the planner/harness engine

## Done in 1.4.2

- [x] Show program output (stdout/stderr) in the Result panel — captured from
      DAP output events during the evaluation (first user request, Gopal)

## Done in 1.4.0

- [x] Persist new locals in the paused frame (drop function wrapper; direct
      repl/exec via debugpy save_locals)
- [x] Auto-refresh Variables/Watches/Call Stack after evaluation (gotoTargets/goto
      round-trip on the current line)
- [x] Debug-toolbar button (calculator icon)
- [x] Smart paste (auto-dedent multi-line pastes)
- [x] Auto-switch to Statements mode for multi-line code
- [x] Clean tracebacks (hide pydevd/debugpy internal frames)
- [x] Editor placeholder with shortcut hints
- [x] Stable editor height + draggable divider between editor and Result
- [x] Separate Clear Code / Clear Result buttons
- [x] package-lock.json regenerated against registry.npmjs.org

## Maintenance notes

- Unit tests: `npm test` (mocha, `src/test/`). Runtime behavior of persistence
  and goto-refresh was verified against a live debugpy session with a raw DAP
  client; re-verify if debugpy majorly changes `evaluate`/`goto` semantics.
- Publishing: `vsce package` / `vsce publish`, or manual VSIX upload at
  marketplace.visualstudio.com/manage. Corporate proxy blocks npm on the work
  laptop (registry + TLS interception) — build/publish from an unrestricted
  network, or fix npm proxy + cafile first.
