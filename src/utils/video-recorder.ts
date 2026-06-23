import * as htmlToImage from 'html-to-image';

const FPS = 60;

export type RecordingProgress = {
    phase: 'capturing' | 'encoding' | 'done' | 'error';
    current: number;
    total: number;
    message: string;
};

/** Build embedded base64 @font-face CSS so html-to-image renders the correct fonts. */
async function buildFontEmbedCSS(): Promise<string> {
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
function buildCaptureOpts(fontEmbedCSS: string) {
    return {
        backgroundColor: 'transparent' as string,
        cacheBust: false,
        pixelRatio: 1,
        skipFonts: true,
        ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: false, preferredFontFormat: 'truetype' as const }),
    };
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

    const tmpDir = await video.createTempDir();

    // Pre-build font CSS + capture options for html-to-image
    const captureOpts = buildCaptureOpts(await buildFontEmbedCSS());

    // Timeline
    const FADE_OUT_END  = 1.0;
    const COLLAPSE_END  = 2.0;
    const OPEN_END      = 3.0;
    const FADE_IN_END   = 3.6;
    const HIGHLIGHT_END = 4.4;


    const totalFrames = Math.ceil(HIGHLIGHT_END * FPS);
    let frameIndex = 0;
    let dataApplied = false;
    let naturalWidth = 0;
    let newElMarginLeft = 0;
    const siblingCompensations: { el: HTMLElement; offset: number }[] = [];

    function easeInOut(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    try {
        for (let f = 0; f <= totalFrames; f++) {
            const t = f / FPS;
            opts.onProgress({ phase: 'capturing', current: f, total: totalFrames, message: `Capturing frame ${f}/${totalFrames}` });

            // ── Phase 1: Fade out ──
            if (t < FADE_OUT_END) {
                const el = opts.findOldEl();
                if (el) {
                    const progress = easeInOut(t / FADE_OUT_END);
                    el.style.opacity = String(1 - progress);
                }

            // ── Phase 2: Collapse (close the old spot) ──
            } else if (t < COLLAPSE_END) {
                const el = opts.findOldEl();
                if (el) {
                    if (naturalWidth === 0) {
                        naturalWidth = el.getBoundingClientRect().width;
                    }
                    el.style.opacity = '0';
                    el.style.overflow = 'hidden';
                    const progress = easeInOut((t - FADE_OUT_END) / (COLLAPSE_END - FADE_OUT_END));
                    el.style.marginRight = (-naturalWidth * progress) + 'px';
                    el.style.transform = `scaleX(${1 - progress})`;
                    el.style.transformOrigin = 'left center';
                }

            // ── Data swap ──
            } else if (!dataApplied) {
                // Snapshot sibling positions before data swap
                const preSwapPositions = new Map<Element, number>();
                for (const row of opts.wrapperEl.querySelectorAll('.entry-row')) {
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
                    naturalWidth = newEl.getBoundingClientRect().width;
                    newElMarginLeft = parseFloat(getComputedStyle(newEl).marginLeft) || 0;

                    // Collapse with marginLeft zeroed so element takes zero space
                    newEl.style.opacity = '0';
                    newEl.style.overflow = 'hidden';
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
            }

            // ── Phase 3: Open (make room at new spot) ──
            if (dataApplied && t < OPEN_END) {
                const newEl = opts.findNewEl();
                if (newEl) {
                    const progress = easeInOut((t - COLLAPSE_END) / (OPEN_END - COLLAPSE_END));
                    newEl.style.opacity = '0';
                    newEl.style.overflow = 'hidden';
                    newEl.style.marginRight = (-naturalWidth * (1 - progress)) + 'px';
                    newEl.style.marginLeft = (newElMarginLeft * progress) + 'px';
                    newEl.style.transform = `scaleX(${progress})`;
                    newEl.style.transformOrigin = 'left center';
                    for (const c of siblingCompensations) {
                        c.el.style.transform = `translateX(${c.offset * (1 - progress)}px)`;
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
                    if (siblingCompensations.length > 0) {
                        for (const c of siblingCompensations) c.el.style.transform = '';
                        siblingCompensations.length = 0;
                    }
                    const progress = easeInOut((t - OPEN_END) / (FADE_IN_END - OPEN_END));
                    newEl.style.opacity = String(progress);
                }

            // ── Phase 5: Highlight glow ──
            } else if (dataApplied && t < HIGHLIGHT_END) {
                const newEl = opts.findNewEl();
                if (newEl) {
                    newEl.style.opacity = '1';
                    const progress = (t - FADE_IN_END) / (HIGHLIGHT_END - FADE_IN_END);
                    const glow = progress < 0.3 ? progress / 0.3 : 1 - ((progress - 0.3) / 0.7);
                    const brightness = 1 + glow * 0.6;
                    const shadow = glow * 14;
                    newEl.style.filter = `brightness(${brightness}) drop-shadow(0 0 ${shadow}px rgba(255, 215, 0, ${glow * 0.85}))`;
                }

            // ── Cleanup ──
            } else if (dataApplied) {
                const newEl = opts.findNewEl();
                if (newEl) newEl.style.cssText = '';
            }

            await nextFrame();
            const dataUrl = await htmlToImage.toPng(opts.wrapperEl, captureOpts);
            await video.saveFrame(tmpDir, frameIndex, dataUrl);
            frameIndex++;
        }

        const cleanEl = opts.findNewEl();
        if (cleanEl) cleanEl.style.cssText = '';

        opts.onProgress({ phase: 'encoding', current: 0, total: 1, message: 'Encoding video with FFmpeg...' });
        const result = await video.encode(tmpDir, outputPath, FPS);

        if (!result.success) {
            opts.onProgress({ phase: 'error', current: 0, total: 0, message: `FFmpeg error: ${result.error}` });
            await video.cleanup(tmpDir);
            return false;
        }

        opts.onProgress({ phase: 'done', current: totalFrames, total: totalFrames, message: `Saved to ${outputPath}` });
        await video.cleanup(tmpDir);
        return true;

    } catch (e) {
        opts.onProgress({ phase: 'error', current: 0, total: 0, message: String(e) });
        try { await video.cleanup(tmpDir); } catch { /* ignore */ }
        const el1 = opts.findOldEl();
        const el2 = opts.findNewEl();
        if (el1) el1.style.cssText = '';
        if (el2) el2.style.cssText = '';
        for (const c of siblingCompensations) c.el.style.transform = '';
        return false;
    }
}

/**
 * Record a horizontal scroll animation of a single tier as a transparent .mov file,
 * and save a PNG of the start and end states alongside it.
 *
 * html-to-image does not preserve live `scrollLeft`, so the scroll is driven by a negative
 * `margin-left` on the row's first flex child (which shifts the whole flex row left and is
 * clipped by the row's overflow — visually identical to scrolling). The custom overlay
 * scrollbar + left edge-fade are hidden by adding the `exporting` class during capture.
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

    // Derive sibling output folder + base for the state PNGs from the chosen .mov path.
    const sep = outputPath.includes('\\') ? '\\' : '/';
    const lastSep = outputPath.lastIndexOf(sep);
    const folder = lastSep >= 0 ? outputPath.slice(0, lastSep) : '';
    const fileBase = (lastSep >= 0 ? outputPath.slice(lastSep + 1) : outputPath).replace(/\.mov$/i, '');

    const tmpDir = await video.createTempDir();
    const captureOpts = buildCaptureOpts(await buildFontEmbedCSS());

    const FPS = 60;
    const duration = opts.durationSec ?? 2;
    const totalFrames = Math.max(1, Math.round(duration * FPS));

    function easeInOut(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // --- Prep: drive scroll via margin instead of scrollLeft so html-to-image captures it ---
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

    // The captured scroll is faked via a negative margin on the first flex child while the
    // live scrollLeft stays 0 (html-to-image ignores scrollLeft anyway). The real left
    // edge-fade is rendered reactively from scrollLeft, so at scrollLeft 0 it's gone — we
    // add our own temporary left-fade overlay and drive its opacity to match the simulated
    // offset, exactly like the live fade (fades in over 60px).
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
            'transition: none', // set opacity instantly per frame, no lag
            'opacity: 0',
        ].join('; ');
        wrapperOfTier.appendChild(tempFade);
    }

    const applyScroll = (offset: number) => {
        if (firstChild) firstChild.style.marginLeft = (origMarginLeft - offset) + 'px';
        if (tempFade) tempFade.style.opacity = String(Math.min(Math.max(offset, 0) / 60, 1));
    };

    const restore = () => {
        if (firstChild) firstChild.style.marginLeft = origFirstChildMarginInline;
        if (tempFade && tempFade.parentElement) tempFade.parentElement.removeChild(tempFade);
        for (const el of captureClassAdded) el.classList.remove('scroll-capturing');
        if (!rootHadExporting) opts.wrapperEl.classList.remove('exporting');
        opts.scrollEl.style.scrollBehavior = origScrollBehavior;
        opts.scrollEl.scrollLeft = origScrollLeft;
    };

    try {
        opts.scrollEl.style.scrollBehavior = 'auto';
        opts.scrollEl.scrollLeft = 0;

        let firstFrameDataUrl = '';
        let lastFrameDataUrl = '';

        for (let f = 0; f <= totalFrames; f++) {
            const t = f / totalFrames;
            const offset = opts.fromScroll + (opts.toScroll - opts.fromScroll) * easeInOut(t);
            applyScroll(offset);

            opts.onProgress({ phase: 'capturing', current: f, total: totalFrames, message: `Capturing frame ${f}/${totalFrames}` });

            await nextFrame();
            const dataUrl = await htmlToImage.toPng(opts.wrapperEl, captureOpts);
            await video.saveFrame(tmpDir, f, dataUrl);

            if (f === 0) firstFrameDataUrl = dataUrl;
            if (f === totalFrames) lastFrameDataUrl = dataUrl;
        }

        // Save the two state PNGs (identical to the video's first/last frames).
        try {
            if (firstFrameDataUrl) await opts.saveStatePng(folder, `${fileBase}-state1.png`, firstFrameDataUrl);
            if (lastFrameDataUrl) await opts.saveStatePng(folder, `${fileBase}-state2.png`, lastFrameDataUrl);
        } catch { /* PNGs are best-effort; continue to encode the video */ }

        opts.onProgress({ phase: 'encoding', current: 0, total: 1, message: 'Encoding video with FFmpeg...' });
        // Lossless RGBA so the .mov frames match the exported PNGs exactly (no color shift).
        const result = await video.encode(tmpDir, outputPath, FPS, true);

        if (!result.success) {
            opts.onProgress({ phase: 'error', current: 0, total: 0, message: `FFmpeg error: ${result.error}` });
            await video.cleanup(tmpDir);
            restore();
            return false;
        }

        opts.onProgress({ phase: 'done', current: totalFrames, total: totalFrames, message: `Saved to ${outputPath}` });
        await video.cleanup(tmpDir);
        restore();
        return true;
    } catch (e) {
        opts.onProgress({ phase: 'error', current: 0, total: 0, message: String(e) });
        try { await video.cleanup(tmpDir); } catch { /* ignore */ }
        restore();
        return false;
    }
}

