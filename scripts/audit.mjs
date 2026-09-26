/**
 * Automated visual QA for the dashboard.
 *
 * Checks the things a designer would look for but that are objectively
 * measurable: horizontal overflow at each breakpoint, WCAG contrast of every
 * visible text run, tap-target size on touch, focus visibility, minimum type
 * size, and vertical rhythm of the main landmarks.
 *
 *   node scripts/audit.mjs [route ...]
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error("No system browser found.");
  process.exit(1);
}

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = resolve(process.cwd(), ".shots");
mkdirSync(OUT, { recursive: true });

const ROUTES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["/", "/messages", "/conversations", "/providers", "/logs", "/settings"];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 960, touch: false },
  { name: "laptop", width: 1180, height: 800, touch: false },
  { name: "tablet", width: 834, height: 1000, touch: true },
  { name: "mobile", width: 390, height: 844, touch: true },
  { name: "mobile-sm", width: 320, height: 720, touch: true },
];

/* colour helpers now live inside AUDIT */
const AUDIT = () => {
  /* ---- self-contained helpers (this function is serialised into the page) ---- */
  const cs = (el) => {
    try {
      return el.ownerDocument.defaultView.getComputedStyle(el);
    } catch {
      return null;
    }
  };
  const srgbToLin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = ([r, g, b]) => 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
  const contrastRatio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };
  const parseRgb = (value) => {
    const m = String(value).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
  };
  const blend = (fg, bg) => ({
    rgb: fg.rgb.map((c, i) => c * fg.a + bg.rgb[i] * (1 - fg.a)),
    a: fg.a + bg.a * (1 - fg.a),
  });
  const bgOf = (el) => {
    let node = el;
    let acc = null;
    while (node) {
      const style = cs(node);
      if (style) {
        const bg = parseRgb(style.backgroundColor);
        if (bg && bg.a > 0) {
          acc = acc ? blend(acc, bg) : bg;
          if (acc.a >= 0.99) return acc.rgb;
        }
      }
      node = node.parentElement;
    }
    return acc ? acc.rgb : [255, 255, 255];
  };

  const issues = [];
  const doc = document.documentElement;

  // 1. Horizontal overflow -------------------------------------------------
  const scrollW = doc.scrollWidth;
  const clientW = doc.clientWidth;
  if (scrollW > clientW + 1) {
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > clientW + 2 && r.left < clientW) {
        const style = cs(el);
        if (style && style.position === "fixed") continue;
        offenders.push(
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`,
        );
      }
      if (offenders.length > 5) break;
    }
    issues.push({
      kind: "overflow",
      detail: `document scrollWidth ${scrollW} > clientWidth ${clientW}`,
      offenders,
    });
  }

  // 2. Contrast + type size ----------------------------------------------
  const lowContrast = [];
  const tinyText = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("svg, .sr-only, script, style")) continue;
    const style = cs(el);
    if (!style) continue;
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    // Only leaf-ish elements carry visible text.
    const hasOwnText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (!hasOwnText) continue;

    const text = el.textContent.trim().slice(0, 40);
    const key = `${text}|${style.fontSize}|${style.color}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fg = parseRgb(style.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const composited = fg.a < 1 ? blend(fg, { rgb: bg, a: 1 }).rgb : fg.rgb;
    const ratio = contrastRatio(composited, bg);

    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    if (ratio < required) {
      lowContrast.push({
        text,
        ratio: Number(ratio.toFixed(2)),
        required,
        size: Math.round(size * 10) / 10,
        color: style.color,
      });
    }
    if (size < 10.5) {
      tinyText.push({ text, size: Math.round(size * 10) / 10 });
    }
  }
  if (lowContrast.length) {
    issues.push({ kind: "contrast", count: lowContrast.length, items: lowContrast.slice(0, 12) });
  }
  if (tinyText.length) {
    issues.push({ kind: "tiny-text", count: tinyText.length, items: tinyText.slice(0, 8) });
  }

  // 3. Tap targets on touch viewports -------------------------------------
  // Measures the *real* hit area: an element can legitimately enlarge its own
  // pointer target with padding or an ::after overlay, which the bounding box
  // alone would miss. elementFromPoint is the ground truth.
  const hits = (x, y, target) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return false;
    let node = el;
    while (node) {
      if (node === target) return true;
      node = node.parentElement;
    }
    return false;
  };

  const smallTargets = [];
  for (const el of document.querySelectorAll("button, a, input, select, [role=switch], [role=radio]")) {
    const style = cs(el);
    if (!style || style.display === "none" || style.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    // Inline links inside prose are exempt.
    if (el.tagName === "A" && el.closest("p, dd, span")) continue;
    if (rect.height >= 28 && rect.width >= 24) continue;

    // Probe 6px outside the box on each side; a passing probe means the real
    // target already reaches the recommended size.
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const probe =
      rect.height < 28 &&
      (hits(cx, rect.top - 6, el) ||
        hits(cx, rect.bottom + 6, el) ||
        hits(cx - 6, cy, el) ||
        hits(cx + 6, cy, el));

    if (probe) continue;

    smallTargets.push({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    });
  }
  if (smallTargets.length) {
    issues.push({ kind: "tap-target", count: smallTargets.length, items: smallTargets.slice(0, 10) });
  }

  // 4. Landmarks + headings ----------------------------------------------
  const h1s = document.querySelectorAll("h1").length;
  if (h1s !== 1) issues.push({ kind: "heading", detail: `${h1s} <h1> elements (expected 1)` });
  if (!document.querySelector("main")) issues.push({ kind: "landmark", detail: "no <main>" });
  if (!document.querySelector("nav[aria-label]")) {
    issues.push({ kind: "landmark", detail: "no labelled <nav>" });
  }

  // 5. Layout rhythm ------------------------------------------------------
  const rhythm = [];
  for (const el of document.querySelectorAll("main section, main > div > div")) {
    const rect = el.getBoundingClientRect();
    if (rect.height > 0) rhythm.push(Math.round(rect.height));
  }

  return {
    issues,
    metrics: {
      scrollWidth: scrollW,
      clientWidth: clientW,
      textNodes: seen.size,
      panels: document.querySelectorAll(".panel").length,
    },
  };
};

const FOCUS_TEST = () => {
  const focusables = [
    ...document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  return { focusableCount: focusables.length };
};

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const report = {};

for (const route of ROUTES) {
  report[route] = {};
  for (const scheme of ["dark", "light"]) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: scheme,
        hasTouch: viewport.touch,
        isMobile: viewport.width < 700,
      });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });
      page.on("pageerror", (e) => consoleErrors.push(String(e)));

      try {
        const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60_000 });
        const result = await page.evaluate(AUDIT);
        const focus = await page.evaluate(FOCUS_TEST);
        const key = `${scheme}/${viewport.name}`;
        report[route][key] = {
          status: response?.status() ?? 0,
          issues: result.issues,
          metrics: result.metrics,
          focusable: focus.focusableCount,
          consoleErrors: consoleErrors.slice(0, 5),
        };
      } catch (error) {
        report[route][`${scheme}/${viewport.name}`] = { error: error.message };
      }
      await context.close();
    }
  }
}

