/* 移动端抽检：hero / 范式 / 产品 / 终幕 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
const maxScroll = await page.evaluate(() => {
  const scroller = document.querySelector<HTMLElement>("#root > div");
  return scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
});
console.log("mobile maxScroll", maxScroll);
const stops: Array<[string, number]> = [
  ["hpm-1-hero", 0],
  ["hpm-2-paradigm", Math.round(maxScroll * 0.45)],
  ["hpm-3-product", Math.round(maxScroll * 0.82)],
  ["hpm-4-finale", maxScroll]
];
for (const [name, y] of stops) {
  await page.evaluate((top) => {
    const scroller = document.querySelector<HTMLElement>("#root > div");
    if (scroller) scroller.scrollTop = top;
  }, y);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `test-results/${name}.png` });
  console.log("shot", name);
}
await browser.close();
