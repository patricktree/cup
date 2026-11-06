import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** The screen's rows of ink, separated from the next ones by an empty row, in design pixels. */
export type InkBand = { top: number; bottom: number; left: number; right: number };

export type BandComparison = {
  /** Absent when the other image has more bands than this one. */
  design: InkBand | undefined;
  rendered: InkBand | undefined;
  isWithinTolerance: boolean;
};

export type MeasuredElement = {
  tag: string;
  /** Its own text, or an input's placeholder. */
  label: string;
  rect: { x: number; y: number; width: number; height: number };
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  backgroundColor: string;
  opacity: string;
};

export type FidelityReport = {
  bands: BandComparison[];
  /** Share of the compared pixels that differ noticeably; text edges keep it above zero. */
  differingPixelRatio: number;
  loadedFonts: string[];
  elements: MeasuredElement[];
};

type FidelityCheckOptions = {
  designImagePath: string;
  /** Receives `report.json`, `rendered.png` and `overlay.png`. */
  reportDirectory: string;
  /** Rows the comparison skips, such as a device status bar drawn into the design. */
  ignoreTopPixels?: number;
};

/** A design tool and a browser rasterize an edge up to this far apart, so closer is no mismatch. */
const BAND_TOLERANCE_PIXELS = 1;

const PNG_SIGNATURE = "89504e470d0a1a0a";
/** The width and height of a PNG's first chunk (IHDR) follow the signature and the chunk header. */
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;

/** The viewport to render at, so that one CSS pixel equals one design pixel. */
export function readDesignImageSize(designImagePath: string): { width: number; height: number } {
  const image = fs.readFileSync(designImagePath);
  if (image.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
    throw new Error(`The design image must be a PNG: ${designImagePath}`);
  }
  return {
    width: image.readUInt32BE(PNG_WIDTH_OFFSET),
    height: image.readUInt32BE(PNG_HEIGHT_OFFSET),
  };
}

/**
 * Compares the page with the design's image. The page must render at the image's size, and should
 * at a device scale above 1: 1x text snaps to whole pixels, unlike the design's render, so the page
 * is scaled down to the image's size to compare like with like.
 */
