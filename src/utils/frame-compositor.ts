import * as htmlToImage from 'html-to-image';

/**
 * Fast frame rendering for video exports.
 *
 * html-to-image is accurate but slow: every call clones the whole subtree, copies ~600
 * computed CSS properties onto every node and re-rasterizes every sprite (including its SVG
 * outline filter). Doing that per frame for a 1920x1080 tierlist costs ~a second a frame.
 *
 * The compositor keeps the live DOM as the *animation engine* but makes the canvas the
 * *painter*:
 *   - Static chrome (tier rows, labels, fades, ...) is captured with html-to-image once per
 *     layout change into layer bitmaps (`captureLayer`).
 *   - Every Pokémon sprite is rasterized once into a sprite sheet (`ensureSprites`), keyed by
 *     everything that affects its look (name, classes, per-Pokémon CSS vars, image src).
 *   - Per frame, `drawSprites` reads each sprite's *live* bounding rect / opacity / filter /
 *     clip and blits its sheet cell there (~microseconds per sprite).
 *
 * Frames are then handed to FFmpeg as raw RGBA via `VideoStream` — no PNG encode, no base64,
 * no temp files, and the encoder runs concurrently with capture.
 */

export type CaptureOpts = NonNullable<Parameters<typeof htmlToImage.toCanvas>[1]>;

/**
 * Bleed captured around each sprite so outlines / drop-shadows / selection glow — and, for
 * chrome elements, centered labels hanging outside a zero-width box — survive.
 */
const SPRITE_PAD = 48;
/** Sprites per sheet — keeps each html-to-image capture (and its SVG image) a sane size. */
const SHEET_CHUNK = 250;
const SHEET_WIDTH = 4000;

type SpriteCell = {
    sheet: HTMLCanvasElement;
    /** Source rect of the cell in the sheet (integer, includes padding). */
    sx: number; sy: number; sw: number; sh: number;
    /** Sub-pixel offset of the sprite box inside the cell, after the padding. */
    fx: number; fy: number;
    /** Sprite box size at capture time — live rect / this = draw scale. */
    w: number; h: number;
    /** The sprite root's own `filter` at capture time (already baked into the pixels). */
    bakedFilter: string;
};

type RootFrame = { rect: DOMRect; scaleX: number; scaleY: number };

type ClipRect = { x: number; y: number; w: number; h: number; radii: [number, number, number, number] };

export type SpriteOptions = {
    /**
     * Override the sprite's `--max-height` custom property for the sheet cell (and the cache
     * key). Lets a caller quantize continuously-changing sprite sizes into a few buckets.
     */
    maxHeight?: (el: HTMLElement) => string | undefined;
    /**
     * Custom cache key — for non-Pokémon elements (labels, tick marks, ...) whose look is
     * described by something other than a data-pokemon + CSS vars.
     */
    key?: (el: HTMLElement) => string;
    /** Keep the whole subtree (by default only the first child, PkmnImage's .wrapper, is kept). */
    keepChildren?: boolean;
    /**
     * Give the sheet clone the element's live layout size explicitly, and draw it 1:1 rather
     * than scaled. For elements sized by their absolute insets or shrink-to-fit (which lose
     * that sizing when parked statically in a sheet cell).
     */
    fixSize?: boolean;
};

/**
 * Wait for the next animation frame — or 50ms, whichever comes first. A window that isn't
 * being composited (hidden, occluded, remote-driven) can take the better part of a second per
 * rAF, and nothing here actually needs a paint; it just needs layout to have settled and the
 * UI to get a chance to breathe.
 */
export function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        requestAnimationFrame(finish);
        setTimeout(finish, 50);
    });
}

/**
 * html-to-image's own toCanvas() waits for a requestAnimationFrame after the SVG image has
 * decoded, which stalls for up to a second per capture whenever the window isn't being
 * composited (hidden / occluded / behind OBS). Rasterizing the SVG ourselves needs no paint.
 */
