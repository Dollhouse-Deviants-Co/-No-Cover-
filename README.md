# No Cover

![No Cover — Pinkie playing peek-a-boo: eyes covered on the left, eyes open on the right, No Cover in the middle](assets/cover.webp)

**A simple tool that everyone from AAA websites to fledgling website builders should consider: fail the build when a fixed or floating element covers readable text or a tappable control.**

A floating banner sitting on top of a button is a ship-blocker, not a polish note. If it covered a "send me a million dollars" button, you'd be broke forever. This tool makes sure that never ships.

The cover is Pinkie playing peek-a-boo: at first her eyes are covered, then her hands open and her eyes are out. **No Cover!** The two frames are in `assets/` — `icon-covered.webp` (eyes covered) and `icon.webp` (eyes open) — and `cover.webp` is the two of them side by side with No Cover in the middle.

## The story

On [dollhousedeviants.com](https://dollhousedeviants.com), a fixed "donate to The Trevor Project" banner sat on top of the hero paragraph on mobile — and, on desktop, on top of a Hub card. It looked amateur, and there was no check catching it: lint and build only verify types and compilation, not that a floating element sits on top of content. So the rule became a standing SOP — *nothing fixed, floating, or overlaying may cover readable text, a button, or a tappable control at any viewport width* — and then the SOP became this tool, so the rule enforces itself.

## Install

```bash
npm install -g no-cover
# or run it without installing:
npx no-cover https://example.com
```

Requires Node 18+. The first run downloads a headless Chromium (via Playwright).

Free and open source (MIT) here. Also available as a supported $0.99 download on [dollhousedeviants.com](https://dollhousedeviants.com) (listing coming soon).

## Usage

```bash
no-cover https://example.com
no-cover ./dist/index.html --widths 360,1280
no-cover https://example.com --json --fail-on high
no-cover https://example.com --screenshots ./no-cover-shots
no-cover https://example.com --sweep   # bulletproof: every odd width, five scroll positions
```

It loads the page at each viewport width (default `320,360,375,390,412,430,768,1024,1280,1440,1920`), scrolls to the top, middle and bottom, and reports every `position: fixed` element sitting on top of readable text or a tappable control.

```
no-cover 0.2.0 — https://example.com

FAIL — 1 ship-blocker (a covered tappable control).

  [360px, scrolled bottom] div#promo-banner (fixed, 280x76 at 64,708) covers:
    BLOCKER control button#million-btn (100% covered) — "Send me a million dollars"

Fix: shrink the overlay on small screens, move it off the content,
or give the page padding so content scrolls clear of it.
```

Exit code `0` when nothing is covered, `1` when a finding meets the `--fail-on` threshold. Use it in CI and a covered button can never ship again:

```yaml
# GitHub Actions
- run: npx no-cover https://staging.example.com --widths 360,1280
```

## Bulletproof: the odd sizes and the hidden covers

For $0.99 it has to catch everything — including the covers that only exist at one width, and the ones hiding where a plain DOM query never looks.

- **Broad default widths.** Eleven widths out of the box (`320,360,375,390,412,430,768,1024,1280,1440,1920`), covering phones, tablets, laptops and desktops — including the odd sizes where a cover only appears at one width. A banner that only overlaps the button at 412px is caught by the default run; a narrow `--widths 360,1280` misses it entirely. Proved by `test/fixture-odd.html` (see `npm test`).
- **`--sweep`.** The exhaustive mode: twenty-one widths (`337,451,599,713,913,1117,1366,1536,1680,2048` on top of the defaults) and five scroll positions per width (top, 25%, middle, 75%, bottom) — for the screens you only find out about after someone resizes their window to a shape you never thought of. The sweep once caught real covers in the project's own "clean" fixture at 320px and 430px that the default widths missed; the fixture was fixed and the sweep now passes on it.
- **Shadow DOM.** The probe walks into shadow roots, so a fixed banner inside a web component is still caught. Proved by `test/fixture-shadow.html`.
- **`--wait <ms>`.** Waits after load and after each scroll, so a banner that slides in late is still caught (default 400ms).

## How it decides

- **HIGH (ship-blocker, fails the run by default):** a fixed element covers a tappable control — `a`, `button`, `input`, `select`, `textarea`, `label`, `[role="button"]`, `[role="link"]`. Any cover counts, even a sliver: a button you can only tap half of is a button you cannot trust.
- **MEDIUM (warning):** a fixed element covers more than 30% of a readable text block (`p`, `h1–h6`, `li`, `td`, `th`, `figcaption`). Reported, but fails the run only with `--fail-on any`.
- **Only `position: fixed` is checked, by design.** A `sticky` element reserves layout space and the content scrolls out from under it — a sticky header covering a sliver of a scrolling paragraph is normal web behaviour, and flagging it would drown the real findings.
- **`pointer-events: none` overlays are never flagged.** They cannot block a tap, so they cannot cover a button.
- Detection uses `document.elementFromPoint` on a grid over each intersection, so it reports what is *actually on top* in the rendered page — not what the DOM order suggests.

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--widths <list>` | `320,360,375,390,412,430,768,1024,1280,1440,1920` | Viewport widths to check |
| `--height <px>` | `800` | Viewport height |
| `--sweep` | — | Exhaustive mode: odd widths + five scroll positions per width |
| `--wait <ms>` | `400` | Wait after load and after each scroll, for delayed banners |
| `--json` | — | Machine-readable JSON instead of the report |
| `--screenshots <dir>` | — | Save an annotated screenshot per width (overlay red, covered element yellow) |
| `--fail-on <high\|any>` | `high` | Which findings fail the run |
| `--timeout <ms>` | `30000` | Page load timeout |

## The deliberate exception

A deliberate, semi-opaque, in-your-face banner is **not** a cover: the content scrolls out from under it, and the semi-opacity lets you see something is underneath. Mark such an overlay so the tool skips it:

```html
<div data-no-cover="exempt" class="fixed bottom-4 right-4 ...">
  <!-- your in-your-face banner -->
</div>
```

This is a one-off for a deliberate prominent CTA (the standing example is a donate banner the site owner wants prominent on purpose), not a loophole — an opaque overlay hiding a button is still a ship-blocker, and the exemption belongs on the overlay itself, never on the content it covers.

## What it does not do

- It does not check `sticky` elements (see above), `absolute` elements, or off-screen content. Iframes are out of scope (cross-origin frames cannot be inspected from the page).
- It does not judge whether an overlay is *supposed* to be there (a cookie banner is fine — until it covers the checkout button). A deliberate, semi-opaque, in-your-face banner is not a cover: mark it `data-no-cover="exempt"` and the tool skips it (see "The deliberate exception" above).
- It does not replace a human looking at the page. It catches the cover; a person still decides the fix.

## Tests

```bash
npm test            # all six fixture checks
npm run test:odd    # the 412px-only cover — caught by the default widths
npm run test:shadow  # the banner hidden in a web component's shadow root
```

## The SOP

> **No-cover SOP:** NOTHING fixed, floating, or overlaying may cover readable text, a button, or a tappable control at ANY viewport width — especially mobile. A floating element sitting on top of a button is a ship-blocker, not a polish note. Fixed CTAs stay compact on small screens, the page keeps bottom padding so content scrolls clear, and EVERY fixed/overlay element gets checked on a real mobile-width viewport before it ships. It feels amateur if we ship a cover.

## License

MIT. Free for anyone, anything, anywhere — including the AAA websites that could use it.
