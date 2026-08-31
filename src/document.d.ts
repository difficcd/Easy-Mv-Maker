// The shapes the document is made of.
//
// These were written as `{object}` in JSDoc wherever they crossed a function boundary, which the
// checker reads as "has no properties" - so `cut.layers` was an error waiting for a stricter
// TypeScript, and, worse, a misspelt field was never anything at all. The only way to learn what
// a cut held was to read every function that touched one.
//
// Ambient on purpose: these are the vocabulary of the whole app, and requiring an import in every
// JSDoc comment would mean most comments simply not using them.
//
// Deliberately not exhaustive and deliberately not sealed with an index signature. Listing every
// field would make this a second copy of the reducer to keep in step; allowing any field would
// bring back the problem it exists to solve. What is here is what crosses a boundary.

/** One drawn mark. Its shape depends on `tool`; the fields below are the ones shared code reads. */
interface Stroke {
    tool?: string;
    /** Pixels held in the bitmap store rather than in the document - fill, lasso and paste. */
    bitmapId?: string | null;
    /** A lasso paste also keeps the mask that shaped it. */
    maskBitmapId?: string | null;
    [extra: string]: any;
}

/** A layer, or a folder holding layers. Folders have no strokes of their own. */
interface Layer {
    id: any;
    type?: 'layer' | 'folder';
    parentId?: any;
    name?: string;
    visible?: boolean;
    locked?: boolean;
    opacity?: number;
    strokes?: Stroke[];
    /** Cleared when a project is opened - redo is a within-session affair. */
    redoStrokes?: Stroke[];
    /**
     * Bumped when something changes that the cached-canvas signature cannot see. Moving a layer
     * changes coordinates without changing the stroke count, so without this the cache keeps
     * drawing the old position.
     */
    rev?: number;
    anim?: any;
    [extra: string]: any;
}

/** A text object. The renderer's view of one is TextObject in canvas/textRender.js. */
interface CutText {
    id: any;
    visible?: boolean;
    [extra: string]: any;
}

/** One shot on the timeline. */
interface Cut {
    id: any;
    name?: string;
    startTime: number;
    endTime: number;
    track: number;
    layers: Layer[];
    activeLayerId?: any;
    texts?: CutText[];
    /** Set when the cut belongs to a part - a group made from an import or a lasso selection. */
    partId?: any;
    partName?: string;
    anim?: any;
    /** A camera move for this shot; absent on every cut that has never had one. */
    camera?: any;
    [extra: string]: any;
}
