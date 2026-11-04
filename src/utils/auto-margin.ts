/**
 * Automatic spacing between two neighbouring Pokemon in a tier row.
 *
 * The goal is the one used when spacing by hand: the closest pair of pixels between the
 * left art and the right art, measured along a horizontal line, should sit a fixed
 * distance apart. Art that fits together like puzzle pieces (Crobat's raised wing over
 * Hippowdon's empty top-right corner) can then tuck in as far as its silhouette allows.
 *
 * The stored value is still `pokemonSettings[right].margins[left]`, the `margin-left` of
 * the right image; this module only works out a good starting value for it.
 *
 * Calibration (2026-11-01, against the 1,185 hand-set pairs in Scott's workspace): at the
 * hand-set margins the black outlines of the two images sit a median 1.5px apart on their
 * closest row, and the target below reproduces 79% of the hand-set margins within 2px
 * (a margin of 0 matches 27%).
 */

/** Target distance, in CSS px, between the two outlined silhouettes on their closest row. */
export const AUTO_MARGIN_TARGET = 1.25;
/** Radius of the `#outline20` filter the tier rows draw around each image. */
export const STANDARD_OUTLINE = 2;
/** Pixels at or above this alpha count as art. */
const ALPHA_THRESHOLD = 128;
/** `gap` of `.entry-row` in TierList.vue. */
const ROW_GAP = 2;
/** Default `height` of PkmnImage.vue; the rendered height is this times `scale`. */
export const BASE_IMAGE_HEIGHT = 87;
/** Silhouettes are sampled at no more than this many rows (the full-size art is 1280px). */
const MAX_SAMPLE_ROWS = 256;

/** Limits of the Margin slider in Edit View; auto values are clamped to the same range. */
export const MARGIN_MIN = -50;
export const MARGIN_MAX = 25;

/**
 * An image's opaque extent per source row: how far the first and last art pixel sit in
 * from the image's left and right edges, in source px. Infinity marks an empty row.
 */
export type Silhouette = {
    width: number
    height: number
    left: Float32Array
    right: Float32Array
}

/** How an image is drawn in the row (the parts of its view settings that move pixels). */
export type Placement = {
    silhouette: Silhouette
    scale: number
    offset: number
    flip: boolean
    /** Radius of the black outline filter (0 for the Yellow sprites, which have none). */
    outline: number
}

/** Builds a silhouette from RGBA pixel data. */
export function silhouetteFromPixels(data: ArrayLike<number>, width: number, height: number): Silhouette {
    const left = new Float32Array(height).fill(Infinity);
    const right = new Float32Array(height).fill(Infinity);
    for (let y = 0; y < height; y++) {
        const row = y * width * 4;
        let first = -1, last = -1;
        for (let x = 0; x < width; x++) {
            if (data[row + x * 4 + 3] >= ALPHA_THRESHOLD) {
                if (first < 0) first = x;
                last = x;
            }
        }
        if (first >= 0) {
            left[y] = first;
            right[y] = width - 1 - last;
        }
    }
    return { width, height, left, right };
}

/**
 * The inset of one side of the drawn (outlined) art from its image box edge, per screen
 * row counted up from the bottom of the tier row (index 0 = the row's bottom edge, which
 * all images are aligned to). Infinity where that row has no art.
 */
