import * as htmlToImage from 'html-to-image';

const FPS = 60;

export type RecordingProgress = {
    phase: 'capturing' | 'encoding' | 'done' | 'error';
    current: number;
    total: number;
    message: string;
};

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

    // Pre-build font CSS for html-to-image
    let fontEmbedCSS = '';
    try {
        const fontFiles = [
            { family: 'Teko', url: '/fonts/Teko-Bold.ttf' },
            { family: 'play', url: '/fonts/Play-Bold.ttf' },
            { family: 'oseb', url: '/fonts/OpenSans-ExtraBold.ttf' },
            { family: 'osb', url: '/fonts/Play-Bold.ttf' },
            { family: 'titan', url: '/fonts/TitanOne-Regular.ttf' },
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
        fontEmbedCSS = (await Promise.all(promises)).join('\n');
    } catch { /* fallback */ }

    const captureOpts = {
        backgroundColor: 'transparent' as string,
        cacheBust: false,
        pixelRatio: 1,
        skipFonts: true,
        ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: false, preferredFontFormat: 'truetype' as const }),
    };

    // Timeline
    const FADE_OUT_END  = 1.0;
    const COLLAPSE_END  = 2.0;
    const OPEN_END      = 3.0;
    const FADE_IN_END   = 3.6;
    const HIGHLIGHT_END = 4.4;
    const GLOW_START    = FADE_IN_END - 0.3 * (FADE_IN_END - OPEN_END); // 70% into fade-in

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

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
