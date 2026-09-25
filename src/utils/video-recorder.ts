import { FrameCompositor, VideoStream, nextFrame, type CaptureOpts } from './frame-compositor';

const FPS = 60;

export type RecordingProgress = {
    phase: 'capturing' | 'encoding' | 'done' | 'error';
    current: number;
    total: number;
    message: string;
};

/** Build embedded base64 @font-face CSS so html-to-image renders the correct fonts. */
export async function buildFontEmbedCSS(): Promise<string> {
    try {
        const base = import.meta.env.BASE_URL || '/';
        const fontFiles = [
            { family: 'Teko', url: `${base}fonts/Teko-Bold.ttf` },
            { family: 'play', url: `${base}fonts/Play-Bold.ttf` },
            { family: 'oseb', url: `${base}fonts/OpenSans-ExtraBold.ttf` },
            { family: 'osb', url: `${base}fonts/Play-Bold.ttf` },
            { family: 'titan', url: `${base}fonts/TitanOne-Regular.ttf` },
        ];
        const promises = fontFiles.map(async ({ family, url }) => {
            const resp = await fetch(url);
            const blob = await resp.blob();
            const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
            });
            return `@font-face { font-family: '${family}'; src: url(${dataUrl}) format('truetype'); }`;
        });
        return (await Promise.all(promises)).join('\n');
    } catch {
        return '';
    }
}

/** Shared html-to-image options for transparent-background frame capture. */
export function buildCaptureOpts(fontEmbedCSS: string): CaptureOpts {
    return {
        backgroundColor: 'transparent' as string,
        cacheBust: false,
        pixelRatio: 1,
        skipFonts: true,
        ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: false, preferredFontFormat: 'truetype' as const }),
    };
}

/** Selector for the tierlist chrome that is painted ABOVE the sprites (edge fades, labels). */
const TIER_OVERLAYS = '.fade-left, .fade-right, .threshold-label';
const SPRITES = '[data-pokemon]';

