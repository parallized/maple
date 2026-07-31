/* 官网滚动叙事截图脚本：多个滚动深度各拍一张 */
import { chromium } from "playwright";

const shots: Array<{ name: string; scroll: number; wait?: number }> = [
  { name: "hp-1-hero-intro", scroll: 0, wait: 800 },
  { name: "hp-2-hero-settled", scroll: 0, wait: 3400 },
  { name: "hp-3-manifesto-mid", scroll: 2600, wait: 1600 },
  { name: "hp-4-manifesto-end", scroll: 3800, wait: 1600 },
  { name: "hp-5-paradigm-1", scroll: 4340, wait: 1600 },
  { name: "hp-6-paradigm-3", scroll: 5870, wait: 1600 },
  { name: "hp-6b-paradigm-4", scroll: 7400, wait: 1600 },
  { name: "hp-7-product-tilt", scroll: 8300, wait: 1600 },
  { name: "hp-8-product-flat", scroll: 9280, wait: 1600 },
  { name: "hp-9-finale", scroll: 99999, wait: 2200 }
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
/* 官网在自身 h-screen 容器内滚动（全局样式锁定 body），滚动目标是 #root 下的滚动容器 */
const maxScroll = await page.evaluate(() => {
  const scroller = document.querySelector<HTMLElement>("#root > div");
  return scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
});
console.log("maxScroll", maxScroll);
for (const shot of shots) {
  await page.evaluate(
    ({ y }) => {
      const scroller = document.querySelector<HTMLElement>("#root > div");
      if (scroller) scroller.scrollTop = Math.min(y, scroller.scrollHeight);
    },
    { y: shot.scroll }
  );
  await page.waitForTimeout(shot.wait ?? 1500);
  await page.screenshot({ path: `test-results/${shot.name}.png` });
  console.log("shot", shot.name);
}
await browser.close();
