---
name: no-cover-audit
description: Audit a web page for fixed or floating elements covering readable text or a tappable control, using the no-cover CLI. Use when a page is about to ship, when a banner/CTA/toast/modal was added or moved, when a mobile screenshot shows text or a button hidden under something, or when the user asks for a no-cover / overlay / cover check. Fails the run on a covered control (the ship-blocker); reports covered text as a warning.
---

# No-cover audit

The rule, as a standing SOP: **NOTHING fixed, floating, or overlaying may cover readable text, a button, or a tappable control at ANY viewport width — especially mobile.** A floating element sitting on top of a button is a ship-blocker, not a polish note. It feels amateur if we ship a cover.

## Run the audit

Use the `no-cover` CLI (Node 18+, Playwright/Chromium — the first run downloads a headless Chromium):

```bash
npx no-cover <url-or-file>
```

- `<url-or-file>` is a live URL or a local HTML file (`./dist/index.html` works).
- Default widths `320,360,375,390,412,430,768,1024,1280,1440,1920` cover phones, tablets, laptops and desktops — including the odd sizes where a cover only appears at one width. A banner that only overlaps the button at 412px is caught by the default run; a narrow `--widths 360,1280` misses it. Add `--height 800` to change the viewport height.
- `--sweep` is the bulletproof mode: twenty-one widths (the defaults plus `337,451,599,713,913,1117,1366,1536,1680,2048`) and five scroll positions per width (top, 25%, middle, 75%, bottom) — for the screens you only find out about after someone resizes their window to a shape you never thought of.
- `--wait <ms>` waits after load and after each scroll, so a banner that slides in late is still caught (default 400ms).
- `--json` prints machine-readable findings. `--screenshots <dir>` saves an annotated screenshot per width (overlay outlined red, covered element yellow).
- Exit code `0` = nothing covered. Exit code `1` = a ship-blocker (a covered tappable control) by default; `--fail-on any` also fails on covered text.

## Read the result

- **BLOCKER (high):** a fixed element covers a tappable control (`a`, `button`, `input`, `select`, `textarea`, `label`, `[role="button"]`, `[role="link"]`). Any cover counts, even a sliver. This fails the run and blocks the ship. Fix it before anything else.
- **warn (medium):** a fixed element covers more than 30% of a readable text block (`p`, `h1–h6`, `li`, `td`, `th`, `figcaption`). Reported as a warning; it fails the run only with `--fail-on any`.
- Each finding names the viewport width, the scroll position (top / middle / bottom), the overlay (selector, position, size, coordinates) and what it covers (selector, kind, % covered, text).

## What the tool does and does not check

- Only `position: fixed` is checked, by design. A `sticky` element reserves layout space and content scrolls out from under it — a sticky header covering a sliver of a scrolling paragraph is normal, and flagging it would drown the real findings.
- `pointer-events: none` overlays are never flagged: they cannot block a tap.
- The probe walks into shadow roots, so a fixed banner inside a web component is still caught.
- It does not check `absolute` elements, off-screen content, or whether an overlay is *supposed* to be there. A cookie banner is fine — until it covers the checkout button. A deliberate, semi-opaque, in-your-face banner is not a cover: mark it `data-no-cover="exempt"` and the tool skips it. That is a one-off for a deliberate prominent CTA, not a loophole — an opaque overlay hiding a button is still a ship-blocker, and the exemption belongs on the overlay itself, never on the content it covers.
- It does not replace looking at the page. It catches the cover; a person still decides the fix.

## Fix a finding

Pick the smallest fix that uncovers the content:

1. **Shrink the overlay on small screens** — smaller pill/button, tighter corner offsets (the `max-sm:` / `md:` size pattern). This is the usual fix for a fixed CTA that is too big on phones.
2. **Move it off the content** — a different corner, or a different breakpoint where it stops being fixed.
3. **Give the page padding so content scrolls clear** — bottom padding (`pb-32` on main) so the last content can scroll above a fixed bottom element.
4. **Make it dismissible** — an X button (persist the dismissal when it makes sense) so a visitor can always uncover what is underneath.

After the fix, re-run the audit on the same URL at the same widths and confirm exit code `0` (or only warnings, with `--fail-on any` if text matters for this page).

## When to run it

- Before any deploy that adds, moves, resizes or re-styles a fixed element (banner, toast, menu, modal, CTA, chat widget, cookie notice).
- When a mobile screenshot shows text or a button hidden under something.
- In CI on every deploy to staging/production, so a covered button can never ship again:

```yaml
- run: npx no-cover https://staging.example.com --widths 360,1280
```

## Test it

The repo ships six fixture checks. The failing one must exit `1` (a fixed banner covers the "Send me a million dollars" button at 360px); the clean one must exit `0`:

```bash
npm test              # all six fixture checks
npm run test:fixture  # failing fixture — must exit 1
npm run test:clean    # clean fixture — must exit 0
npm run test:exempt   # exempt fixture (same banner, data-no-cover="exempt") — must exit 0
npm run test:odd      # the 412px-only cover — caught by the default widths, must exit 1
npm run test:odd-narrow  # same fixture at 360/1280 only — must exit 0 (the cover only exists at 412px)
npm run test:shadow   # banner hidden in a web component's shadow root — must exit 1
```
