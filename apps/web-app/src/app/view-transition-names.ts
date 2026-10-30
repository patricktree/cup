/** The view transition names and markers that the app's styles and scripts share. */
export const TRACK_COVER_TRANSITION_NAME = "track-cover";
export const RECENTS_FOOTER_TRANSITION_NAME = "recents-footer";
export const PLAYER_SHEET_TRANSITION_NAME = "player-sheet";
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
