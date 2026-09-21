// The shapes the pure modules share. Grown as modules convert to TypeScript; nothing here is
// invented ahead of a use.

/** A position on the canvas, in canvas pixels. */
export interface Point { x: number; y: number }

/** A stroke sample: where the pen was, and how hard it pressed (0..1, 0.5 when unknown). */
export interface PressurePoint extends Point { pressure?: number }

/** A width and a height, in pixels. */
export interface Size { w: number; h: number }

/** Anything with a start and an end on the timeline, in seconds - a cut, a clip, a part. */
export interface TimeSpan { startTime: number; endTime: number }