function easeInOut(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Progress reporter that coalesces the per-frame "Capturing frame N/M" spam to ~10 updates a
 * second (each update re-renders a toast), while always delivering phase changes and the
 * final frame.
 */
function makeProgress(onProgress: (p: RecordingProgress) => void) {
    let last = 0;
    let lastPhase = '';
    return (p: RecordingProgress) => {
        const now = performance.now();
        const force = p.phase !== lastPhase || p.current === p.total || p.phase !== 'capturing';
        if (!force && now - last < 100) return;
        last = now;
        lastPhase = p.phase;
        onProgress(p);
    };
}

/**
 * Let the browser paint every few frames so the on-screen animation and the progress toast
 * stay alive while the capture loop runs flat out.
 */
async function maybeYield(frame: number): Promise<void> {
    if (frame % 4 === 0) await nextFrame();
}

/** Split "C:\dir\file.mov" into { folder, fileBase } (no extension). */
function splitOutputPath(outputPath: string): { folder: string; fileBase: string } {
    const sep = outputPath.includes('\\') ? '\\' : '/';
    const lastSep = outputPath.lastIndexOf(sep);
    const folder = lastSep >= 0 ? outputPath.slice(0, lastSep) : '';
    const fileBase = (lastSep >= 0 ? outputPath.slice(lastSep + 1) : outputPath).replace(/\.mov$/i, '');
    return { folder, fileBase };
}

/**
 * Record a reranking animation as a .mov file with transparent background.
 *
 * Timeline (seconds):
 *   0.0 – 1.0  Fade out   (opacity 1 → 0)
 *   1.0 – 2.0  Collapse   (marginRight + scaleX, neighbors slide in)
 *   2.0        [apply data — entry moves to new position]
 *   2.0 – 3.0  Open       (marginRight + scaleX, neighbors slide out)
 *   3.0 – 3.6  Fade in    (opacity 0 → 1)
 *   3.42– 4.4  Highlight  (glow pulse, starts at 70% of fade-in)
 *
 * The DOM is animated exactly as before; frames are painted by the FrameCompositor (static
 * chrome captured once per layout, sprites blitted from a sprite sheet at their live rects)
 * and streamed to FFmpeg as they're produced.
 */
export async function recordRerankingAnimation(opts: {
    wrapperEl: HTMLElement;
    findOldEl: () => HTMLElement | null;
    applyData: () => void;
    findNewEl: () => HTMLElement | null;
    onProgress: (p: RecordingProgress) => void;
}): Promise<boolean> {
    const video = window.electronVideo;
    if (!video) {
        opts.onProgress({ phase: 'error', current: 0, total: 0, message: 'Video export requires the desktop app' });
        return false;
    }

    const outputPath = await video.saveFileDialog('reranking.mov');
    if (!outputPath) return false;

    const progress = makeProgress(opts.onProgress);
    const wrapperEl = opts.wrapperEl;

    // Render the root at its natural 1920x1080 by neutralizing the viewport-scale transform
    // (`.wrapper.exporting`), so the live rects the compositor reads are in frame pixels.
    const hadExporting = wrapperEl.classList.contains('exporting');
    if (!hadExporting) wrapperEl.classList.add('exporting');

    const captureOpts = buildCaptureOpts(await buildFontEmbedCSS());
    const comp = new FrameCompositor(wrapperEl, captureOpts);
    const sprites = () => [...wrapperEl.querySelectorAll<HTMLElement>(SPRITES)];
    const overlays = () => [...wrapperEl.querySelectorAll<HTMLElement>(TIER_OVERLAYS)];

    // Timeline
    const FADE_OUT_END  = 1.0;
    const COLLAPSE_END  = 2.0;
    const OPEN_END      = 3.0;
    const FADE_IN_END   = 3.6;
    const HIGHLIGHT_END = 4.4;

    const totalFrames = Math.ceil(HIGHLIGHT_END * FPS);
    let dataApplied = false;
    let naturalWidth = 0;
    let newElMarginLeft = 0;
    const siblingCompensations: { el: HTMLElement; offset: number }[] = [];

    let stream: VideoStream | null = null;
    let below: HTMLCanvasElement | null = null;
    let above: HTMLCanvasElement | null = null;

    // (Re)capture the static layers + any sprites the sheet doesn't have yet.
    async function captureLayers() {
        await comp.ensureSprites(sprites());
        below = await comp.captureLayer({ hide: [...sprites(), ...overlays()] });
        above = await comp.captureLayer({ only: overlays() });
    }

    // Filter is animated per frame in the highlight phase; `.parent` has `transition: filter`
    // which would otherwise make the computed value lag behind what we just set.
    const noTransition = (el: HTMLElement | null) => { if (el) el.style.transition = 'none'; };

    // Reset only what the animation touched — NOT `cssText = ''`, which would also wipe the
    // per-Pokémon CSS variables Vue set inline (--max-height, --scale, ...) and leave the
    // sprite mis-sized until its next re-render.
    const ANIM_PROPS = ['opacity', 'overflow', 'flex-shrink', 'margin-right', 'margin-left', 'transform', 'transform-origin', 'filter', 'transition'];
    // `overflow: hidden` turns a flex item's `min-width: auto` into 0, so in an overflowing
    // (scrollable) row the entry would shrink to zero width on top of its negative margin and
    // the neighbours would jump instead of sliding. Pin the width while the entry is collapsed.
    const collapseBox = (el: HTMLElement) => { el.style.overflow = 'hidden'; el.style.flexShrink = '0'; };
    const clearAnimStyles = (el: HTMLElement | null) => { if (el) for (const p of ANIM_PROPS) el.style.removeProperty(p); };

    const restore = () => {
        clearAnimStyles(opts.findOldEl());
        clearAnimStyles(opts.findNewEl());
        for (const c of siblingCompensations) c.el.style.transform = '';
        if (!hadExporting) wrapperEl.classList.remove('exporting');
    };

    try {
        progress({ phase: 'capturing', current: 0, total: totalFrames, message: 'Preparing frames...' });
        await nextFrame();
        stream = await VideoStream.begin(video, outputPath, FPS, comp.width, comp.height, false);
        noTransition(opts.findOldEl());
        await captureLayers();

        for (let f = 0; f <= totalFrames; f++) {
            const t = f / FPS;
            progress({ phase: 'capturing', current: f, total: totalFrames, message: `Capturing frame ${f}/${totalFrames}` });

            // ── Phase 1: Fade out ──
            if (t < FADE_OUT_END) {
                const el = opts.findOldEl();
                if (el) {
                    const p = easeInOut(t / FADE_OUT_END);
                    el.style.opacity = String(1 - p);
                }

            // ── Phase 2: Collapse (close the old spot) ──
            } else if (t < COLLAPSE_END) {
                const el = opts.findOldEl();
                if (el) {
                    if (naturalWidth === 0) {
                        naturalWidth = el.getBoundingClientRect().width;
                    }
                    el.style.opacity = '0';
                    collapseBox(el);
                    const p = easeInOut((t - FADE_OUT_END) / (COLLAPSE_END - FADE_OUT_END));
                    el.style.marginRight = (-naturalWidth * p) + 'px';
                    el.style.transform = `scaleX(${1 - p})`;
                    el.style.transformOrigin = 'left center';
                }

            // ── Data swap ──
            } else if (!dataApplied) {
                // Snapshot sibling positions before data swap
                const preSwapPositions = new Map<Element, number>();
                for (const row of wrapperEl.querySelectorAll('.entry-row')) {
                    for (const child of row.children) {
                        if ((child as HTMLElement).dataset?.pokemon) {
                            preSwapPositions.set(child, (child as HTMLElement).offsetLeft);
                        }
                    }
                }

                opts.applyData();
                dataApplied = true;
                await nextFrame();
                await nextFrame();

                const newEl = opts.findNewEl();
                if (newEl) {
                    noTransition(newEl);
                    naturalWidth = newEl.getBoundingClientRect().width;
                    newElMarginLeft = parseFloat(getComputedStyle(newEl).marginLeft) || 0;

                    // Collapse with marginLeft zeroed so element takes zero space
                    newEl.style.opacity = '0';
                    collapseBox(newEl);
                    newEl.style.marginRight = (-naturalWidth) + 'px';
                    newEl.style.marginLeft = '0';
                    newEl.style.transform = 'scaleX(0)';
                    newEl.style.transformOrigin = 'left center';

                    // Compensate siblings shifted by neighbor margin changes
                    void newEl.offsetWidth;
                    const row = newEl.parentElement;
                    if (row) {
                        for (const child of row.children) {
                            if (child === newEl || !(child as HTMLElement).dataset?.pokemon) continue;
                            const oldLeft = preSwapPositions.get(child);
                            if (oldLeft !== undefined) {
                                const delta = (child as HTMLElement).offsetLeft - oldLeft;
                                if (Math.abs(delta) > 0.5) {
                                    (child as HTMLElement).style.transform = `translateX(${-delta}px)`;
                                    siblingCompensations.push({ el: child as HTMLElement, offset: -delta });
                                }
                            }
                        }
                    }
                }

                // The data swap re-lays out the tierlist (counts, fades, rows) — recapture the
                // static layers, and pick up the moved entry if it's new to the sheet.
                await captureLayers();
            }

            // ── Phase 3: Open (make room at new spot) ──
            if (dataApplied && t < OPEN_END) {
                const newEl = opts.findNewEl();
                if (newEl) {
                    const p = easeInOut((t - COLLAPSE_END) / (OPEN_END - COLLAPSE_END));
                    newEl.style.opacity = '0';
                    collapseBox(newEl);
                    newEl.style.marginRight = (-naturalWidth * (1 - p)) + 'px';
                    newEl.style.marginLeft = (newElMarginLeft * p) + 'px';
                    newEl.style.transform = `scaleX(${p})`;
                    newEl.style.transformOrigin = 'left center';
                    for (const c of siblingCompensations) {
                        c.el.style.transform = `translateX(${c.offset * (1 - p)}px)`;
                    }
                }

            // ── Phase 4: Fade in ──
            } else if (dataApplied && t < FADE_IN_END) {
                const newEl = opts.findNewEl();
                if (newEl) {
                    newEl.style.marginRight = '';
                    newEl.style.marginLeft = '';
                    newEl.style.transform = '';
                    newEl.style.overflow = '';
                    newEl.style.flexShrink = '';
                    if (siblingCompensations.length > 0) {
                        for (const c of siblingCompensations) c.el.style.transform = '';
                        siblingCompensations.length = 0;
                    }
                    const p = easeInOut((t - OPEN_END) / (FADE_IN_END - OPEN_END));
                    newEl.style.opacity = String(p);
                }

            // ── Phase 5: Highlight glow ──
            } else if (dataApplied && t < HIGHLIGHT_END) {
                const newEl = opts.findNewEl();
                if (newEl) {
                    newEl.style.opacity = '1';
                    const p = (t - FADE_IN_END) / (HIGHLIGHT_END - FADE_IN_END);
                    const glow = p < 0.3 ? p / 0.3 : 1 - ((p - 0.3) / 0.7);
                    const brightness = 1 + glow * 0.6;
                    const shadow = glow * 14;
                    newEl.style.filter = `brightness(${brightness}) drop-shadow(0 0 ${shadow}px rgba(255, 215, 0, ${glow * 0.85}))`;
                }

            // ── Cleanup ──
            } else if (dataApplied) {
                const newEl = opts.findNewEl();
                if (newEl) {
                    clearAnimStyles(newEl);
                    noTransition(newEl);
                }
            }

            comp.clear();
            comp.drawLayer(below!);
            comp.drawSprites(sprites());
            comp.drawLayer(above!);
            await stream.write(comp.pixels());
            await maybeYield(f);
        }

        restore();

        progress({ phase: 'encoding', current: 0, total: 1, message: 'Finishing video...' });
        const result = await stream.end();
        if (!result.success) {
            progress({ phase: 'error', current: 0, total: 0, message: `FFmpeg error: ${result.error}` });
            return false;
        }

        progress({ phase: 'done', current: totalFrames, total: totalFrames, message: `Saved to ${outputPath}` });
        return true;

    } catch (e) {
        progress({ phase: 'error', current: 0, total: 0, message: String(e) });
        if (stream) await stream.abort();
        restore();
        return false;
    }
}

/**
 * Record a horizontal scroll animation of a single tier as a transparent .mov file,
 * and save a PNG of the start and end states alongside it.
 *
 * The scroll is driven by a negative `margin-left` on the row's first flex child (which shifts
 * the whole flex row left and is clipped by the row's overflow — visually identical to
 * scrolling) so the live edge-fade logic stays out of it. The custom overlay scrollbar is
 * hidden by adding the `scroll-capturing` class during capture.
 */
export async function recordScrollAnimation(opts: {
    wrapperEl: HTMLElement;   // root .wrapper (full 1920x1080 capture target)
    scrollEl: HTMLElement;    // the .entry-row to scroll
    fromScroll: number;
    toScroll: number;
    pngBaseName?: string;     // base name for output files (default "scroll")
    saveStatePng: (folder: string, filename: string, dataUrl: string) => Promise<void>;
    durationSec?: number;     // default 2
    onProgress: (p: RecordingProgress) => void;
}): Promise<boolean> {
    const video = window.electronVideo;
    if (!video) {
        opts.onProgress({ phase: 'error', current: 0, total: 0, message: 'Video export requires the desktop app' });
        return false;
    }

    const baseName = opts.pngBaseName || 'scroll';
    const outputPath = await video.saveFileDialog(`${baseName}.mov`);
    if (!outputPath) return false;

    // Sibling output folder + base for the state PNGs, derived from the chosen .mov path.
    const { folder, fileBase } = splitOutputPath(outputPath);

    const progress = makeProgress(opts.onProgress);
    const captureOpts = buildCaptureOpts(await buildFontEmbedCSS());

    const duration = opts.durationSec ?? 2;
    const totalFrames = Math.max(1, Math.round(duration * FPS));

    // --- Prep: drive scroll via margin instead of scrollLeft ---
    const firstChild = opts.scrollEl.firstElementChild as HTMLElement | null;
    const origScrollLeft = opts.scrollEl.scrollLeft;
    const origScrollBehavior = opts.scrollEl.style.scrollBehavior;
    const origMarginLeft = firstChild ? (parseFloat(getComputedStyle(firstChild).marginLeft) || 0) : 0;
    const origFirstChildMarginInline = firstChild ? firstChild.style.marginLeft : '';

    // Render the root at its natural 1920x1080 by neutralizing the viewport-scale transform
    // (the `.wrapper.exporting` CSS sets transform:none / position:static). This is the SAME
    // state the Ctrl+E PNG export uses, so the .mov frames line up pixel-for-pixel with the
    // exported PNGs in an editor.
    const rootHadExporting = opts.wrapperEl.classList.contains('exporting');
    if (!rootHadExporting) opts.wrapperEl.classList.add('exporting');

    // Hide only the overlay scrollbar during capture (NOT the edge fades) by adding
    // `scroll-capturing` to each tier-row wrapper. Only remove what we added.
    const captureClassAdded: HTMLElement[] = [];
    opts.wrapperEl.querySelectorAll<HTMLElement>('.entry-row-wrapper').forEach((el) => {
        if (!el.classList.contains('scroll-capturing')) {
            el.classList.add('scroll-capturing');
            captureClassAdded.push(el);
        }
    });

    // The real left edge-fade is rendered reactively from scrollLeft, so at scrollLeft 0 it's
    // gone — we render our own left-fade, captured once at full opacity and composited per
    // frame with an opacity matching the simulated offset, exactly like the live fade (fades in
    // over 60px).
    //
    // NOTE: the .fade-left CSS in TierList.vue is *scoped* ([data-v-…]), so a manually-created
    // element wouldn't pick it up — we replicate the styles inline instead (kept in sync with
    // the `.fade-left` rule in TierList.vue).
    const wrapperOfTier = opts.scrollEl.parentElement;
    let tempFade: HTMLElement | null = null;
    if (wrapperOfTier) {
        tempFade = document.createElement('div');
        tempFade.style.cssText = [
            'position: absolute',
            'top: 0',
            'bottom: 0',
            'left: 0',
            'width: 60px',
            'pointer-events: none',
            'z-index: 5',
            'border-radius: 11px 0 0 11px',
            'background: linear-gradient(to right, rgba(28, 28, 28, 1) 0%, rgba(28, 28, 28, 0) 100%)',
            'transition: none',
            'opacity: 1',
        ].join('; ');
        wrapperOfTier.appendChild(tempFade);
    }

    const applyScroll = (offset: number) => {
        if (firstChild) firstChild.style.marginLeft = (origMarginLeft - offset) + 'px';
    };

    const restore = () => {
        if (firstChild) firstChild.style.marginLeft = origFirstChildMarginInline;
        if (tempFade && tempFade.parentElement) tempFade.parentElement.removeChild(tempFade);
        for (const el of captureClassAdded) el.classList.remove('scroll-capturing');
        if (!rootHadExporting) opts.wrapperEl.classList.remove('exporting');
        opts.scrollEl.style.scrollBehavior = origScrollBehavior;
        opts.scrollEl.scrollLeft = origScrollLeft;
    };

    let stream: VideoStream | null = null;
    try {
        opts.scrollEl.style.scrollBehavior = 'auto';
        opts.scrollEl.scrollLeft = 0;
        // Let the scroll handler / edge-fade state settle at scrollLeft 0 before capturing chrome.
        await nextFrame();
        await nextFrame();

        progress({ phase: 'capturing', current: 0, total: totalFrames, message: 'Preparing frames...' });
        await nextFrame();

        const comp = new FrameCompositor(opts.wrapperEl, captureOpts);
        const sprites = [...opts.wrapperEl.querySelectorAll<HTMLElement>(SPRITES)];
        const overlays = [...opts.wrapperEl.querySelectorAll<HTMLElement>(TIER_OVERLAYS)];

        // Our left fade: capture it alone (at opacity 1), then take it out of the DOM so the
        // static "above" layer doesn't include it.
        let fadeLayer: HTMLCanvasElement | null = null;
        let fadeX = 0, fadeY = 0;
        if (tempFade && wrapperOfTier) {
            fadeLayer = await comp.captureElement(tempFade);
            const rootRect = opts.wrapperEl.getBoundingClientRect();
            const tierRect = wrapperOfTier.getBoundingClientRect();
            fadeX = tierRect.left - rootRect.left;
            fadeY = tierRect.top - rootRect.top;
            tempFade.remove();
            tempFade = null;
        }

        await comp.ensureSprites(sprites);
        const below = await comp.captureLayer({ hide: [...sprites, ...overlays] });
        const above = await comp.captureLayer({ only: overlays });

        // Lossless RGBA so the .mov frames match the exported PNGs exactly (no color shift).
        stream = await VideoStream.begin(video, outputPath, FPS, comp.width, comp.height, true);

        let firstFrameDataUrl = '';
        let lastFrameDataUrl = '';

        for (let f = 0; f <= totalFrames; f++) {
            const t = f / totalFrames;
            const offset = opts.fromScroll + (opts.toScroll - opts.fromScroll) * easeInOut(t);
            applyScroll(offset);

            progress({ phase: 'capturing', current: f, total: totalFrames, message: `Capturing frame ${f}/${totalFrames}` });

            comp.clear();
            comp.drawLayer(below);
            comp.drawSprites(sprites);
            if (fadeLayer) comp.drawLayer(fadeLayer, fadeX, fadeY, Math.min(Math.max(offset, 0) / 60, 1));
            comp.drawLayer(above);

            if (f === 0) firstFrameDataUrl = comp.toDataURL();
            if (f === totalFrames) lastFrameDataUrl = comp.toDataURL();

            await stream.write(comp.pixels());
            await maybeYield(f);
        }

        // Save the two state PNGs (identical to the video's first/last frames).
        try {
            if (firstFrameDataUrl) await opts.saveStatePng(folder, `${fileBase}-state1.png`, firstFrameDataUrl);
            if (lastFrameDataUrl) await opts.saveStatePng(folder, `${fileBase}-state2.png`, lastFrameDataUrl);
        } catch { /* PNGs are best-effort; continue to finish the video */ }

        progress({ phase: 'encoding', current: 0, total: 1, message: 'Finishing video...' });
        const result = await stream.end();

        if (!result.success) {
            progress({ phase: 'error', current: 0, total: 0, message: `FFmpeg error: ${result.error}` });
            restore();
            return false;
        }

        progress({ phase: 'done', current: totalFrames, total: totalFrames, message: `Saved to ${outputPath}` });
        restore();
        return true;
    } catch (e) {
        progress({ phase: 'error', current: 0, total: 0, message: String(e) });
        if (stream) await stream.abort();
        restore();
        return false;
    }
}

/**
 * Render the tierlist's current state to a PNG data URL the same way the change-animation
 * frames are painted (natural 1920x1080, rows scrolled to the start, edge fades suppressed), so
 * a still lines up pixel-for-pixel with the first/last frame of those videos in an editor.
 * Selection glow (`.active`) is kept; metric popouts are not part of a sprite and are left out.
 */
export async function captureStill(wrapperEl: HTMLElement, captureOpts?: CaptureOpts): Promise<string> {
    const opts = captureOpts ?? buildCaptureOpts(await buildFontEmbedCSS());
    const hadExporting = wrapperEl.classList.contains('exporting');
    if (!hadExporting) wrapperEl.classList.add('exporting');

    const rows = [...wrapperEl.querySelectorAll<HTMLElement>('.entry-row')];
    const prevScroll = rows.map(r => r.scrollLeft);
    const fades = [...wrapperEl.querySelectorAll<HTMLElement>('.fade-left, .fade-right')];
    const prevDisplay = fades.map(el => el.style.display);
    try {
        for (const r of rows) r.scrollLeft = 0;
        for (const el of fades) el.style.display = 'none';
        await nextFrame();

        const comp = new FrameCompositor(wrapperEl, opts);
        const sprites = [...wrapperEl.querySelectorAll<HTMLElement>(SPRITES)];
        const labels = [...wrapperEl.querySelectorAll<HTMLElement>('.threshold-label')];
        await comp.ensureSprites(sprites);
        const below = await comp.captureLayer({ hide: [...sprites, ...labels] });
        const above = await comp.captureLayer({ only: labels });

        comp.clear();
        comp.drawLayer(below);
        comp.drawSprites(sprites);
        comp.drawLayer(above);
        return comp.toDataURL();
    } finally {
        fades.forEach((el, i) => { el.style.display = prevDisplay[i]; });
        rows.forEach((r, i) => { r.scrollLeft = prevScroll[i]; });
        if (!hadExporting) wrapperEl.classList.remove('exporting');
    }
}

/**
 * Record a "change animation": morph the tierlist from one state (`applyFrom`, e.g. the layout
 * at date 1) to another (`applyTo`, e.g. the layout at date 2). Shared Pokémon slide (eased)
 * from their old position to their new one, Pokémon that disappear fade out, and Pokémon that
 * appear fade in — all simultaneously ("magic move"). The static backdrop (counts, labels)
 * crossfades from the start state's to the end state's as the new Pokémon fade in, so the first
 * and last frames match stills of the two states exactly.
 *
 * Because each tier row uses `overflow:hidden`, an in-place transform can't carry a sprite
 * across tiers without being clipped. So during capture the real sprites are hidden and every
 * sprite is rendered as an absolutely-positioned clone in an un-clipped overlay layered over the
 * static backdrop (tier rows / labels / counts). The overlay clones are animated each frame and
 * painted by the compositor from the sprite sheet.
 *
 * Exported as a transparent, lossless .mov (exact color match to the PNG exports), exactly
 * like the scroll animation export.
 */
export async function recordChangeAnimation(opts: {
    wrapperEl: HTMLElement;                        // root .wrapper (1920x1080 capture target)
    applyFrom: () => Promise<void>;                // put the tierlist in the start state and await re-render
    applyTo: () => Promise<void>;                  // put the tierlist in the end state and await re-render
    outputPath?: string;                           // write here instead of asking with a save dialog
    captureOpts?: CaptureOpts;                     // reuse across a batch of exports (fonts are fetched once)
    morphSec?: number;                             // slide/fade duration (default 1.6)
    holdStartSec?: number;                         // hold on date1 before morph (default 0.15)
    holdEndSec?: number;                           // hold on date2 after morph (default 0.2)
    onProgress: (p: RecordingProgress) => void;
}): Promise<boolean> {
    const video = window.electronVideo;
    if (!video) {
        opts.onProgress({ phase: 'error', current: 0, total: 0, message: 'Video export requires the desktop app' });
        return false;
    }

    const outputPath = opts.outputPath ?? await video.saveFileDialog('change.mov');
    if (!outputPath) return false;

    const progress = makeProgress(opts.onProgress);
    const captureOpts = opts.captureOpts ?? buildCaptureOpts(await buildFontEmbedCSS());

    const wrapperEl = opts.wrapperEl;

    // Render the root at its natural 1920x1080 by neutralizing the viewport-scale transform
    // (`.wrapper.exporting`), the SAME state the Ctrl+E PNG export uses, so the .mov frames line
    // up pixel-for-pixel. `.exporting` makes the wrapper position:static, so also force
    // position:relative so it is the offset parent for the absolute overlay.
    const hadExporting = wrapperEl.classList.contains('exporting');
    if (!hadExporting) wrapperEl.classList.add('exporting');
    const prevPosition = wrapperEl.style.position;
    wrapperEl.style.position = 'relative';

    type Snap = { left: number; top: number; clone: HTMLElement };

    function resetRowScroll() {
        wrapperEl.querySelectorAll<HTMLElement>('.entry-row').forEach(r => { r.scrollLeft = 0; });
    }

    // The right edge-fade overlay (`.fade-right`) darkens the area near each threshold label so
    // sprites that scroll under the label fade out. During this export the moving sprites are
    // rendered as overlay clones (above the labels), so that fade isn't wanted — and it shows up
    // as an unexpected darkening near the labels vs. a plain screenshot. Suppress both edge fades
    // for the duration of the capture; they're restored afterwards.
    const hiddenFades: { el: HTMLElement; display: string }[] = [];
    function hideEdgeFades() {
        wrapperEl.querySelectorAll<HTMLElement>('.fade-left, .fade-right').forEach(el => {
            hiddenFades.push({ el, display: el.style.display });
            el.style.display = 'none';
        });
    }

    // Build a detached, absolutely-positioned clone of a sprite at the given wrapper-relative pos.
    function makeClone(el: HTMLElement, left: number, top: number): HTMLElement {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.classList.remove('active');   // strip selection glow
        clone.classList.add('no-hover');
        clone.style.position = 'absolute';
        clone.style.left = left + 'px';
        clone.style.top = top + 'px';
        clone.style.margin = '0';           // measured rect already includes flex margins
        clone.style.transition = 'none';
        return clone;
    }

    // Measure every visible sprite's position (relative to the wrapper) and snapshot a clone now,
    // because date1-only sprites are torn out of the DOM once we switch to date2.
    async function measure(): Promise<Map<string, Snap>> {
        resetRowScroll();
        await nextFrame();
        const wrapRect = wrapperEl.getBoundingClientRect();
        const m = new Map<string, Snap>();
        wrapperEl.querySelectorAll<HTMLElement>(SPRITES).forEach(el => {
            const name = el.dataset.pokemon;
            if (!name) return;
            const r = el.getBoundingClientRect();
            const left = r.left - wrapRect.left;
            const top = r.top - wrapRect.top;
            m.set(name, { left, top, clone: makeClone(el, left, top) });
        });
        return m;
    }

    const hiddenReal: { el: HTMLElement; vis: string }[] = [];
    let overlay: HTMLElement | null = null;

    const restore = () => {
        if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
        for (const h of hiddenReal) h.el.style.visibility = h.vis;
        for (const h of hiddenFades) h.el.style.display = h.display;
        wrapperEl.style.position = prevPosition;
        if (!hadExporting) wrapperEl.classList.remove('exporting');
        resetRowScroll();
    };

    let stream: VideoStream | null = null;
    try {
        progress({ phase: 'capturing', current: 0, total: 1, message: 'Preparing frames...' });

        // Measure both endpoint layouts.
        await opts.applyFrom();
        const map1 = await measure();
        const comp = new FrameCompositor(wrapperEl, captureOpts);
        // The start state's backdrop (no sprites, no edge fades), crossfaded out during the morph.
        const belowFrom = await comp.captureLayer({
            hide: wrapperEl.querySelectorAll(`${SPRITES}, .fade-left, .fade-right`),
        });
        await opts.applyTo();   // the end state is the final rendered backdrop
        const map2 = await measure();

        type Anim =
            | { kind: 'shared'; el: HTMLElement; from: Snap; to: Snap }
            | { kind: 'removed'; el: HTMLElement }
            | { kind: 'added'; el: HTMLElement };
        const anims: Anim[] = [];

        overlay = document.createElement('div');
        overlay.className = 'change-overlay';
        overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;';

        // Shared + added come from the date2 snapshot (identical markup, current image src).
        for (const [name, s2] of map2) {
            const s1 = map1.get(name);
            if (s1) {
                const el = s2.clone;
                el.style.left = s1.left + 'px';   // start at old position, slide to s2
                el.style.top = s1.top + 'px';
                overlay.appendChild(el);
                anims.push({ kind: 'shared', el, from: s1, to: s2 });
            } else {
                const el = s2.clone;
                el.style.opacity = '0';
                overlay.appendChild(el);
                anims.push({ kind: 'added', el });
            }
        }
        // Removed come from the date1 snapshot, parked at their old position, fading out.
        for (const [name, s1] of map1) {
            if (!map2.has(name)) {
                overlay.appendChild(s1.clone);
                anims.push({ kind: 'removed', el: s1.clone });
            }
        }

        // Hide the real sprites (the backdrop keeps tier rows, labels and counts). Done AFTER
        // cloning so the clones stay visible.
        wrapperEl.querySelectorAll<HTMLElement>(SPRITES).forEach(el => {
            hiddenReal.push({ el, vis: el.style.visibility });
            el.style.visibility = 'hidden';
        });
        wrapperEl.appendChild(overlay);

        // Suppress the edge-fade overlays now that the date2 backdrop is settled, so the morph
        // doesn't show an unwanted darkening near the threshold labels.
        hideEdgeFades();
        await nextFrame();

        const clones = anims.map(a => a.el);
        await comp.ensureSprites(clones);
        // Backdrop: everything but sprites (the overlay clones paint above the labels, so there
        // is no "above" layer here).
        const below = await comp.captureLayer({ hide: wrapperEl.querySelectorAll(SPRITES) });

        // Lossless RGBA so the .mov frames match the exported PNGs exactly (no color shift).
        stream = await VideoStream.begin(video, outputPath, FPS, comp.width, comp.height, true);

        const morph = opts.morphSec ?? 1.6;
        const holdStart = opts.holdStartSec ?? 0.15;
        const holdEnd = opts.holdEndSec ?? 0.2;
        const totalFrames = Math.round((holdStart + morph + holdEnd) * FPS);

        for (let f = 0; f <= totalFrames; f++) {
            const t = f / FPS;
            const raw = t < holdStart ? 0
                : t < holdStart + morph ? (t - holdStart) / morph
                : 1;
            const p = easeInOut(raw);
            // Removed clears out over the first ~50% of the morph; added holds off until the last
            // ~40% so the moving sprites have time to slide into their new neighborhood first.
            const removedOpacity = 1 - Math.min(1, p / 0.5);
            const addedOpacity = Math.min(1, Math.max(0, (p - 0.6) / 0.4));

            for (const a of anims) {
                if (a.kind === 'shared') {
                    a.el.style.left = (a.from.left + (a.to.left - a.from.left) * p) + 'px';
                    a.el.style.top = (a.from.top + (a.to.top - a.from.top) * p) + 'px';
                } else if (a.kind === 'removed') {
                    a.el.style.opacity = String(removedOpacity);
                } else {
                    a.el.style.opacity = String(addedOpacity);
                }
            }

            progress({ phase: 'capturing', current: f, total: totalFrames, message: `Capturing frame ${f}/${totalFrames}` });

            // Backdrop changes (mostly the ranked count) land together with the new Pokémon.
            comp.clear();
            if (addedOpacity < 1) comp.drawLayer(belowFrom);
            comp.drawLayer(below, 0, 0, addedOpacity);
            comp.drawSprites(clones, { clip: false });
            await stream.write(comp.pixels());
            await maybeYield(f);
        }

        progress({ phase: 'encoding', current: 0, total: 1, message: 'Finishing video...' });
        const result = await stream.end();

        if (!result.success) {
            progress({ phase: 'error', current: 0, total: 0, message: `FFmpeg error: ${result.error}` });
            restore();
            return false;
        }

        progress({ phase: 'done', current: totalFrames, total: totalFrames, message: `Saved to ${outputPath}` });
        restore();
        return true;
    } catch (e) {
        progress({ phase: 'error', current: 0, total: 0, message: String(e) });
        if (stream) await stream.abort();
        restore();
        return false;
    }
}
