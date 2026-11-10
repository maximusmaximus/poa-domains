# Keyboard and screen-reader access

## Explorer

Main sections are real tabs on **desktop and mobile**, with one visible panel,
`aria-controls`, labelled `tabpanel`s and one tab stop per tablist. Left/Right
wrap; Home/End go to the ends; Enter/Space activate a tab. Panel content is
already loaded, so arrow navigation activates immediately without a new request.
Auction filters follow the same pattern and relabel their shared results panel.
Resources remain under Explore. URL-selected tabs, linked domain slugs, mobile
green dots and the footer remain intact.

The cart is a modal dialog: focus enters it, Tab/Shift+Tab stay inside, background
content is inert, and Escape/Close/backdrop close it. Focus returns to its opener,
or the floating cart button if the opener disappeared. Removing a cart row keeps
focus on the stable Close button. Detail uses a named non-modal dialog; Close or
Escape returns to its opener (the active tab is the fallback after a re-render).
Closing the topmost cart first leaves an underlying detail available to Escape.

Search has a short polite result announcement, updated only when the result
changes. Cart updates/copy feedback are polite atomic statuses. Ideas have a
headerless staggered word/emoji cards, stop on hover, touch, keyboard focus or manual scrolling, and
honor reduced motion. Inputs, links, buttons, selects and panels have visible
focus outlines. Hidden elements stay hidden even when a component sets display.
Links in footer text have underlines; tab color changes are immediate to avoid
brief low-contrast animation frames. Time wording remains hours/minutes.

Always-visible ℹ️ buttons sit at each module’s top-right, immediately left of close controls. The Check Availability label has inline help. Native keyboard/touch popovers stay inside their owning module for modal focus containment and removed-card cleanup. Escape dismisses help before its parent dialog; its close button restores focus. Required field labels, POA units, privacy warnings and actual errors/statuses remain visible. Simple emoji buttons preserve a descriptive aria-label and title; technical financial/signing controls retain words.

Network and service status use flat rows in one closable panel, with no top reopen button. A new page visit shows status again. Dismissing it never bypasses the network hold. Mobile title glyphs fit a ten-column viewport-wide grid; the header divider is removed.

## Read-only Pages

A keyboard-visible skip link moves focus to main. Decorative emoji are hidden
from assistive technology, not the surrounding link text. One polite atomic
refresh announcement combines availability, failure and network-observation
results; the three former competing live regions are ordinary readable text.
The independent local format checker's existing status remains unchanged. No
new requests, signing, fixture fallback or registry activation are introduced.

## Regression evidence

`test/ui-a11y-browser.mjs` runs axe-core through the pinned Playwright integration
on both UIs at 390px/1440px, all six explorer sections (including an enabled,
unpaused **GET-only synthetic escrow UI**) and the open cart. Serious/critical
violations fail the job; no rules, elements or finance screens are excluded.
Results and manual-review/incomplete items are written to
`test-results/a11y-results.json` and retained on CI failure.

Chromium, Firefox and WebKit each execute a search → add → copy flow **using only
keyboard input**, and verify tab wrapping/Home/End, modal boundaries/inert
cleanup, Escape, opener restoration and removed-opener fallback. Motion tests
cover pause persistence through shuffle, focus pause, reduced motion and resume.
Pages tests verify its skip target, single live region, hidden decorations and
strict public GET-only transport. No real PoA request or signed account read is
used. Existing component tests still exercise the closed Shadow DOM format
checker; axe alone cannot certify its closed tree or full WCAG conformance.

The new `browser-a11y` job runs in parallel in the existing pinned Playwright
container, uses the shared build artifact and participates in the coverage gate.
Both Node unit legs include structural/APG tests. Existing tests now select the
actual desktop tab before interacting; no previous assertions, escrow suites or
coverage lanes are dropped.

No escrow implementation/configuration/existing test is edited. Deployment uses
the unchanged production gate and exact live-policy checks. Per Max's 9:58 PM
PST instruction, intermittent upstream freshness `held=true` is informational,
not an ALERT, when enabled/unpaused wallet/limits, all policy bindings, secret
binding types and REGISTRY are unchanged. Binding or health/UI/MCP failure still
requires an immediate stop/rollback.

References: [WAI tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/),
[modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/),
[Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing).
