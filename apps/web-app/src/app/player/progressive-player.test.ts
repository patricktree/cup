import { expect, test } from "@playwright/test";

test("requests speech synthesis lookahead immediately in parallel, deduplicates ticks, and keeps paused completions cached", async ({
  mount,
}) => {
  const component = await mount("app/player/progressive-player/SpeechSynthesisLookahead");
  const requested = component.getByRole("status", { name: "Requested units" });
  await component.getByRole("button", { name: "Play", exact: true }).click();
  await expect(requested).toHaveText("0,1,2");
  await component.getByRole("button", { name: "Complete 0", exact: true }).click();
  await expect(requested).toHaveText("0,1,2");
  await component.getByRole("button", { name: "Tick", exact: true }).click();
  await expect(requested).toHaveText("0,1,2");
  await component.getByRole("button", { name: "Pause", exact: true }).click();
  await component.getByRole("button", { name: "Complete 2", exact: true }).click();
  await component.getByRole("button", { name: "Complete 1", exact: true }).click();
  await expect(component.getByRole("status", { name: "Playing" })).toHaveText("false");
  await component.getByRole("button", { name: "Play", exact: true }).click();
  await expect(requested).toHaveText("0,1,2");
  await component.getByRole("button", { name: "Seek 4", exact: true }).click();
  await expect(requested).toHaveText("0,1,2,4,5,6");
  await component.getByRole("button", { name: "Complete 4", exact: true }).click();
  await expect(requested).toHaveText("0,1,2,4,5,6");
});

test("a speculative failure surfaces at its segment and needs explicit retry", async ({
  mount,
}) => {
  const component = await mount("app/player/progressive-player/SpeechSynthesisLookahead");
  const requested = component.getByRole("status", { name: "Requested units" });
  await component.getByRole("button", { name: "Play", exact: true }).click();
  await component.getByRole("button", { name: "Complete 0", exact: true }).click();
  await expect(requested).toHaveText("0,1,2");
  await component.getByRole("button", { name: "Fail 1", exact: true }).click();
  await component.getByRole("button", { name: "Complete 2", exact: true }).click();
  await expect(component.getByRole("status", { name: "Playing" })).toHaveText("true");
  await expect(requested).toHaveText("0,1,2");
  await component.getByRole("button", { name: "Seek 1", exact: true }).click();
  await expect(component.getByRole("status", { name: "Playing" })).toHaveText("false");
  await expect(component.getByRole("status", { name: "Error" })).toHaveText("Segment failed.");
  await component.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(requested).toHaveText("0,1,2,1,3");
});

test("paused initial load and seeking generate only the selected unit without autoplay", async ({
  mount,
}) => {
  const component = await mount("app/player/progressive-player/SpeechSynthesisLookahead");
  const requested = component.getByRole("status", { name: "Requested units" });
  await expect(requested).toHaveText("0");
  await component.getByRole("button", { name: "Seek 4", exact: true }).click();
  await expect(requested).toHaveText("0,4");
  await component.getByRole("button", { name: "Complete 0", exact: true }).click();
  await component.getByRole("button", { name: "Complete 4", exact: true }).click();
  await expect(component.getByRole("status", { name: "Playing" })).toHaveText("false");
  await expect(requested).toHaveText("0,4");
  await component.getByRole("button", { name: "Play", exact: true }).click();
  await expect(requested).toHaveText("0,4,5,6");
});
