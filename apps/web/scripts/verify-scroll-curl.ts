import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Page } from "playwright";

const HOME_URL = process.env.MAPLE_HOME_URL ?? "http://127.0.0.1:5173/";
const HOME_THEME = process.env.MAPLE_HOME_THEME === "light" || process.env.MAPLE_HOME_THEME === "dark"
  ? process.env.MAPLE_HOME_THEME
  : undefined;

interface CurlSnapshot {
  scrollTop: number;
  maxScroll: number;
  strength: number;
  filter: string;
  displacementScale: number;
  surfaceRect: { x: number; y: number; width: number; height: number };
}

async function readCurlSnapshot(page: Page): Promise<CurlSnapshot> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>("[data-home-scroll-viewport='true']");
    const surface = document.querySelector<HTMLElement>("[data-scroll-curl-surface='true']");
    const displacement = document.querySelector("feDisplacementMap");
    if (!viewport || !surface || !displacement) throw new Error("Scroll curl DOM is missing");
    const rect = surface.getBoundingClientRect();
    return {
      scrollTop: viewport.scrollTop,
      maxScroll: viewport.scrollHeight - viewport.clientHeight,
      strength: Number(surface.dataset.scrollCurlStrength ?? 0),
      filter: getComputedStyle(surface).filter,
      displacementScale: Number(displacement.getAttribute("scale") ?? 0),
      surfaceRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  });
}

async function verifyViewport(
  page: Page,
  name: "desktop" | "mobile"
): Promise<{ before: CurlSnapshot; during: CurlSnapshot; after: CurlSnapshot; screenshots: string[] }> {
  if (HOME_THEME) {
    await page.addInitScript((theme: string) => {
      localStorage.setItem("maple.desktop.theme", theme);
    }, HOME_THEME);
  }
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForSelector("[data-scroll-curl-surface='true']", { timeout: 20_000 });
  await page.waitForTimeout(1_200);

  const paths = {
    before: join(tmpdir(), `maple-scroll-curl-${HOME_THEME ?? "system"}-${name}-before.png`),
    during: join(tmpdir(), `maple-scroll-curl-${HOME_THEME ?? "system"}-${name}-during.png`),
    after: join(tmpdir(), `maple-scroll-curl-${HOME_THEME ?? "system"}-${name}-after.png`)
  };

  const before = await readCurlSnapshot(page);
  if (before.maxScroll <= 0) throw new Error(`${name}: home viewport is not scrollable`);
  if (before.strength !== 0 || before.filter !== "none") {
    throw new Error(`${name}: curl must be inactive before scrolling`);
  }
  await page.screenshot({ path: paths.before });

  await page.mouse.move(page.viewportSize()!.width / 2, page.viewportSize()!.height * 0.62);
  await page.mouse.wheel(0, Math.min(720, before.maxScroll));
  await page.waitForFunction(
    () => Number(document.querySelector<HTMLElement>("[data-scroll-curl-surface='true']")?.dataset.scrollCurlStrength ?? 0) > 0.008,
    undefined,
    { timeout: 4_000 }
  );

  const during = await readCurlSnapshot(page);
  if (during.filter === "none" || during.displacementScale <= 0) {
    throw new Error(`${name}: curl filter did not activate while scrolling`);
  }
  await page.screenshot({ path: paths.during });

  await page.waitForFunction(
    () => document.querySelector<HTMLElement>("[data-scroll-curl-surface='true']")?.style.filter === "none",
    undefined,
    { timeout: 4_000 }
  );
  const after = await readCurlSnapshot(page);
  if (after.strength !== 0 || after.filter !== "none") {
    throw new Error(`${name}: curl filter did not settle back to its idle state`);
  }
  await page.screenshot({ path: paths.after });

  return { before, during, after, screenshots: Object.values(paths) };
}

const browser = await chromium.launch();
try {
  const desktopPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  const mobilePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true
  });
  const errors: string[] = [];
  for (const page of [desktopPage, mobilePage]) {
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  }

  const desktop = await verifyViewport(desktopPage, "desktop");
  const mobile = await verifyViewport(mobilePage, "mobile");
  if (errors.length > 0) throw new Error(`Browser errors:\n${errors.join("\n")}`);

  console.log(JSON.stringify({ desktop, mobile }, null, 2));
} finally {
  await browser.close();
}
