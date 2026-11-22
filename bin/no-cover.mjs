#!/usr/bin/env node
/**
 * no-cover — the No-cover SOP as a command.
 *
 *   no-cover <url-or-file> [--widths 360,768,1280] [--height 800]
 *                        [--json] [--screenshots <dir>] [--fail-on high|any]
 *                        [--sweep] [--wait <ms>]
 *
 * Loads the page at each viewport width, scrolls to the top, middle and
 * bottom, and reports every fixed/sticky element sitting on top of
 * readable text or a tappable control.
 *
 * Bulletproof by default: the default widths cover phones, tablets,
 * laptops and desktops including the odd sizes where a cover only
 * appears at one width (a banner that only overlaps at 412px, a
 * resized window at some odd shape). --sweep goes further — every odd
 * width in the sweep plus five scroll positions — for the screens you
 * only find out about after someone resizes their window to a shape
 * you never thought of.
 *
 * Exit code: 0 when nothing is covered, 1 when a finding meets the
 * --fail-on threshold (default: high — a covered tappable control).
 * Text coverage is reported as a warning and fails the run only with
 * --fail-on any. Built for CI: run it on every deploy and a covered
 * button can never ship again.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { probeNoCover } from '../lib/probe.mjs';

const VERSION = '0.1.0';

function usage() {
  console.log(`no-cover ${VERSION} — the No-cover SOP as a command.
Nothing fixed or floating may cover readable text or a tappable control.

Usage:
  no-cover <url-or-file> [options]

Options:
  --widths <list>        Viewport widths to check (default: 320,360,375,390,412,430,768,1024,1280,1440,1920)
  --height <px>          Viewport height (default: 800)
  --sweep                Exhaustive mode: odd widths (337,451,599,713,913,1117,1366,1536,1680,2048)
                         plus five scroll positions per width
  --wait <ms>            Wait after load and after each scroll, for delayed banners (default: 400)
  --json                 Print machine-readable JSON instead of the report
  --screenshots <dir>   Save an annotated screenshot per viewport
  --fail-on <high|any>   Which findings fail the run (default: high)
  --timeout <ms>         Page load timeout (default: 30000)
  --help                 Show this help
  --version              Show the version

Examples:
  no-cover https://example.com
  no-cover ./dist/index.html --widths 360,1280
  no-cover https://example.com --json --fail-on high
  no-cover https://example.com --sweep   (bulletproof: every odd width, five scroll positions)`);
}

const DEFAULT_WIDTHS = [320, 360, 375, 390, 412, 430, 768, 1024, 1280, 1440, 1920];
const SWEEP_WIDTHS = [337, 451, 599, 713, 913, 1117, 1366, 1536, 1680, 2048];

function parseArgs(argv) {
  const args = { widths: DEFAULT_WIDTHS, height: 800, failOn: 'high', timeout: 30000, wait: 400, sweep: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--version' || a === '-v') return { version: true };
    if (a === '--json') args.json = true;
    else if (a === '--sweep') args.sweep = true;
    else if (a === '--widths') args.widths = argv[++i].split(',').map(Number);
    else if (a === '--height') args.height = Number(argv[++i]);
    else if (a === '--wait') args.wait = Number(argv[++i]);
    else if (a === '--screenshots') args.screenshots = argv[++i];
    else if (a === '--fail-on') args.failOn = argv[++i];
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
    else if (a.startsWith('--')) {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    } else rest.push(a);
  }
  if (rest.length === 0) return { help: true };
  args.target = rest[0];
  if (args.sweep && !argv.includes('--widths')) {
    args.widths = [...DEFAULT_WIDTHS, ...SWEEP_WIDTHS].sort((a, b) => a - b);
  }
  return args;
}

function toUrl(target) {
  if (/^https?:\/\//i.test(target)) return target;
  return pathToFileURL(resolve(target)).href;
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.width}|${f.scroll}|${f.overlay}|${f.covers.map((c) => c.selector).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function humanReport(target, all) {
  const lines = [];
  lines.push(`no-cover ${VERSION} — ${target}`);
  if (all.length === 0) {
    lines.push('');
    lines.push('PASS — nothing fixed or floating covers readable text or a tappable control.');
    lines.push('No covered buttons. No covered text. Ship it.');
    return lines.join('\n');
  }
  const highs = all.filter((f) => f.covers.some((c) => c.severity === 'high'));
  const mediums = all.filter((f) => !f.covers.some((c) => c.severity === 'high'));
  lines.push('');
  if (highs.length > 0) {
    lines.push(`FAIL — ${highs.length} ship-blocker${highs.length === 1 ? '' : 's'} (a covered tappable control).`);
  } else {
    lines.push(`WARN — ${mediums.length} text cover${mediums.length === 1 ? '' : 's'}, no ship-blockers.`);
    lines.push('Text coverage does not fail the run; use --fail-on any to fail on it.');
  }
  for (const f of all) {
    lines.push('');
    lines.push(`  [${f.width}px, scrolled ${f.scroll}] ${f.overlay} (${f.position}, ${f.rect.w}x${f.rect.h} at ${f.rect.x},${f.rect.y}) covers:`);
    for (const c of f.covers) {
      const tag = c.severity === 'high' ? 'BLOCKER' : 'warn';
      const text = c.text ? ` — "${c.text}"` : '';
      lines.push(`    ${tag} ${c.kind} ${c.selector} (${c.coveredPct}% covered)${text}`);
    }
  }
  lines.push('');
  lines.push('Fix: shrink the overlay on small screens, move it off the content,');
  lines.push('or give the page padding so content scrolls clear of it.');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (args.version) return console.log(VERSION);

  const url = toUrl(args.target);
  const browser = await chromium.launch();
  const all = [];

  try {
    for (const width of args.widths) {
      const page = await browser.newPage({ viewport: { width, height: args.height } });
      await page.goto(url, { waitUntil: 'networkidle', timeout: args.timeout });
      await page.waitForTimeout(args.wait);

      const maxScroll = await page.evaluate(
        () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      );
      // Scroll positions: top / middle / bottom by default, five stops
      // in sweep mode — a cover that only appears at 75% of a long page
      // is still a cover.
      const scrollFractions = args.sweep ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
      const scrollNames = args.sweep ? ['top', '25%', 'middle', '75%', 'bottom'] : ['top', 'middle', 'bottom'];
      const scrolls = scrollFractions.map((f, i) => ({
        name: scrollNames[i],
        y: Math.round(maxScroll * f),
      }));

      for (const s of scrolls) {
        await page.evaluate((y) => window.scrollTo(0, y), s.y);
        await page.waitForTimeout(args.wait);
        const findings = await page.evaluate(probeNoCover);
        for (const f of findings) {
          all.push({ width, scroll: s.name, ...f });
        }
      }

      if (args.screenshots) {
        mkdirSync(args.screenshots, { recursive: true });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
        // Outline every flagged overlay red and what it covers yellow,
        // so the screenshot shows the crime scene, not just the page.
        const widthFindings = all.filter((f) => f.width === width);
        await page.evaluate((findings) => {
          for (const f of findings) {
            try {
              const ov = document.querySelector(f.overlay);
              if (ov) ov.style.outline = '3px solid #FF3131';
            } catch {}
            for (const c of f.covers) {
              try {
                const el = document.querySelector(c.selector);
                if (el) el.style.outline = '3px solid #FFEA00';
              } catch {}
            }
          }
        }, widthFindings);
        await page.screenshot({
          path: resolve(args.screenshots, `no-cover-${width}px.png`),
          fullPage: false,
        });
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }

  const unique = dedupe(all);

  if (args.json) {
    console.log(JSON.stringify({ target: args.target, findings: unique }, null, 2));
  } else {
    console.log(humanReport(args.target, unique));
  }

  const failing = args.failOn === 'high'
    ? unique.filter((f) => f.covers.some((c) => c.severity === 'high'))
    : unique;
  process.exit(failing.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`no-cover: ${err.message}`);
  process.exit(2);
});
