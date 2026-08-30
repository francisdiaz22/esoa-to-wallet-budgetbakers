# Accessibility smoke checklist

> Run on synthetic demo data only. Record pass/fail only, no sensitive data.

- [x] **Keyboard:** Import → history → provider test → categorize → review edit → approval → dry-run → confirmation → results → export → clear all operate without mouse. Tab order logical, visible focus present.
- [x] **Drawer/dialog:** Detail drawer opens on button/Enter, focus transfers to drawer, Tab is trapped inside drawer, Escape closes without losing unsaved edits, focus returns to trigger. Commit confirmation is explicit and focus-contained.
- [x] **Live regions:** Asynchronous changes (importing, categorizing, wallet loading) announced via bounded `aria-live` without repeating transaction content or credentials.
- [x] **Contrast:** State colours are paired with text/icons and use the documented WCAG 2.2 AA palette.
- [x] **Reflow:** At 320 CSS pixels, all actions and values remain available without document-level horizontal scrolling; tables become labelled cards. This is enforced by `e2e/demo.spec.ts`.
- [x] **Screen reader semantics:** The browser accessibility tree exposes labelled import controls, table headers, filter controls, dialogs, status/live regions, and disabled states. VoiceOver remains a recommended release-candidate spot check, not a commit gate.
- [x] **Reduced motion:** With `prefers-reduced-motion` enabled, animation is not the sole progress signal; status text remains.

Result: **Pass — 2026-08-30.** Verified with the synthetic demo, semantic accessibility-tree inspection, keyboard-focused Playwright flows, and the 320px reflow regression test. No real financial data was used.

Browser matrix tested: bundled Chromium/Playwright and Codex in-app Chromium on macOS, standard viewport and 320px width. VoiceOver is retained as a release-candidate spot check.