async function rasterize(node: HTMLElement, opts: CaptureOpts & { width: number; height: number }): Promise<HTMLCanvasElement> {
    const svg = await htmlToImage.toSvg(node, opts);
    const img = new Image();
    img.decoding = 'async';
    img.src = svg;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = opts.width;
    canvas.height = opts.height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, opts.width, opts.height);
    return canvas;
}

function px(v: string): number {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

export class FrameCompositor {
    readonly width: number;
    readonly height: number;
    readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly cells = new Map<string, SpriteCell>();
    private readonly missingWarned = new Set<string>();

    constructor(readonly root: HTMLElement, private readonly captureOpts: CaptureOpts) {
        this.width = root.clientWidth;
        this.height = root.clientHeight;
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Could not create 2D canvas context');
        this.ctx = ctx;
    }

    // ── Layers ────────────────────────────────────────────────────────────────────────────

    /**
     * Rasterize the root with html-to-image into a layer bitmap.
     *   hide   — elements to render invisible (visibility:hidden keeps their layout).
     *   only   — if given, EVERYTHING is hidden except these elements (and their subtrees).
     *   filter — html-to-image node filter: nodes returning false are left out of the clone
     *            entirely (cheap, but only safe for absolutely-positioned nodes).
     */
    async captureLayer(opts: { hide?: Iterable<Element>; only?: Iterable<Element>; filter?: (node: Node) => boolean } = {}): Promise<HTMLCanvasElement> {
        const saved: { el: HTMLElement; value: string; priority: string }[] = [];
        const setVis = (el: Element, value: string) => {
            const h = el as HTMLElement;
            saved.push({ el: h, value: h.style.getPropertyValue('visibility'), priority: h.style.getPropertyPriority('visibility') });
            h.style.setProperty('visibility', value, 'important');
        };
        try {
            if (opts.only) {
                setVis(this.root, 'hidden');
                for (const el of opts.only) setVis(el, 'visible');
            }
            if (opts.hide) {
                for (const el of opts.hide) setVis(el, 'hidden');
            }
            return await rasterize(this.root, {
                ...this.captureOpts,
                width: this.width,
                height: this.height,
                pixelRatio: 1,
                ...(opts.filter ? { filter: opts.filter } : {}),
            });
        } finally {
            for (let i = saved.length - 1; i >= 0; i--) {
                const s = saved[i];
                if (s.value) s.el.style.setProperty('visibility', s.value, s.priority);
                else s.el.style.removeProperty('visibility');
            }
        }
    }

    /** Rasterize a single element (e.g. an overlay) at its own size. */
    async captureElement(el: HTMLElement, style?: Record<string, string>): Promise<HTMLCanvasElement> {
        return rasterize(el, {
            ...this.captureOpts,
            pixelRatio: 1,
            width: el.offsetWidth,
            height: el.offsetHeight,
            ...(style ? { style } : {}),
        });
    }

    // ── Sprites ───────────────────────────────────────────────────────────────────────────

    private spriteKey(el: HTMLElement, opts?: SpriteOptions): string {
        if (opts?.key) return opts.key(el);
        const img = el.querySelector('img');
        const parts = [
            el.dataset.pokemon ?? '',
            el.className,
            img?.getAttribute('src') ?? '',
            img?.className ?? '',
        ];
        const override = opts?.maxHeight?.(el);
        const style = el.style;
        for (let i = 0; i < style.length; i++) {
            const name = style[i];
            if (!name.startsWith('--')) continue;
            const value = name === '--max-height' && override !== undefined ? override : style.getPropertyValue(name);
            parts.push(`${name}:${value}`);
        }
        return parts.join('|');
    }

    /**
     * Make sure every given sprite element has a cell in the sprite sheet, capturing the
     * missing ones in as few html-to-image calls as possible.
     */
    async ensureSprites(els: Iterable<HTMLElement>, opts?: SpriteOptions): Promise<void> {
        const missing = new Map<string, HTMLElement>();
        for (const el of els) {
            const key = this.spriteKey(el, opts);
            if (!this.cells.has(key) && !missing.has(key)) missing.set(key, el);
        }
        if (missing.size === 0) return;

        const entries = [...missing];
        for (let i = 0; i < entries.length; i += SHEET_CHUNK) {
            await this.captureSheet(entries.slice(i, i + SHEET_CHUNK), opts);
        }
    }

    private async captureSheet(entries: [string, HTMLElement][], opts?: SpriteOptions): Promise<void> {
        // Off-screen container, parked with a transform (a negative translate never adds
        // scrollable overflow) that the capture resets via html-to-image's `style` override. NOT
        // via `left`: Chromium's computed-style dump also carries the logical `inset-inline`
        // shorthand, which serializes after an overridden `left` and wins when the SVG is parsed.
        // Placed inside the root so the clones inherit the same context; scoped styles match by
        // attribute anyway.
        const sheet = document.createElement('div');
        sheet.style.cssText = [
            'position:absolute', 'left:0', 'top:0', `width:${SHEET_WIDTH}px`,
            'transform:translateX(-100000px)',
            'display:flex', 'flex-wrap:wrap', 'align-items:flex-start', 'align-content:flex-start',
            'visibility:visible', 'opacity:1', 'filter:none',
            'pointer-events:none', 'background:transparent',
        ].join(';');

        // The sprites' outline filters reference `<filter id="outline…">` defs in the document.
        // The capture is rendered in its own SVG document, so the defs have to come along —
        // but only when the live page has them (without them the browser ignores the filter,
        // and so must we, to match what's on screen).
        const defs = document.getElementById('outline20')?.closest('svg');
        if (defs) sheet.appendChild(defs.cloneNode(true));

        const clones: { key: string; clone: HTMLElement; bakedFilter: string }[] = [];
        for (const [key, el] of entries) {
            const cell = document.createElement('div');
            cell.style.cssText = `padding:${SPRITE_PAD}px;flex:none;`;
            const clone = el.cloneNode(true) as HTMLElement;
            // For Pokémon sprites keep only the sprite's own markup (first child = PkmnImage's
            // .wrapper); anything slotted in after it (metric popouts) is not part of the sprite.
            if (!opts?.keepChildren) {
                while (clone.children.length > 1) clone.removeChild(clone.lastElementChild!);
            }
            // Neutralize everything that is applied live per frame, so the cell holds the
            // sprite's "resting" look. Sprite-internal filters (outline / .active glow) stay.
            const cs = clone.style;
            cs.position = 'relative';   // stays a containing block for absolutely-positioned children
            cs.left = cs.top = cs.right = cs.bottom = 'auto';
            cs.margin = '0';
            cs.transform = 'none';
            cs.opacity = '1';
            cs.visibility = 'visible';
            cs.overflow = 'visible';
            cs.transition = 'none';
            cs.animation = 'none';
            const override = opts?.maxHeight?.(el);
            if (override !== undefined) cs.setProperty('--max-height', override);
            if (opts?.fixSize) {
                const r = this.localRect(el.getBoundingClientRect(), this.rootFrame());
                cs.width = r.w + 'px';
                cs.height = r.h + 'px';
                cs.boxSizing = 'border-box';
            }
            cell.appendChild(clone);
            sheet.appendChild(cell);
            clones.push({ key, clone, bakedFilter: '' });
        }

        this.root.appendChild(sheet);
        try {
            // Cloned <img>s load asynchronously even from cache, and an unloaded image has no
            // intrinsic size — measuring before that would record zero-width cells.
            await Promise.all([...sheet.querySelectorAll('img')].map(img =>
                img.complete ? Promise.resolve() : new Promise<void>(resolve => { img.onload = img.onerror = () => resolve(); })
            ));
            await nextFrame();
            // The sheet sits inside the root, so its screen rects carry the root's display
            // scale too — measure everything in layout px.
            const { scaleX, scaleY } = this.rootFrame();
            const sheetRect = sheet.getBoundingClientRect();
            const sheetW = Math.ceil(sheetRect.width / scaleX);
            const sheetH = Math.ceil(sheetRect.height / scaleY);

            const measured = clones.map(c => {
                const sr = c.clone.getBoundingClientRect();
                const r = { width: sr.width / scaleX, height: sr.height / scaleY };
                c.bakedFilter = getComputedStyle(c.clone).filter || 'none';
                const left = (sr.left - sheetRect.left) / scaleX;
                const top = (sr.top - sheetRect.top) / scaleY;
                const ix = Math.floor(left);
                const iy = Math.floor(top);
                return { c, r, ix, iy, fx: left - ix, fy: top - iy };
            });

            const sheetCanvas = await rasterize(sheet, {
                ...this.captureOpts,
                pixelRatio: 1,
                width: sheetW,
                height: sheetH,
                style: { transform: 'none' },
            });

            for (const { c, r, ix, iy, fx, fy } of measured) {
                this.cells.set(c.key, {
                    sheet: sheetCanvas,
                    sx: ix - SPRITE_PAD,
                    sy: iy - SPRITE_PAD,
                    sw: Math.ceil(r.width + fx) + 2 * SPRITE_PAD,
                    sh: Math.ceil(r.height + fy) + 2 * SPRITE_PAD,
                    fx, fy,
                    w: r.width,
                    h: r.height,
                    bakedFilter: c.bakedFilter,
                });
            }
        } finally {
            sheet.remove();
        }
    }

    /**
     * Map a live DOMRect into frame (layout) pixels. If the root is being displayed through a
     * scale transform (the viewer's fit-to-window scaling), getBoundingClientRect() is in
     * screen pixels, so divide the transform back out.
     */
    localRect(r: DOMRect, frame: RootFrame): { x: number; y: number; w: number; h: number } {
        return {
            x: (r.left - frame.rect.left) / frame.scaleX,
            y: (r.top - frame.rect.top) / frame.scaleY,
            w: r.width / frame.scaleX,
            h: r.height / frame.scaleY,
        };
    }

    /** The root's current screen rect + the scale it is displayed at (1 when untransformed). */
    rootFrame(): RootFrame {
        const rect = this.root.getBoundingClientRect();
        return {
            rect,
            scaleX: rect.width > 0 ? rect.width / this.width : 1,
            scaleY: rect.height > 0 ? rect.height / this.height : 1,
        };
    }

    /** Clip rects of every overflow-clipping ancestor between `el` and the root. */
    private clipChain(el: HTMLElement, frame: RootFrame, cache: Map<Element, ClipRect | null>): ClipRect[] {
        const chain: ClipRect[] = [];
        for (let anc = el.parentElement; anc && anc !== this.root; anc = anc.parentElement) {
            let clip = cache.get(anc);
            if (clip === undefined) {
                const cs = getComputedStyle(anc);
                if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
                    const { x, y, w, h } = this.localRect(anc.getBoundingClientRect(), frame);
                    clip = {
                        x, y, w, h,
                        radii: [
                            px(cs.borderTopLeftRadius), px(cs.borderTopRightRadius),
                            px(cs.borderBottomRightRadius), px(cs.borderBottomLeftRadius),
                        ],
                    };
                } else {
                    clip = null;
                }
                cache.set(anc, clip);
            }
            if (clip) chain.push(clip);
        }
        return chain;
    }

    /**
     * Draw the given sprite elements where the live DOM currently lays them out, with their
     * live opacity, filter and ancestor clipping. Hidden / zero-size sprites are skipped.
     */
    drawSprites(els: Iterable<HTMLElement>, opts?: SpriteOptions & { clip?: boolean }): void {
        const ctx = this.ctx;
        const frame = this.rootFrame();
        const clipCache = new Map<Element, ClipRect | null>();
        const clip = opts?.clip ?? true;

        for (const el of els) {
            const key = this.spriteKey(el, opts);
            const cell = this.cells.get(key);
            if (!cell) {
                if (!this.missingWarned.has(key)) {
                    this.missingWarned.add(key);
                    console.warn('[video] sprite not in sheet, skipped:', el.dataset.pokemon);
                }
                continue;
            }
            const cs = getComputedStyle(el);
            if (cs.visibility !== 'visible' || cs.display === 'none') continue;
            const alpha = parseFloat(cs.opacity);
            if (!(alpha > 0)) continue;
            const r = this.localRect(el.getBoundingClientRect(), frame);
            // Fixed-size chrome may legitimately be a zero-width box with overflowing labels.
            if (!opts?.fixSize && (!(r.w > 0) || !(r.h > 0))) continue;

            const scaleX = opts?.fixSize || !(cell.w > 0) ? 1 : r.w / cell.w;
            const scaleY = opts?.fixSize || !(cell.h > 0) ? 1 : r.h / cell.h;
            const dx = Math.round(r.x - (SPRITE_PAD + cell.fx) * scaleX);
            const dy = Math.round(r.y - (SPRITE_PAD + cell.fy) * scaleY);
            const dw = Math.round(cell.sw * scaleX);
            const dh = Math.round(cell.sh * scaleY);

            ctx.save();
            if (clip) {
                for (const c of this.clipChain(el, frame, clipCache)) {
                    ctx.beginPath();
                    ctx.roundRect(c.x, c.y, c.w, c.h, c.radii);
                    ctx.clip();
                }
            }
            ctx.globalAlpha = alpha;
            const filter = cs.filter || 'none';
            if (filter !== 'none' && filter !== cell.bakedFilter) ctx.filter = filter;
            ctx.drawImage(cell.sheet, cell.sx, cell.sy, cell.sw, cell.sh, dx, dy, dw, dh);
            ctx.restore();
        }
    }

    // ── Frame assembly ────────────────────────────────────────────────────────────────────

    clear(): void {
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    drawLayer(layer: CanvasImageSource, x = 0, y = 0, alpha = 1): void {
        if (alpha <= 0) return;
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.drawImage(layer, Math.round(x), Math.round(y));
        ctx.restore();
    }

    /** Solid rectangle in canvas space (used for trivial DOM boxes like connector lines). */
    fillRect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
        if (alpha <= 0 || w <= 0 || h <= 0) return;
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
        ctx.restore();
    }

    /** Raw non-premultiplied RGBA pixels of the current frame (what FFmpeg's rawvideo wants). */
    pixels(): Uint8Array {
        const data = this.ctx.getImageData(0, 0, this.width, this.height).data;
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }

    toDataURL(): string {
        return this.canvas.toDataURL('image/png');
    }
}