export async function checkAgainstDesign(
  page: Page,
  { designImagePath, reportDirectory, ignoreTopPixels = 0 }: FidelityCheckOptions,
): Promise<FidelityReport> {
  const designSize = readDesignImageSize(designImagePath);
  const viewport = page.viewportSize();
  if (viewport?.width !== designSize.width || viewport.height !== designSize.height) {
    throw new Error(
      `The page must render at the design image's size, ${designSize.width}×${designSize.height}, not ${viewport?.width}×${viewport?.height}`,
    );
  }

  const renderedImage = await page.screenshot({ animations: "disabled" });
  const comparison = await page.evaluate(compareImagesInPage, {
    designImageUrl: toPngDataUrl(fs.readFileSync(designImagePath)),
    renderedImageUrl: toPngDataUrl(renderedImage),
    ignoreTopPixels,
  });
  // After the screenshot, which waits for the fonts that the page has started loading.
  const { loadedFonts, elements } = await page.evaluate(measureElementsInPage);

  // Without this, comparing no rows at all would report a match.
  if (comparison.designBands.length === 0) {
    throw new Error(`The fidelity check found no ink in the design below row ${ignoreTopPixels}`);
  }

  const bandCount = Math.max(comparison.designBands.length, comparison.renderedBands.length);
  const bands = Array.from({ length: bandCount }, (_, index) => {
    const design = comparison.designBands[index];
    const rendered = comparison.renderedBands[index];
    return {
      design,
      rendered,
      isWithinTolerance: isBandWithinTolerance(design, rendered),
    };
  });
  const report = {
    bands,
    differingPixelRatio: comparison.differingPixelRatio,
    loadedFonts,
    elements,
  };

  fs.mkdirSync(reportDirectory, { recursive: true });
  fs.writeFileSync(path.join(reportDirectory, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(reportDirectory, "rendered.png"), renderedImage);
  fs.writeFileSync(
    path.join(reportDirectory, "overlay.png"),
    Buffer.from(comparison.overlayUrl.replace("data:image/png;base64,", ""), "base64"),
  );

  return report;
}

/** One line per band and element, for a test run's output. */
export function formatFidelityReport(report: FidelityReport): string {
  return [
    `Differing pixels: ${(report.differingPixelRatio * 100).toFixed(2)}%`,
    `Loaded fonts: ${report.loadedFonts.join(", ") || "none"}`,
    "Bands (design → rendered):",
    ...report.bands.map(
      ({ design, rendered, isWithinTolerance }) =>
        `  ${isWithinTolerance ? "ok      " : "MISMATCH"} ${formatBand(design)} → ${formatBand(rendered)}`,
    ),
    "Elements:",
    ...report.elements.map(
      ({
        tag,
        label,
        rect,
        fontFamily,
        fontSize,
        fontWeight,
        lineHeight,
        letterSpacing,
        color,
        backgroundColor,
        opacity,
      }) =>
        `  <${tag}> "${label}" x=${rect.x} y=${rect.y} ${rect.width}×${rect.height} | ${fontFamily} ${fontSize}/${lineHeight} weight ${fontWeight} spacing ${letterSpacing} | color ${color} background ${backgroundColor} opacity ${opacity}`,
    ),
  ].join("\n");
}

function isBandWithinTolerance(
  design: InkBand | undefined,
  rendered: InkBand | undefined,
): boolean {
  if (design === undefined || rendered === undefined) {
    return false;
  }
  return (
    Math.abs(design.top - rendered.top) <= BAND_TOLERANCE_PIXELS &&
    Math.abs(design.bottom - rendered.bottom) <= BAND_TOLERANCE_PIXELS &&
    Math.abs(design.left - rendered.left) <= BAND_TOLERANCE_PIXELS &&
    Math.abs(design.right - rendered.right) <= BAND_TOLERANCE_PIXELS
  );
}

function formatBand(band: InkBand | undefined): string {
  return band === undefined
    ? "absent"
    : `y=${band.top}–${band.bottom} x=${band.left}–${band.right}`;
}

function toPngDataUrl(image: Buffer): string {
  return `data:image/png;base64,${image.toString("base64")}`;
}

/** Runs in the page, so it can use only its parameters and browser APIs. */
async function compareImagesInPage({
  designImageUrl,
  renderedImageUrl,
  ignoreTopPixels,
}: {
  designImageUrl: string;
  renderedImageUrl: string;
  ignoreTopPixels: number;
}) {
  /* The higher limit leaves out the antialiased edges of text. */
  const INK_DISTANCE = 60;
  const DIFFERENCE_DISTANCE = 90;

  const [designImage, renderedImage] = await Promise.all(
    [designImageUrl, renderedImageUrl].map(
      (url) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.addEventListener("load", () => resolve(image));
          image.addEventListener("error", () => reject(new Error("An image could not be decoded")));
          image.src = url;
        }),
    ),
  );
  if (designImage === undefined || renderedImage === undefined) {
    throw new Error("Both images are required");
  }
  const width = designImage.width;
  const height = designImage.height;

  const readPixels = (image: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("The page offers no 2D canvas");
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  };
  const designPixels = readPixels(designImage);
  const renderedPixels = readPixels(renderedImage);

  /* Summed over the color channels, against a pixel of the design. */
  const distanceFromDesign = (pixels: Uint8ClampedArray, offset: number, designOffset: number) =>
    Math.abs((pixels[offset] ?? 0) - (designPixels[designOffset] ?? 0)) +
    Math.abs((pixels[offset + 1] ?? 0) - (designPixels[designOffset + 1] ?? 0)) +
    Math.abs((pixels[offset + 2] ?? 0) - (designPixels[designOffset + 2] ?? 0));

  /* A design's corner shows its background; the rendered page is measured against the same color. */
  const backgroundOffset = (width * height - 1) * 4;
  if (designPixels[backgroundOffset + 3] !== 255) {
    throw new Error("The design image's bottom right corner must show the background, opaque");
  }
  const isInk = (pixels: Uint8ClampedArray, offset: number) =>
    distanceFromDesign(pixels, offset, backgroundOffset) > INK_DISTANCE;

  const findBands = (pixels: Uint8ClampedArray) => {
    const bands: InkBand[] = [];
    let currentBand: InkBand | undefined;
    for (let y = ignoreTopPixels; y < height; y += 1) {
      let left = width;
      let right = -1;
      for (let x = 0; x < width; x += 1) {
        if (isInk(pixels, (y * width + x) * 4)) {
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
      if (right === -1) {
        currentBand = undefined;
      } else if (currentBand === undefined) {
        currentBand = { top: y, bottom: y, left, right };
        bands.push(currentBand);
      } else {
        currentBand.bottom = y;
        currentBand.left = Math.min(currentBand.left, left);
        currentBand.right = Math.max(currentBand.right, right);
      }
    }
    return bands;
  };

  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const overlayContext = overlayCanvas.getContext("2d");
  if (overlayContext === null) {
    throw new Error("The page offers no 2D canvas");
  }
  const overlay = overlayContext.createImageData(width, height);
  /* Dark where both images have ink, red for the design alone, blue for the rendered page alone. */
  const paintOverlay = (offset: number, isDesignInk: boolean, isRenderedInk: boolean) => {
    const [red, green, blue] =
      isDesignInk && isRenderedInk
        ? [30, 30, 30]
        : isDesignInk
          ? [230, 40, 40]
          : isRenderedInk
            ? [40, 90, 230]
            : [255, 255, 255];
    overlay.data.set([red, green, blue, 255], offset);
  };

  let differingPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      paintOverlay(offset, isInk(designPixels, offset), isInk(renderedPixels, offset));
      if (
        y >= ignoreTopPixels &&
        distanceFromDesign(renderedPixels, offset, offset) > DIFFERENCE_DISTANCE
      ) {
        differingPixels += 1;
      }
    }
  }
  overlayContext.putImageData(overlay, 0, 0);

  return {
    designBands: findBands(designPixels),
    renderedBands: findBands(renderedPixels),
    differingPixelRatio: differingPixels / (width * (height - ignoreTopPixels)),
    overlayUrl: overlayCanvas.toDataURL("image/png"),
  };
}

/** Runs in the page, so it can use only browser APIs. */
function measureElementsInPage() {
  const elements = [...document.querySelectorAll("body *")].filter((element) => {
    const { width, height } = element.getBoundingClientRect();
    const hasOwnText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
    );
    const isDrawn =
      element.matches("input, button, svg") || (hasOwnText && !element.closest("svg"));
    return isDrawn && width > 0 && height > 0 && !element.matches("script, style");
  });

  return {
    loadedFonts: [...document.fonts]
      .filter((font) => font.status === "loaded")
      .map((font) => `${font.family} ${font.weight}`),
    elements: elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const isEmptyInput = element instanceof HTMLInputElement && element.value === "";
      const style = getComputedStyle(element);
      const paint = getComputedStyle(element, isEmptyInput ? "::placeholder" : undefined);
      return {
        tag: element.tagName.toLowerCase(),
        label: isEmptyInput ? element.placeholder : (element.textContent ?? "").trim(),
        rect: { x, y, width, height },
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        color: paint.color,
        backgroundColor: style.backgroundColor,
        opacity: style.opacity,
      };
    }),
  };
}
