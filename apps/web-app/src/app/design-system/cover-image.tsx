import { css } from "@linaria/core";
import React from "react";

import type { MapPropsToRequiredDataAttributeProps } from "#src/app/styling.utils.js";
import { composeClassnames } from "#src/app/utils.js";

type DSCoverImageProps = DSCoverImageCustomProps & {
  /** No URL shows the empty placeholder. */
  src: string | undefined;
  alt: string;
  className?: string;
  /** Names the cover for a screen change's view transition (`cover-transition.ts`). */
  "data-track-cover"?: string;
};

type DSCoverImageCustomProps = {
  /** `circle` crops to a circle, as in the mini player; its size comes from `className`. */
  shape?: "rectangle" | "circle";
  /**
   * `card` fits the bottom of a card: square on top, and the card's inner radius below. The cover
   * has its own corners, because a view transition's snapshot leaves out a container's clip.
   */
  corners?: "rounded" | "card";
};

type DSCoverImageDataAttributes = MapPropsToRequiredDataAttributeProps<DSCoverImageCustomProps>;

type ShownImage = { src: string; alt: string };

/**
 * A cover cropped to 5:3 (or a circle) on the placeholder color while it loads. When the URL
 * changes, it keeps showing the previous image until the new one has loaded. An image the document
 * has already loaded shows on the first paint, so a remounted cover never flashes the placeholder.
 */
export function DSCoverImage({
  src,
  alt,
  shape = "rectangle",
  corners = "rounded",
  className,
  "data-track-cover": trackCover,
}: DSCoverImageProps): React.JSX.Element {
  const [shownImage, setShownImage] = React.useState<ShownImage | undefined>(undefined);
  const dataAttributes: DSCoverImageDataAttributes = {
    "data-shape": shape,
    "data-corners": corners,
  };

  const isLoading = src !== undefined && src !== shownImage?.src;

  return (
    <div
      className={composeClassnames(
        css`
          /* containing block for the stacked images */
          position: relative;
          overflow: hidden;
          background-color: var(--color-placeholder);
          border-radius: var(--border-radius-lg);

          &[data-shape="rectangle"] {
            aspect-ratio: 5 / 3;
          }

          &[data-shape="circle"] {
            aspect-ratio: 1;
            border-radius: var(--border-radius-full);
          }

          &[data-corners="card"] {
            border-radius: 0 0 calc(var(--border-radius-lg) - 1px)
              calc(var(--border-radius-lg) - 1px);
          }

          & > img {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          & > img[data-loading] {
            opacity: 0;
          }
        `,
        className,
      )}
      {...dataAttributes}
      data-track-cover={trackCover}
    >
      {src !== undefined && shownImage !== undefined && (
        <img src={shownImage.src} alt={isLoading ? shownImage.alt : alt} />
      )}
      {isLoading && (
        // Loads invisibly on top of the shown image and replaces it once loaded.
        <img
          key={src}
          src={src}
          alt=""
          data-loading=""
          ref={(image) => {
            // The list of available images completes a cached image as soon as its src is set.
            if (image?.complete && image.naturalWidth > 0) {
              setShownImage({ src, alt });
            }
          }}
          onLoad={() => setShownImage({ src, alt })}
        />
      )}
    </div>
  );
}
