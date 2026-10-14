import { chromium, _electron } from "playwright-core";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
for (const route of ["/", "/downloads", "/distros", "/submit"]) {
  await page.goto("http://127.0.0.1:4310" + route);
  await page.locator("h1").waitFor();
  if (route === "/")
    await page.screenshot({
      path: ".data/website-preview.png",
      fullPage: true,
    });
}
await page.getByLabel("Distribution name").fill("Local smoke-test distro");
await page
  .getByLabel("What makes it different?")
  .fill("Temporary QA entry, never approved.");
await page.getByLabel("Project or release page").fill("https://example.com");
await page.getByLabel("Maintainer contact").fill("qa@example.com");
await page.getByRole("button", { name: "Submit for review" }).click();
await page.getByRole("status").filter({ hasText: "Pending review" }).waitFor();
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:4310");
if (
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
)
  throw Error("Mobile overflow");
await browser.close();
const app = await _electron.launch({
  args: ["apps/desktop/main.cjs"],
  cwd: process.cwd(),
});
const win = await app.firstWindow();
await win.getByText("No builds imported yet.").waitFor();
await win.screenshot({ path: ".data/desktop-preview.png" });
await app.close();
if (errors.length) throw Error(errors.join("\n"));
console.log(
  "Website routes, submission, mobile layout, and desktop startup passed.",
);
