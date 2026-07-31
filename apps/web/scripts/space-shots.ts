/* 太空场景分段验收：按滚动进度比例拍 7 张（转场为定时动画，需等待落定） */
import { chromium } from "playwright";

const stops: Array<[string, number, number]> = [
  ["space-1-orbit", 0, 4600],
  ["space-2-approach", 0.2, 2400],
  ["space-3-window", 0.42, 2400],
  ["space-4-through", 0.62, 2400],
  ["space-5-world2", 0.72, 1200],
  ["space-6-monolith", 0.85, 2400],
  ["space-7-finale", 1.0, 2400]
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
const maxScroll = await page.evaluate(() => {
  const s = document.querySelector<HTMLElement>("#root > div");
  return s ? s.scrollHeight - s.clientHeight : 0;
});
console.log("maxScroll", maxScroll);
for (const [name, p, wait] of stops) {
  await page.evaluate(
    ({ top }) => {
      const s = document.querySelector<HTMLElement>("#root > div");
      if (s) s.scrollTop = top;
    },
    { top: Math.round(maxScroll * p) }
  );
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `../../test-results/${name}.png` });
  console.log("shot", name);
}
await browser.close();
