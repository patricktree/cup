import { Toast } from "@base-ui/react/toast";

import { describeError } from "#src/errors.js";

/** Lets code outside React, such as the query client's caches, show toasts. */
export const toastManager = Toast.createToastManager();

/**
 * Reports a failure the current page can carry on without. Reporting again with the same `id`
 * replaces that toast instead of stacking another one.
 */
export function notifyError(
  error: unknown,
  { title = "That did not work.", id }: { title?: string | undefined; id?: string } = {},
) {
  const description = describeError(error, title);
  toastManager.add({
    id,
    type: "error",
    priority: "high",
    title: description.title,
    description: description.detail,
  });
}
