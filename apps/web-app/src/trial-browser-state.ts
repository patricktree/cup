import { z } from "zod";

export const trialBrowserState = { getLastGrantId, setLastGrantId, clearLastGrantId };

const TRIAL_BROWSER_STATE_KEY = "cup_trial_browser_state";

const trialBrowserStateSchema = z.object({
  lastGrantId: z.string(),
});

function getLastGrantId(): string | null {
  const value = window.localStorage.getItem(TRIAL_BROWSER_STATE_KEY);
  if (!value) return null;
  return trialBrowserStateSchema.parse(JSON.parse(value)).lastGrantId;
}

function setLastGrantId(grantId: string): void {
  window.localStorage.setItem(TRIAL_BROWSER_STATE_KEY, JSON.stringify({ lastGrantId: grantId }));
}

function clearLastGrantId(): void {
  window.localStorage.removeItem(TRIAL_BROWSER_STATE_KEY);
}
