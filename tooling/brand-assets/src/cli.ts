#!/usr/bin/env node
import { Command } from "@commander-js/extra-typings";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import url from "node:url";
import sharp from "sharp";
import { z } from "zod";

const program = new Command()
  .name("cup-brand-assets-cli")
  .description("Manage Cup icons and splash images for web, Android, and iOS")
  .showHelpAfterError();

program
  .command("sync")
  .description("Generate web, Android, and iOS brand assets")
  .action(async () => {
    await generateAssets(false);
  });

program
  .command("check")
  .description("Check for stale generated assets without writing files")
  .action(async () => {
    await generateAssets(true);
  });

async function generateAssets(check: boolean): Promise<void> {
  const root = url.fileURLToPath(new URL("../../../", import.meta.url));
  const source = await fs.readFile(path.join(root, "tooling/brand-assets/assets/cup.svg"), "utf8");
  const darkSource = await fs.readFile(
    path.join(root, "tooling/brand-assets/assets/cup-dark.svg"),
    "utf8",
  );
  const outputs = z
    .array(
      z.object({
        path: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        markSize: z.number().positive(),
        transparent: z.boolean(),
      }),
    )
    .parse(
      JSON.parse(
        await fs.readFile(path.join(root, "tooling/brand-assets/assets/outputs.json"), "utf8"),
      ),
    );
  const stale: string[] = [];

  await writeOutput("apps/web-app/public/app/favicon.svg", source);
  await writeOutput("apps/web-app/public/app/favicon-dark.svg", darkSource);

  for (const output of outputs) {
    // Nest the complete SVG so the raster exports retain its viewBox and artwork.
    const artwork = source.replace(/<svg\b[^>]*>/, (tag) =>
      tag
        .replace(/\s(?:width|height)="[^"]*"/g, "")
        .replace(
          ">",
          ` width="${output.markSize}" height="${output.markSize}" x="${(output.width - output.markSize) / 2}" y="${(output.height - output.markSize) / 2}">`,
        ),
    );
    const canvas = `<svg xmlns="http://www.w3.org/2000/svg" width="${output.width}" height="${output.height}">${output.transparent ? "" : `<rect width="100%" height="100%" fill="#FFFFFF"/>`}${artwork}</svg>`;
    await writeOutput(output.path, await sharp(Buffer.from(canvas)).png().toBuffer());
  }

  // Android's vector format cannot represent arbitrary SVG. Reject unsupported artwork
  // rather than silently dropping shapes when the source icon changes.
  const viewBox = source.match(/viewBox="([^"]+)"/)?.[1];
  if (viewBox === undefined) {
    throw new Error("Cup SVG requires a viewBox.");
  }
  const [x, y, width, height] = viewBox.split(/\s+/).map(Number);
  if (x !== 0 || y !== 0 || !width || !height) {
    throw new Error("Cup SVG requires a viewBox starting at 0 0.");
  }
  const content = source.replace(/<svg\b[^>]*>|<\/svg>/g, "").trim();
  const paths = [...content.matchAll(/<path\s+([^>]+)\/>/g)];
  if (paths.length === 0 || content.replace(/<path\s+[^>]+\/>/g, "").trim()) {
    throw new Error("Android vector export supports only paths with d and fill attributes.");
  }
  const vectors = paths.map(([, attributes]) => {
    if (attributes === undefined) {
      throw new Error("Missing SVG path attributes.");
    }
    const data = attributes.match(/\bd="([^"]+)"/)?.[1];
    const fill = attributes.match(/\bfill="(#[\da-fA-F]{6})"/)?.[1];
    if (!data || !fill || attributes.replace(/\b(?:d|fill)="[^"]*"/g, "").trim()) {
      throw new Error("Android vector export supports only paths with d and hex fill attributes.");
    }
    return `        <path android:fillColor="${fill}" android:pathData="${data}" />`;
  });
  await writeOutput(
    "apps/mobile-app/android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from tooling/brand-assets/assets/cup.svg by cup-brand-assets-cli sync. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="${width}" android:viewportHeight="${height}">
    <group android:scaleX="0.6" android:scaleY="0.6" android:pivotX="${width / 2}" android:pivotY="${height / 2}">
${vectors.join("\n")}
    </group>
</vector>
`,
  );

  if (stale.length) {
    throw new Error(
      `Brand assets are out of date:\n${stale.join("\n")}\nRun pnpm brand-assets:sync from the repository root, then rerun pnpm brand-assets:check.`,
    );
  }
  console.log(
    check ? "Brand assets are up to date." : "Generated web, Android, and iOS brand assets.",
  );

  async function writeOutput(relativePath: string, value: string | Buffer): Promise<void> {
    const target = path.join(root, relativePath);
    const expected = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let actual;
    try {
      actual = await fs.readFile(target);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    if (actual?.equals(expected)) {
      return;
    }
    if (check) {
      stale.push(relativePath);
      return;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, expected);
  }
}

try {
  await program.parseAsync(process.argv);
} catch (error) {
  program.error(error instanceof Error ? error.message : String(error));
}
