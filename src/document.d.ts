// The shapes the document is made of.
//
// These were written as `{object}` in JSDoc wherever they crossed a function boundary, which the
// checker reads as "has no properties" - so `cut.layers` was an error waiting for a stricter
// TypeScript, and, worse, a misspelt field was never anything at all. The only way to learn what
// a cut held was to read every function that touched one.
//
// Ambient on purpose: these are the vocabulary of the whole app, named in about fifty files, and
// an import line in each would say nothing a reader does not already know. `import(...)` types
// keep the file ambient while still pointing at the one definition of a shape - so `Id` and the
// animation settings are not copied here, they are referenced.
//
// **No index signature.** Every field a cut, layer, stroke or text can hold is listed below, so
// a misspelt one is an error rather than silently undefined - which is the whole reason this
// file exists. A field that genuinely belongs to the document goes here, beside the others; the
// escape hatch is not coming back. Fields that belong to one tool or one feature are optional,
// because they are absent on everything else.

type Id = import('./core/types.ts').Id;
type PressurePoint = import('./core/types.ts').PressurePoint;

/**
 * What identifies a cut, a layer, a stroke or a text: a number, from `nextId()`.
 *
 * Written down because the wider `Id` (number or string) is what a helper takes when it does not
 * care which kind it was handed, and using it here let a part id - which *is* a string - be
 * assigned to a cut id without complaint. A part is identified by `PartId` below.
 */
type DocId = number;
/** What identifies a part or an import batch: a string, prefixed so the two cannot collide. */
type PartId = string;

/**
 * The styling half of a text object: the font, the colour, the outline, every field the renderer
 * reads, each documented beside the code that draws it in canvas/textRender. Named here because
 * an interface cannot extend an `import(...)` type directly.
 */
type TextStyling = import('./canvas/textRender.ts').TextObject;

/**
 * One drawn mark. Its shape depends on `tool`, so most fields are optional: a brush stroke has
 * points and a size, a paste has a bitmap and a box, a text has a string and a font.
 */
interface Stroke {
    id: DocId;
    tool?: string;
    /** Pixels held in the bitmap store rather than in the document - fill, lasso and paste. */
    bitmapId?: string | null;
    /** A lasso paste also keeps the mask that shaped it. */
    maskBitmapId?: string | null;

    // -- drawn strokes: the pen, brush, pencil, marker, airbrush, eraser and shapes
    points?: PressurePoint[];
    color?: string;
    opacity?: number;
    size?: number;
    /** The pointer was a pen and pressure was on, so the widths follow it. */
    pen?: boolean;
    /** The boiling line's own displacement, when the stroke carries one rather than the layer. */
    roughAmp?: number;

    // -- placed pixels: paste, fill, the lasso's erase and the liquify commit
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    /** Turn, skew and bend, as a floating selection was left when it was committed. */
    rot?: number;
    skew?: number;
    bend?: number;
    /** Pixels inline in the document. Only old projects have these; new ones use bitmapId. */
    imageData?: ImageData | null;

    // -- the text tool's own stroke, which predates text objects
    text?: string;
    fontSize?: number;
    fontFamily?: string;
}

/** A layer, or a folder holding layers. Folders have no strokes of their own. */
interface Layer {
    id: DocId;
    type?: 'layer' | 'folder';
    parentId?: DocId | null;
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
    /** How the layer moves, in the cut it belongs to. The settings are core/layerAnim. */
    anim?: import('./core/layerAnim.ts').LayerAnimSettings | null;
    /** Shows only where the layer below has paint - a clipping mask. */
    clipped?: boolean;
    /** A folder whose children are folded away in the panel. Purely a view setting. */
    collapsed?: boolean;

    // -- the boiling line: how far the strokes shift, and how that shift moves
    /** How far the strokes are displaced, in pixels. 0 or absent is off. */
    roughen?: number;
    /** How fast the displacement is re-rolled, as a multiple of the boiling rate. */
    roughSpeed?: number;
    /** The wavelength of the displacement, as a multiple. */
    roughWave?: number;
    /** Strokes thinner than this are left alone. */
    roughMinSize?: number;
}

/**
 * A text object. The renderer's view of one is TextObject in canvas/textRender, which is where
 * every styling field is documented; a CutText is that plus what the document keeps of it.
 */
interface CutText extends TextStyling {
    id: DocId;
    visible?: boolean;
    /** How the text moves and fades; the settings are TextAnimSettings in core/textAnim. */
    anim?: import('./core/textAnim.ts').TextAnimSettings | null;
}

/** One shot on the timeline. */
interface Cut {
    id: DocId;
    name?: string;
    startTime: number;
    endTime: number;
    track: number;
    layers: Layer[];
    activeLayerId?: DocId | null;
    texts?: CutText[];
    /** Set when the cut belongs to a part - a group made from an import or a lasso selection. */
    partId?: PartId | null;
    partName?: string;
    /** How the cut enters, leaves and deforms. The settings are core/cutAnim. */
    anim?: import('./core/cutAnim.ts').CutAnimSettings | null;
    /** A camera move for this shot; absent on every cut that has never had one. */
    camera?: import('./core/camera.ts').CameraSettings | null;

    // -- cuts made by importing a video, replaced as a batch when that video is imported again
    /** Which video this cut came from: the key a re-import matches on. */
    videoSrc?: string;
    /** What to call that video in the panel. */
    videoLabel?: string;
    /** The one import run that made this cut. */
    videoBatch?: PartId;
}
