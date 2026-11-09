import { defineConfig } from "oxlint";

import { config as repoConfig } from "@cup/config-oxlint/oxlint-base.js";

export default defineConfig({ extends: [repoConfig] });