/**
 * Record a "change animation": morph the tierlist from the layout at `date1` to the layout
 * at `date2`. Shared Pokémon slide (eased) from their old position to their new one, Pokémon
 * that disappear fade out, and Pokémon that appear fade in — all simultaneously ("magic move").
 *
 * Because each tier row uses `overflow:hidden`, an in-place transform can't carry a sprite
 * across tiers without being clipped. So during capture the real sprites are hidden and every
 * sprite is rendered as an absolutely-positioned clone in an un-clipped overlay layered over the
 * static backdrop (tier rows / labels / counts). The overlay clones are animated each frame.
 *
 * Exported as a transparent, lossless qtrle .mov (exact color match to the PNG exports), exactly
 * like the scroll animation export.
 */
export async function recordChangeAnimation(opts: {
    wrapperEl: HTMLElement;                        // root .wrapper (1920x1080 capture target)
    setDate: (date: string) => Promise<void>;      // set releaseDateTreshold and await re-render
    date1: string;
    date2: string;
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

    const outputPath = await video.saveFileDialog('change.mov');
    if (!outputPath) return false;

    const tmpDir = await video.createTempDir();
    const captureOpts = buildCaptureOpts(await buildFontEmbedCSS());

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

    function easeInOut(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
        return clone;
    }

    // Measure every visible sprite's position (relative to the wrapper) and snapshot a clone now,
    // because date1-only sprites are torn out of the DOM once we switch to date2.
    async function measure(): Promise<Map<string, Snap>> {
        resetRowScroll();
        await nextFrame();
        const wrapRect = wrapperEl.getBoundingClientRect();
        const m = new Map<string, Snap>();
        wrapperEl.querySelectorAll<HTMLElement>('[data-pokemon]').forEach(el => {
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

    try {
        // Measure both endpoint layouts.
        await opts.setDate(opts.date1);
        const map1 = await measure();
        await opts.setDate(opts.date2);   // date2 is the final rendered backdrop
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
        wrapperEl.querySelectorAll<HTMLElement>('[data-pokemon]').forEach(el => {
            hiddenReal.push({ el, vis: el.style.visibility });
            el.style.visibility = 'hidden';
        });
        wrapperEl.appendChild(overlay);

        // Suppress the edge-fade overlays now that the date2 backdrop is settled, so the morph
        // doesn't show an unwanted darkening near the threshold labels.
        hideEdgeFades();

        const FPS = 60;
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

            opts.onProgress({ phase: 'capturing', current: f, total: totalFrames, message: `Capturing frame ${f}/${totalFrames}` });
            await nextFrame();
            const dataUrl = await htmlToImage.toPng(wrapperEl, captureOpts);
            await video.saveFrame(tmpDir, f, dataUrl);
        }

        opts.onProgress({ phase: 'encoding', current: 0, total: 1, message: 'Encoding video with FFmpeg...' });
        // Lossless RGBA (qtrle) so the .mov frames match the exported PNGs exactly (no color shift).
        const result = await video.encode(tmpDir, outputPath, FPS, true);

        if (!result.success) {
            opts.onProgress({ phase: 'error', current: 0, total: 0, message: `FFmpeg error: ${result.error}` });
            await video.cleanup(tmpDir);
            restore();
            return false;
        }

        opts.onProgress({ phase: 'done', current: totalFrames, total: totalFrames, message: `Saved to ${outputPath}` });
        await video.cleanup(tmpDir);
        restore();
        return true;
    } catch (e) {
        opts.onProgress({ phase: 'error', current: 0, total: 0, message: String(e) });
        try { await video.cleanup(tmpDir); } catch { /* ignore */ }
        restore();
        return false;
    }
}

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
