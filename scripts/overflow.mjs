/** Prints the elements that exceed the viewport width, deepest first. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const executablePath = CANDIDATES.find((p) => existsSync(p));
const route = process.argv[2] ?? "/";
const width = Number(process.argv[3] ?? 390);

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width, height: 900 } });
await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });

const result = await page.evaluate((limit) => {
  const doc = document.documentElement;
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > doc.clientWidth + 1 || r.left < -1) {
      const style = getComputedStyle(el);
      out.push({
        depth: (() => {
          let d = 0;
          let n = el;
          while ((n = n.parentElement)) d += 1;
          return d;
        })(),
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 110),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        overflowX: style.overflowX,
        whiteSpace: style.whiteSpace,
        text: (el.textContent || "").trim().slice(0, 40),
      });
    }
  }
  out.sort((a, b) => b.depth - a.depth);
  return { clientWidth: doc.clientWidth, scrollWidth: doc.scrollWidth, items: out.slice(0, limit) };
}, 12);

console.log(JSON.stringify(result, null, 2));
await browser.close();
