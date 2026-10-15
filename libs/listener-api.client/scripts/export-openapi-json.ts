import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

import { createListenerContractApp } from "@cup/listener-api.routes";

const OUTPUT_FILE_URL = new URL("../dist/create-audiobook-from-url-openapi.json", import.meta.url);

const app = createListenerContractApp();
const openApiDocument = app.getOpenAPIDocument({
  openapi: "3.0.0",
  info: { title: "create-audiobook-from-url listener API", version: "1.0.0" },
});
const outputPath = url.fileURLToPath(OUTPUT_FILE_URL);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(openApiDocument, null, 2)}\n`);
