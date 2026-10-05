import { expect, test } from "@playwright/test";

for (const state of [
  {
    story: "routes/history/EmptyHistory",
    text: "Your conversions will appear here.",
    name: "empty-history",
  },
  { story: "routes/history/ConversionHistory", text: "Open audiobook", name: "conversion-history" },
]) {
  test(`renders ${state.name}`, async ({ mount }) => {
    const component = await mount(state.story);
    await expect(component.getByText(state.text, { exact: true })).toBeVisible();
    await expect(component).toHaveScreenshot(`${state.name}.png`);
  });
}

test("history pagination appends a distinct page and removes Load more", async ({ mount }) => {
  const component = await mount("routes/history/ConversionHistory");
  await expect(component.getByRole("link", { name: "Open audiobook" })).toHaveCount(1);
  await component.getByRole("button", { name: "Load more" }).click();
  await expect(component.getByText("Another private audiobook", { exact: true })).toBeVisible();
  await expect(component.getByRole("link", { name: "Open audiobook" })).toHaveCount(2);
  await expect(component.getByRole("button", { name: "Load more" })).not.toBeVisible();
});

test("does not poll settled empty conversion history", async ({ mount, page }) => {
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/account/conversions") requests += 1;
  });
  await page.clock.install();
  const component = await mount("routes/history/EmptyHistory");
  await expect(
    component.getByText("Your conversions will appear here.", { exact: true }),
  ).toBeVisible();
  expect(requests).toBeGreaterThan(0);
  const settledRequests = requests;
  await page.clock.fastForward(16_000);
  expect(requests).toBe(settledRequests);
});
