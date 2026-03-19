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
 * This works by manually stepping through the animation frame-by-frame:
 *  1. For each frame, compute the animation state (opacity, width, etc.)
 *  2. Apply inline styles to the element
 *  3. Capture the wrapper as a transparent PNG via html-to-image
 *  4. Save the frame to a temp directory on disk
 *  5. After all frames are captured, encode to ProRes 4444 .mov via ffmpeg
 *
 * The animation timeline (in seconds):
 *   0.0 – 1.0  Fade out   (opacity 1 → 0)
 *   1.0 – 2.0  Collapse   (width → 0, neighbors slide in)
 *   2.0        [apply data — entry moves to new position]
 *   2.0 – 3.0  Open       (width 0 → natural, neighbors slide out)
 *   3.0 – 3.6  Fade in    (opacity 0 → 1)
 *   3.6 – 4.4  Highlight  (glow pulse)
 */
export async function recordRerankingAnimation(opts: {
    /** The wrapper element to capture (1920×1080) */
    wrapperEl: HTMLElement;
    /** The PkmnImage element at the OLD position (before data change) */
    findOldEl: () => HTMLElement | null;
    /** Apply buffered insertions (called at t=2.0) */
    applyData: () => void;
    /** Find the PkmnImage element at the NEW position (after data change) */
    findNewEl: () => HTMLElement | null;
    /** Progress callback */
    onProgress: (p: RecordingProgress) => void;
}): Promise<boolean> {
    const video = window.electronVideo;
    if (!video) {
        opts.onProgress({ phase: 'error', current: 0, total: 0, message: 'Video export requires the desktop app' });
        return false;
    }

    // Ask user where to save
    const outputPath = await video.saveFileDialog('reranking.mov');
    if (!outputPath) return false;

    const tmpDir = await video.createTempDir();

    // Pre-build font CSS for html-to-image (same approach as PNG exporter)
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

    // Timeline definition
    const FADE_OUT_END = 1.0;
    const COLLAPSE_END = 2.0;
    const OPEN_END     = 3.0;
    const FADE_IN_END  = 3.6;
    const HIGHLIGHT_END = 4.4;

    const totalFrames = Math.ceil(HIGHLIGHT_END * FPS);
    let frameIndex = 0;
    let dataApplied = false;
    let naturalWidth = 0;

    // Ease in-out cubic
    function easeInOut(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    try {
        for (let f = 0; f <= totalFrames; f++) {
            const t = f / FPS;
            opts.onProgress({ phase: 'capturing', current: f, total: totalFrames, message: `Capturing frame ${f}/${totalFrames}` });

            // Apply the correct visual state for this point in time
            if (t < FADE_OUT_END) {
                // Fade out phase
                const progress = easeInOut(t / FADE_OUT_END);
                const el = opts.findOldEl();
                if (el) {
                    el.style.opacity = String(1 - progress);
                }
            } else if (t < COLLAPSE_END) {
                // Collapse phase
                const el = opts.findOldEl();
                if (el) {
                    if (naturalWidth === 0) {
                        // Measure once at start of collapse
                        el.style.opacity = '0';
                        naturalWidth = el.getBoundingClientRect().width;
                    }
                    const progress = easeInOut((t - FADE_OUT_END) / (COLLAPSE_END - FADE_OUT_END));
                    el.style.opacity = '0';
                    el.style.width = (naturalWidth * (1 - progress)) + 'px';
                    el.style.overflow = 'hidden';
                }
            } else if (!dataApplied) {
                // Apply data at t=2.0
                const oldEl = opts.findOldEl();
                if (oldEl) oldEl.style.cssText = '';

                opts.applyData();
                dataApplied = true;

                // Wait for Vue re-render
                await nextFrame();
                await nextFrame();

                // Measure new element's natural width
                const newEl = opts.findNewEl();
                if (newEl) {
                    naturalWidth = newEl.getBoundingClientRect().width;
                    // Start collapsed
                    newEl.style.width = '0px';
                    newEl.style.overflow = 'hidden';
                    newEl.style.opacity = '0';
                }
            }

            if (dataApplied && t >= COLLAPSE_END && t < OPEN_END) {
                // Open phase
                const newEl = opts.findNewEl();
                if (newEl) {
                    const progress = easeInOut((t - COLLAPSE_END) / (OPEN_END - COLLAPSE_END));
                    newEl.style.width = (naturalWidth * progress) + 'px';
                    newEl.style.overflow = 'hidden';
                    newEl.style.opacity = '0';
                }
            } else if (dataApplied && t >= OPEN_END && t < FADE_IN_END) {
                // Fade in phase
                const newEl = opts.findNewEl();
                if (newEl) {
                    newEl.style.width = '';
                    newEl.style.overflow = '';
                    const progress = easeInOut((t - OPEN_END) / (FADE_IN_END - OPEN_END));
                    newEl.style.opacity = String(progress);
                }
            } else if (dataApplied && t >= FADE_IN_END && t < HIGHLIGHT_END) {
                // Highlight phase — glow via filter
                const newEl = opts.findNewEl();
                if (newEl) {
                    newEl.style.width = '';
                    newEl.style.overflow = '';
                    newEl.style.opacity = '1';
                    const progress = (t - FADE_IN_END) / (HIGHLIGHT_END - FADE_IN_END);
                    // Glow peaks at 30% then fades
                    const glow = progress < 0.3 ? progress / 0.3 : 1 - ((progress - 0.3) / 0.7);
                    const brightness = 1 + glow * 0.6;
                    const shadow = glow * 14;
                    newEl.style.filter = `brightness(${brightness}) drop-shadow(0 0 ${shadow}px rgba(255, 215, 0, ${glow * 0.85}))`;
                }
            } else if (dataApplied && t >= HIGHLIGHT_END) {
                // End — clear all styles
                const newEl = opts.findNewEl();
                if (newEl) newEl.style.cssText = '';
            }

            // Let the browser paint
            await nextFrame();

            // Capture the frame
            const dataUrl = await htmlToImage.toPng(opts.wrapperEl, captureOpts);
            await video.saveFrame(tmpDir, frameIndex, dataUrl);
            frameIndex++;
        }

        // Clean up any remaining inline styles
        const cleanEl = opts.findNewEl();
        if (cleanEl) cleanEl.style.cssText = '';

        // Encode
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

        // Clean up inline styles on error
        const el1 = opts.findOldEl();
        const el2 = opts.findNewEl();
        if (el1) el1.style.cssText = '';
        if (el2) el2.style.cssText = '';

        return false;
    }
}

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
