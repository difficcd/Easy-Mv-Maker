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

/** An id in the document. Cuts and layers use numbers; texts and bitmaps use strings too. */
export type Id = number | string;

/**
 * What the selection and ordering helpers need of a cut. The index signature is deliberate:
 * a cut has a name, layers, a camera and more, and a helper that only reads two fields must not
 * strip the rest from what it hands back. The full shape arrives when the reducer converts.
 */
export interface CutLike extends TimeSpan { id: Id; track: number; [k: string]: any }

/**
 * The document's own shapes are declared globally in src/document.d.ts (a stroke, a layer, a
 * cut, the document). Modules that need them use those names directly; these aliases exist so
 * a converted helper can say which of the two it means without inventing a lookalike.
 */
export type StrokeLike = Stroke;
export type LayerLike = Layer;