// ── FFmpeg streaming ──────────────────────────────────────────────────────────────────────

type VideoApi = NonNullable<Window['electronVideo']>;

/** A raw-RGBA frame stream into FFmpeg (see electron/main.ts `video:beginStream`). */
export class VideoStream {
    /** The previous frame's IPC round trip, still in flight while the next frame is painted. */
    private inFlight: Promise<void> = Promise.resolve();

    private constructor(private readonly api: VideoApi, private readonly id: string, private open = true) {}

    static async begin(api: VideoApi, outputPath: string, fps: number, width: number, height: number, lossless: boolean): Promise<VideoStream> {
        const res = await api.beginStream(outputPath, fps, width, height, lossless);
        if (!res.id) throw new Error(res.error || 'Could not start FFmpeg');
        return new VideoStream(api, res.id);
    }

    /**
     * Queue a frame. Shipping 8MB over IPC costs ~25ms of latency, most of it waiting — so one
     * frame is kept in flight: this resolves once the *previous* frame was accepted, letting
     * the caller render the next frame while this one crosses to the main process. A failed
     * write therefore surfaces one frame late, which is fine (the export aborts either way).
     */
    async write(frame: Uint8Array): Promise<void> {
        const prev = this.inFlight;
        this.inFlight = this.api.writeFrame(this.id, frame).then(res => {
            if (!res.success) throw new Error(res.error || 'FFmpeg write failed');
        });
        await prev;
    }

    /** Finish the file; resolves with FFmpeg's verdict. */
    async end(): Promise<{ success: boolean; error?: string }> {
        if (!this.open) return { success: false, error: 'stream closed' };
        this.open = false;
        try {
            await this.inFlight;
        } catch (e) {
            return { success: false, error: String(e) };
        }
        return this.api.endStream(this.id);
    }

    async abort(): Promise<void> {
        if (!this.open) return;
        this.open = false;
        try { await this.inFlight; } catch { /* aborting anyway */ }
        try { await this.api.abortStream(this.id); } catch { /* ignore */ }
    }
}
