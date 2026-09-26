/**
 * Visual QA helper. Captures dashboard routes at several viewports in both
 * colour schemes using the locally installed Edge/Chrome.
 *
 *   node scripts/shoot.mjs [route ...]
 */
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";
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
  : [
      "/",
      "/messages",
      "/conversations",
      "/providers",
      "/logs",
      "/settings",
    ];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });

for (const route of ROUTES) {
  for (const scheme of ["dark", "light"]) {
    for (const viewport of VIEWPORTS) {
      // Mobile shots only need one scheme to keep the sweep short.
      if (viewport.name === "mobile" && scheme === "light") continue;

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: scheme,
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(String(err)));

      const slug = route === "/" ? "overview" : route.replace(/^\//, "").replace(/\//g, "-");
      const name = `${slug}__${scheme}__${viewport.name}.png`;

      try {
        const response = await page.goto(`${BASE}${route}`, {
          waitUntil: "networkidle",
          timeout: 60_000,
        });
        await page.waitForTimeout(400);
        await page.screenshot({ path: resolve(OUT, name), fullPage: true });
        console.log(`✓ ${name}  [${response?.status()}]`);
        if (errors.length) {
          console.log(`  ! console errors: ${errors.slice(0, 4).join(" | ")}`);
        }
      } catch (error) {
        console.log(`✗ ${name}  ${error.message}`);
      }
      await context.close();
    }
  }
}

await browser.close();
console.log(`\nScreenshots in ${OUT}`);