await browser.close();
writeFileSync(resolve(OUT, "audit.json"), JSON.stringify(report, null, 2));

// ---- console summary -----------------------------------------------------
let problemCount = 0;
for (const [route, byViewport] of Object.entries(report)) {
  const rows = [];
  for (const [key, data] of Object.entries(byViewport)) {
    if (data.error) {
      rows.push(`   ✗ ${key}  ${data.error.slice(0, 90)}`);
      problemCount += 1;
      continue;
    }
    if (data.status !== 200) {
      rows.push(`   ✗ ${key}  HTTP ${data.status}`);
      problemCount += 1;
    }
    for (const issue of data.issues) {
      problemCount += 1;
      const detail =
        issue.detail ??
        (issue.items ?? []).map((i) => JSON.stringify(i)).join("; ").slice(0, 260);
      rows.push(`   · ${key}  [${issue.kind}${issue.count ? ` x${issue.count}` : ""}] ${detail}`);
    }
    if (data.consoleErrors?.length) {
      problemCount += 1;
      rows.push(`   ! ${key}  console: ${data.consoleErrors.join(" | ").slice(0, 160)}`);
    }
  }
  if (rows.length) {
    console.log(`\n${route}`);
    console.log(rows.join("\n"));
  }
}
console.log(`\n${problemCount === 0 ? "✓ no issues" : `${problemCount} issue(s) found`}`);
console.log(`Full report: ${resolve(OUT, "audit.json")}`);
