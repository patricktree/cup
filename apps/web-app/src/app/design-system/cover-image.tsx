import { css } from "@linaria/core";
import React from "react";

import type { MapPropsToRequiredDataAttributeProps } from "#src/app/styling.utils.js";
import { composeClassnames } from "#src/app/utils.js";

type DSCoverImageProps = DSCoverImageCustomProps & {
  /** No URL shows the empty placeholder. */
  src: string | undefined;
  alt: string;
  className?: string;
};

type DSCoverImageCustomProps = {
  /** `circle` crops to a circle, as in the mini player; its size comes from `className`. */
  shape?: "rectangle" | "circle";
};

type DSCoverImageDataAttributes = MapPropsToRequiredDataAttributeProps<DSCoverImageCustomProps>;

type ShownImage = { src: string; alt: string };

/**
 * A cover cropped to 5:3 (or a circle) on the placeholder color while it loads. When the URL
 * changes, it keeps showing the previous image until the new one has loaded.
 */
export function DSCoverImage({
  src,
  alt,
  shape = "rectangle",
  className,
}: DSCoverImageProps): React.JSX.Element {
  const [shownImage, setShownImage] = React.useState<ShownImage | undefined>(undefined);
  const dataAttributes: DSCoverImageDataAttributes = { "data-shape": shape };

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
          onLoad={() => setShownImage({ src, alt })}
        />
      )}
    </div>
  );
}
