/** The view transition names and markers that the app's styles and scripts share. */
export const TRACK_COVER_TRANSITION_NAME = "track-cover";
/**
 * Both screens' bottom bars share a name, so they cross-fade as a pair, which stays opaque where
 * they overlap. Two separate fades would let the page's text show through the half-transparent
 * bars.
 */
export const BOTTOM_BAR_TRANSITION_NAME = "bottom-bar";
/**
 * Each screen's content has a name of its own, so the old screen fades out where it was and the new
 * one fades in where it lands. A shared name would slide them by the difference in scroll
 * position.
 */
export const RECENTS_SCREEN_TRANSITION_NAME = "recents-screen";
export const DETAIL_HEADER_TRANSITION_NAME = "detail-header";
export const DETAIL_SCREEN_TRANSITION_NAME = "detail-screen";

/** Marks a cover with its conversion ID, for the cover transition to find it. */
export const TRACK_COVER_ATTRIBUTE = "data-track-cover";
