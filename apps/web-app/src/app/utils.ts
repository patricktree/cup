import { css } from "@linaria/core";

/** {@link https://courses.joshwcomeau.com/css-for-js/02-rendering-logic-2/18-hidden-content} */
export const visuallyHidden = css`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;

  overflow: hidden;
  border: 0;
  clip-path: inset(50%);
`;

export const composeClassnames = (...classNames: (string | undefined)[]) => {
  return classNames.filter((elem) => elem).join(" ");
};