function screenInsets(p: Placement, side: 'left' | 'right'): Float64Array {
    const s = p.silhouette;
    const h = BASE_IMAGE_HEIGHT * p.scale;
    const w = h * s.width / s.height;
    const pxPerSource = w / s.width;
    // A flipped image shows its source's right edge on the left.
    const source = (side === 'left') !== p.flip ? s.left : s.right;

    const rows = Math.max(1, Math.round(h));
    const bottom = Math.round(p.offset);
    const r = p.outline;
    const size = bottom + rows + r + 1;

    // Undilated insets, screen rows bottom-up. Each screen row takes the smallest inset of
    // the source rows it covers, so thin features aren't lost when the art is scaled down.
    const base = new Float64Array(size).fill(Infinity);
    for (let row = 0; row < rows; row++) {
        const from = Math.floor(row * s.height / rows);
        const to = Math.max(from + 1, Math.ceil((row + 1) * s.height / rows));
        let inset = Infinity;
        for (let sy = from; sy < to && sy < s.height; sy++) inset = Math.min(inset, source[sy]);
        base[bottom + (rows - 1 - row)] = inset * pxPerSource;
    }
    if (r <= 0) return base;

    // The outline is an feMorphology dilate, a square kernel: every art pixel grows `r` px
    // in each direction, so each row reaches `r` px past the widest of its `r` neighbours.
    const out = new Float64Array(size).fill(Infinity);
    for (let y = 0; y < size; y++) {
        let best = Infinity;
        for (let dy = -r; dy <= r; dy++) {
            const v = base[y + dy];
            if (v !== undefined && v < best) best = v;
        }
        out[y] = best - r;
    }
    return out;
}

/**
 * The closest horizontal distance between the two outlined silhouettes with a margin of 0,
 * in CSS px (negative when they would already overlap). Null if they share no row.
 */
export function closestGapAtZeroMargin(leftImg: Placement, rightImg: Placement): number | null {
    const leftEdge = screenInsets(leftImg, 'right');
    const rightEdge = screenInsets(rightImg, 'left');
    let best = Infinity;
    // Rows only one image reaches don't count: that is where art can tuck in over or
    // under its neighbour. The outline already makes each row reach 2px up and down.
    const rows = Math.min(leftEdge.length, rightEdge.length);
    for (let y = 0; y < rows; y++) {
        const l = leftEdge[y], r = rightEdge[y];
        if (l !== Infinity && r !== Infinity) best = Math.min(best, l + r);
    }
    return best === Infinity ? null : ROW_GAP + best;
}

/** The margin that puts the closest pixels {@link AUTO_MARGIN_TARGET} apart, or null. */
export function computeAutoMargin(leftImg: Placement, rightImg: Placement, target = AUTO_MARGIN_TARGET): number | null {
    const gap = closestGapAtZeroMargin(leftImg, rightImg);
    if (gap === null) return null;
    // The target was calibrated on outlined art. Art drawn without an outline (the Yellow
    // sprites) is measured bare, so add back the outline it lacks to keep the art itself
    // the same distance apart.
    const missingOutline = 2 * STANDARD_OUTLINE - leftImg.outline - rightImg.outline;
    const value = Math.round(target + missingOutline - gap);
    return Math.min(MARGIN_MAX, Math.max(MARGIN_MIN, value));
}

// ── Loading silhouettes in the renderer ───────────────────────────────────────────────

const cache = new Map<string, Silhouette | null>();
const loading = new Map<string, Promise<Silhouette | null>>();

/** The cached silhouette for an image path; undefined if it hasn't been loaded yet. */
export function getCachedSilhouette(src: string): Silhouette | null | undefined {
    return cache.get(src);
}

/** Loads (once) and returns the silhouette for an image path; null if it can't be read. */
export function loadSilhouette(src: string): Promise<Silhouette | null> {
    if (cache.has(src)) return Promise.resolve(cache.get(src)!);
    const pending = loading.get(src);
    if (pending) return pending;
    const promise = new Promise<Silhouette | null>(resolve => {
        const img = new Image();
        img.onload = () => {
            try {
                const rows = Math.min(img.naturalHeight, MAX_SAMPLE_ROWS);
                const cols = Math.max(1, Math.round(img.naturalWidth * rows / img.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = cols;
                canvas.height = rows;
                const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
                ctx.drawImage(img, 0, 0, cols, rows);
                resolve(silhouetteFromPixels(ctx.getImageData(0, 0, cols, rows).data, cols, rows));
            } catch (e) {
                console.warn(`[auto-margin] could not read ${src}:`, e);
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = src;
    }).then(result => {
        cache.set(src, result);
        loading.delete(src);
        return result;
    });
    loading.set(src, promise);
    return promise;
}
