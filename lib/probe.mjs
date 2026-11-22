/**
 * no-cover — in-page probe.
 *
 * Runs inside the audited page (via page.evaluate). Finds every visible
 * position:fixed element and reports any readable text or tappable
 * control it is sitting on top of.
 *
 * Only `fixed` is checked, by design. A `sticky` element reserves layout
 * space and the content scrolls out from under it — a sticky header
 * covering a sliver of a scrolling paragraph is normal web behaviour,
 * and flagging it would drown the real findings. A `fixed` element
 * reserves no space: it floats over content at every scroll position,
 * which is exactly the cover the SOP forbids.
 *
 * Rules (the No-cover SOP, as code):
 * - HIGH: the overlay covers a tappable control (a, button, input,
 *   select, textarea, [role=button], label). The user literally cannot
 *   tap it while it is underneath. This is the ship-blocker, and it
 *   fails the run by default.
 * - MEDIUM: the overlay covers more than 30% of a readable text block
 *   (p, h1-h6, li, td, th). Reported as a warning; fails the run only
 *   with --fail-on any.
 *
 * pointer-events:none overlays are never flagged: elementFromPoint
 * sees through them, so they cannot block a tap.
 */

export function probeNoCover() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Collect every element in the light DOM *and* inside shadow roots.
  // A fixed banner inside a web component is still a fixed banner — the
  // "most hidden" covers live in shadow DOM, and a plain
  // querySelectorAll('body *') never sees them.
  const allElements = (root) => {
    const out = [];
    const walk = (node) => {
      for (const el of node.querySelectorAll('*')) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return out;
  };
  const everyEl = allElements(document);

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return (
      cs.display !== 'none' &&
      cs.visibility !== 'hidden' &&
      parseFloat(cs.opacity) > 0
    );
  };

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' +
          el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  const textOf = (el) =>
    (el.innerText || el.value || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

  // 1. Fixed overlays, outermost only (a child of a fixed element is
  //    part of that overlay, not a separate one). An overlay marked
  //    data-no-cover="exempt" is a deliberate, in-your-face exception
  //    (the Trevor banner: semi-opaque, content scrolls out from under
  //    it, and you can see something is underneath) — skip it.
  const all = everyEl.filter((el) => {
    const pos = getComputedStyle(el).position;
    return (
      pos === 'fixed' &&
      isVisible(el) &&
      !el.closest('[data-no-cover="exempt"]')
    );
  });
  const overlays = all.filter((el) => {
    let p = el.parentElement;
    while (p) {
      if (all.includes(p)) return false;
      p = p.parentElement;
    }
    return true;
  });

  // 2. Content that must never be covered.
  const CONTROL_SEL =
    'a, button, input, select, textarea, label, [role="button"], [role="link"]';
  const TEXT_SEL = 'p, h1, h2, h3, h4, h5, h6, li, td, th, figcaption';
  const controls = everyEl.filter(
    (el) => el.matches(CONTROL_SEL) && isVisible(el)
  );
  const texts = everyEl.filter((el) => el.matches(TEXT_SEL) && isVisible(el));

  const findings = [];

  for (const ov of overlays) {
    const o = ov.getBoundingClientRect();
    // Clamp to the viewport: only what is on screen can cover anything.
    const ox0 = Math.max(0, o.left);
    const oy0 = Math.max(0, o.top);
    const ox1 = Math.min(vw, o.right);
    const oy1 = Math.min(vh, o.bottom);
    if (ox1 <= ox0 || oy1 <= oy0) continue;

    const position = getComputedStyle(ov).position;
    const covered = [];

    const check = (el, kind) => {
      if (el === ov || ov.contains(el)) return; // inside the overlay: not covered by it
      const r = el.getBoundingClientRect();
      const x0 = Math.max(ox0, r.left);
      const y0 = Math.max(oy0, r.top);
      const x1 = Math.min(ox1, r.right);
      const y1 = Math.min(oy1, r.bottom);
      if (x1 <= x0 || y1 <= y0) return;

      // Is the overlay the topmost thing at this point? elementFromPoint
      // retargets shadow-DOM content to its host, so a shadow banner
      // reports its host — walk the overlay's composed ancestry
      // (through shadow roots) to see if the point's topmost element
      // is one of its hosts.
      const topIsOverlay = (top) => {
        if (!top) return false;
        if (top === ov || ov.contains(top)) return true;
        let node = ov;
        while (node) {
          const root = node.getRootNode();
          if (root instanceof ShadowRoot) {
            if (root.host === top) return true;
            node = root.host;
          } else {
            return false;
          }
        }
        return false;
      };

      // Sample a grid over the intersection. A point counts as covered
      // when the topmost element there is the overlay (or one of its
      // children). pointer-events:none overlays never win this test.
      const w = x1 - x0;
      const h = y1 - y0;
      const stepX = Math.max(8, w / 5);
      const stepY = Math.max(8, h / 5);
      let hits = 0;
      let total = 0;
      for (let y = y0 + stepY / 2; y < y1; y += stepY) {
        for (let x = x0 + stepX / 2; x < x1; x += stepX) {
          total++;
          const top = document.elementFromPoint(x, y);
          if (topIsOverlay(top)) hits++;
        }
      }
      if (hits === 0) return;

      const intersectArea = w * h;
      const elArea = Math.max(1, r.width * r.height);
      const coveredPct = Math.round(
        (intersectArea / elArea) * (hits / total) * 100
      );

      if (kind === 'control') {
        // Any cover of a control is a ship-blocker, even a sliver:
        // a button you can only tap half of is a button you cannot trust.
        covered.push({
          kind,
          severity: 'high',
          selector: describe(el),
          text: textOf(el),
          coveredPct,
        });
      } else if (coveredPct >= 30) {
        covered.push({
          kind,
          severity: 'medium',
          selector: describe(el),
          text: textOf(el),
          coveredPct,
        });
      }
    };

    for (const c of controls) check(c, 'control');
    for (const t of texts) check(t, 'text');

    if (covered.length > 0) {
      findings.push({
        overlay: describe(ov),
        position,
        rect: {
          x: Math.round(o.x),
          y: Math.round(o.y),
          w: Math.round(o.width),
          h: Math.round(o.height),
        },
        covers: covered,
      });
    }
  }

  return findings;
}
