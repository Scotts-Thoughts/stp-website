<script setup lang="ts">
import { computed, ref, watch, nextTick, useTemplateRef, onMounted, onUnmounted } from 'vue'
import { onKeyDown } from '@vueuse/core';
import PkmnImage from './PkmnImage.vue';
import MetricPopout from './MetricPopout.vue';
import CameraAutomateWindow from './CameraAutomateWindow.vue';
import { useContextMenu, useTierlist, useFileExporter, useGlobal, useReranking, useWorkspace, useToast, RerankPhase, METRIC, CreditMode } from '../store';
import { hasAlternativeMoveType } from '../utils/pokemon';
import * as htmlToImage from 'html-to-image';

const tierlist = useTierlist();
const fileexporter = useFileExporter();
const globalStore = useGlobal();
const reranking = useReranking();
const workspace = useWorkspace();
const toast = useToast();

// Tier colors (solid midpoint colors from the gradients)
const TIER_COLORS = [
    '#e80000', // S - Red
    '#ea8d33', // A - Orange
    '#e5ca0a', // B - Yellow
    '#76c747', // C - Green
    '#6394e0', // D - Blue
    '#6333ce', // E - Purple
    '#752d74', // F - Dark Purple
    '#5b0032', // Surge - Maroon
    '#7a0016', // Bruno - Dark Red
    '#5a3f07', // Impossible - Brown
];

// Layout constants
const PADDING_LEFT = 80;
const PADDING_RIGHT = 40;
const AXIS_Y = 540;
const MAX_SPRITE_SIZE = 69;
const MIN_SPRITE_SIZE = 28;
const ABOVE_MIN_Y = 90;
const BELOW_MAX_Y = 1000;
const TIMELINE_WIDTH = 1920 - PADDING_LEFT - PADDING_RIGHT;

// The credits overlay occupies the bottom-right corner. Entries whose x falls
// within this horizontal band are forced above the axis so they don't render
// behind the credits (the timeline itself still spans the full width). Widths
// match the credits-column widths used by the TierList view; Infinity = off.
const creditLeftX = computed(() => {
    switch (globalStore.creditMode) {
        case CreditMode.SMALL: return 1920 - 10 - 531;
        case CreditMode.BIG: return 1920 - 10 - 715;
        default: return Infinity;
    }
});

// Top y of the credits overlay (matches the TierList grid rows the credits span).
// Threshold value labels within the credits band are lifted above this line.
const creditTopY = computed(() => {
    switch (globalStore.creditMode) {
        case CreditMode.SMALL: return 759; // grid row 8
        case CreditMode.BIG: return 652;   // grid row 7
        default: return Infinity;
    }
});

// Zoom & pan state
const viewMin = ref<number | null>(null); // null = show full range
const viewMax = ref<number | null>(null);
const containerRef = useTemplateRef('container');

// Drag-to-pan state
let dragState: { startX: number; startViewMin: number; startViewMax: number } | null = null;

const tierData = computed(() => [
    { name: tierlist.activeTierlist.sTierLabel || "S", index: 0 },
    { name: tierlist.activeTierlist.aTierLabel || "A", index: 1 },
    { name: tierlist.activeTierlist.bTierLabel || "B", index: 2 },
    { name: tierlist.activeTierlist.cTierLabel || "C", index: 3 },
    { name: tierlist.activeTierlist.dTierLabel || "D", index: 4 },
    { name: tierlist.activeTierlist.eTierLabel || "E", index: 5 },
    { name: tierlist.activeTierlist.fTierLabel || "F", index: 6 },
    { name: tierlist.activeTierlist.surgeTierLabel || "Surge", index: 7 },
]);

// 90 hours in milliseconds — time-metric entries beyond this are shown as edge bubbles
const EXTREME_OUTLIER_MS = 90 * 60 * 60 * 1000;

type TimelineEntry = {
    pkmnName: string;
    value: number;
    formattedValue: string;
    tierIndex: number;
    color: string;
};

// Build timeline entries from grouped entries (zoom-independent)
const baseTimelineData = computed(() => {
    const metricKey = tierlist.activeMetric;
    const groups = tierlist.groupedEntries;
    const threshold = tierlist.activeThresholdList?.[tierlist.activeThresholdIndex]?.data;
    if (!threshold) return { entries: [] as TimelineEntry[], extremeOutliers: [] as TimelineEntry[], fullMin: 0, fullMax: 1, defaultMin: 0, defaultMax: 1, threshold };

    const formatter = METRIC[metricKey].formatValue ?? ((x: number) => x.toString());
    const isTime = metricKey.includes('time');

    const allEntries: TimelineEntry[] = [];

    for (let tierIdx = 0; tierIdx < groups.length; tierIdx++) {
        if (tierIdx === 9) continue;
        for (const entry of groups[tierIdx]) {
            if (hasAlternativeMoveType(entry.pkmnName)) continue;
            let metric = entry.metrics[metricKey];
            if (typeof metric === "function") metric = metric();
            if (metric === undefined || metric < 0) continue;
            allEntries.push({
                pkmnName: entry.pkmnName,
                value: metric as number,
                formattedValue: formatter(metric as number),
                tierIndex: tierIdx,
                color: TIER_COLORS[tierIdx],
            });
        }
    }

    // Separate extreme outliers (90h+ for time metrics) — shown as edge bubbles
    const extremeOutliers: TimelineEntry[] = [];
    const entries: TimelineEntry[] = [];
    for (const e of allEntries) {
        if (isTime && e.value >= EXTREME_OUTLIER_MS) {
            extremeOutliers.push(e);
        } else {
            entries.push(e);
        }
    }

    if (entries.length === 0) return { entries: [], extremeOutliers, fullMin: 0, fullMax: 1, defaultMin: 0, defaultMax: 1, threshold };

    entries.sort((a, b) => a.value - b.value);

    const minVal = entries[0].value;
    const maxVal = entries[entries.length - 1].value;

    // Full range — the zoom/pan boundaries (actual data range, excluding 90h+ extremes)
    const fullRange = maxVal - minVal || 1;
    const fullMin = Math.max(0, minVal - fullRange * 0.03);
    const fullMax = maxVal + fullRange * 0.03;

    // Default view range — capped by thresholds so outliers don't compress the view on open
    const maxThresh = Math.max(...threshold);
    const minThresh = Math.min(...threshold);
    const threshSpan = maxThresh - minThresh || 1;
    const softCap = maxThresh + threshSpan * 0.5;
    const softFloor = minThresh - threshSpan * 0.5;
    const effectiveMax = maxVal > softCap ? softCap : maxVal;
    const effectiveMin = minVal < softFloor ? softFloor : minVal;
    const defRange = effectiveMax - effectiveMin || 1;
    const defaultMin = Math.max(0, effectiveMin - defRange * 0.03);
    const defaultMax = effectiveMax + defRange * 0.03;

    return { entries, extremeOutliers, fullMin, fullMax, defaultMin, defaultMax, threshold };
});

// The visible range (respects zoom)
// null = full range; initial view is set to the default (capped) range on mount
const visibleRange = computed(() => {
    const { fullMin, fullMax } = baseTimelineData.value;
    return {
        min: viewMin.value ?? fullMin,
        max: viewMax.value ?? fullMax,
    };
});

const isZoomed = computed(() => viewMin.value !== null);

// Compute optimal sprite size for a given value range
function computeSpriteSize(entries: { value: number }[], rangeMin: number, rangeMax: number): number {
    if (entries.length === 0) return MAX_SPRITE_SIZE;

    const range = rangeMax - rangeMin || 1;
    const aboveSpace = AXIS_Y - ABOVE_MIN_Y - GAP_FROM_AXIS;
    const belowSpace = BELOW_MAX_Y - AXIS_Y - GAP_FROM_AXIS;

    for (let size = MAX_SPRITE_SIZE; size >= MIN_SPRITE_SIZE; size -= 2) {
        const minXDist = size + 4;
        const rowHeight = size + 8;
        const availableRows = Math.floor(aboveSpace / rowHeight) + Math.floor(belowSpace / rowHeight);

        const xPositions = entries
            .map(e => PADDING_LEFT + (((e.value - rangeMin) / range) * TIMELINE_WIDTH))
            .sort((a, b) => a - b);

        let maxDensity = 0;
        let left = 0;
        for (let right = 0; right < xPositions.length; right++) {
            while (xPositions[right] - xPositions[left] > minXDist) left++;
            maxDensity = Math.max(maxDensity, right - left + 1);
        }

        if (maxDensity <= availableRows) return size;
    }
    return MIN_SPRITE_SIZE;
}

// Sprite size at default zoom — used for stable above/below assignment in baseLayout
const fullZoomSpriteSize = computed(() => {
    const { entries, extremeOutliers, defaultMin, defaultMax } = baseTimelineData.value;
    return computeSpriteSize([...entries, ...extremeOutliers], defaultMin, defaultMax);
});

// Target sprite size at current zoom level
const targetSpriteSize = computed(() => {
    const { entries } = baseTimelineData.value;
    const { min, max } = visibleRange.value;
    const range = max - min || 1;
    const margin = range * 0.08;
    const visibleEntries = entries.filter(e => e.value >= min - margin && e.value <= max + margin);
    if (visibleEntries.length === 0) return MAX_SPRITE_SIZE;
    return computeSpriteSize(visibleEntries, min, max);
});

// Smoothly animated sprite size
const spriteSize = ref(MAX_SPRITE_SIZE);
let spriteSizeFrameId: number | null = null;
let _inPlayback = false; // non-reactive flag: snap sprite size immediately during playback/recording

watch(targetSpriteSize, (target) => {
    // Snap immediately on first computation (no animation on load)
    if (spriteSize.value === MAX_SPRITE_SIZE && target !== MAX_SPRITE_SIZE) {
        spriteSize.value = target;
        return;
    }
    // During recording, sprite size is driven manually (smoothed) in the capture loop.
    if (_inRecording) {
        if (spriteSizeFrameId) { cancelAnimationFrame(spriteSizeFrameId); spriteSizeFrameId = null; }
        return;
    }
    // During playback, snap immediately to eliminate lag
    if (_inPlayback) {
        spriteSize.value = target;
        if (spriteSizeFrameId) { cancelAnimationFrame(spriteSizeFrameId); spriteSizeFrameId = null; }
        return;
    }
    if (spriteSizeFrameId) return;
    function lerpTick() {
        const current = spriteSize.value;
        const tgt = targetSpriteSize.value;
        const diff = tgt - current;
        if (Math.abs(diff) < 1) {
            spriteSize.value = tgt;
            spriteSizeFrameId = null;
            return;
        }
        const step = diff * 0.12;
        const rounded = diff > 0 ? Math.ceil(current + step) : Math.floor(current + step);
        spriteSize.value = Math.max(MIN_SPRITE_SIZE, Math.min(MAX_SPRITE_SIZE, rounded));
        spriteSizeFrameId = requestAnimationFrame(lerpTick);
    }
    spriteSizeFrameId = requestAnimationFrame(lerpTick);
}, { immediate: true });

// Threshold positions, tick marks etc. computed from visible range
const timelineView = computed(() => {
    const { threshold } = baseTimelineData.value;
    const { min, max } = visibleRange.value;
    const range = max - min || 1;
    if (!threshold) return { thresholdPositions: [], tickMarks: [] };

    const metricKey = tierlist.activeMetric;
    const labelFormatter = METRIC[metricKey].formatLabel ?? ((x: number) => x.toString());

    // The threshold-line container's bottom edge sits at this screen y (matches the
    // .threshold-line bottom inset in CSS).
    const LINE_BOTTOM_Y = 1080 - 35;
    const thresholdPositions: { pct: number; value: number; label: string; tierIndex: number; color: string; tierName: string; valueBottom: number }[] = [];
    for (let i = 0; i < 8; i++) {
        const tVal = threshold[i];
        const pct = ((tVal - min) / range) * 100;
        if (pct >= -10 && pct <= 110) {
            // Lift the value label above the credits overlay while any part of its text
            // overlaps the credits column — the label is centered on threshX, so it stays
            // lifted until the whole text has cleared the credits' left edge (then it
            // slides back down). Width is estimated from the text (16px Play-Bold ≈ 9px/char).
            const threshX = PADDING_LEFT + (pct / 100) * TIMELINE_WIDTH;
            const label = labelFormatter(tVal);
            const labelHalfWidth = (label.length * 9) / 2;
            const overlapsCredits = threshX + labelHalfWidth >= creditLeftX.value;
            const valueBottom = overlapsCredits ? Math.max(0, LINE_BOTTOM_Y - creditTopY.value + 10) : 0;
            thresholdPositions.push({
                pct,
                value: tVal,
                label,
                tierIndex: i,
                color: TIER_COLORS[i],
                tierName: tierData.value[i]?.name ?? '',
                valueBottom,
            });
        }
    }

    const tickMarks = generateTickMarks(min, max, metricKey, labelFormatter);

    // Collision avoidance between threshold labels and tick labels.
    // Thresholds are the important labels — they only hide when they crowd EACH OTHER.
    // Tick marks yield to thresholds: any tick too close to a threshold is filtered out.
    const MIN_LABEL_DIST = 80; // minimum px between label centers
    const threshXPositions = thresholdPositions.map(tp => PADDING_LEFT + (tp.pct / 100) * TIMELINE_WIDTH);

    // Threshold labels: all hide together if any two thresholds are too close
    let thresholdLabelsVisible = true;
    for (let i = 0; i < threshXPositions.length && thresholdLabelsVisible; i++) {
        for (let j = i + 1; j < threshXPositions.length; j++) {
            if (Math.abs(threshXPositions[i] - threshXPositions[j]) < MIN_LABEL_DIST) {
                thresholdLabelsVisible = false;
                break;
            }
        }
    }

    // Filter out tick marks that collide with visible threshold labels
    const filteredTickMarks = thresholdLabelsVisible
        ? tickMarks.filter(t => {
            const tx = PADDING_LEFT + (t.pct / 100) * TIMELINE_WIDTH;
            return !threshXPositions.some(thx => Math.abs(tx - thx) < MIN_LABEL_DIST);
        })
        : tickMarks;

    // Build axis segments colored by tier
    // Thresholds divide the axis: values below threshold[0] = S, below threshold[1] = A, etc.
    const axisSegments: { leftPct: number; widthPct: number; color: string }[] = [];
    const sortedThresholds = threshold
        .map((val: number, i: number) => ({ val, color: TIER_COLORS[i] }))
        .sort((a: { val: number }, b: { val: number }) => a.val - b.val);

    // Build raw boundaries (unclamped), then clip to 0-100%
    const boundaries: { pct: number; color: string }[] = [];
    for (const { val, color } of sortedThresholds) {
        boundaries.push({ pct: ((val - min) / range) * 100, color });
    }
    // Add final boundary at far right for the last tier
    boundaries.push({ pct: 200, color: TIER_COLORS[8] });

    // Map data percentages to full-width container (0-1920px)
    // Data area spans from PADDING_LEFT to PADDING_LEFT+TIMELINE_WIDTH within 1920px
    const dataLeftPct = (PADDING_LEFT / 1920) * 100;
    const dataWidthPct = (TIMELINE_WIDTH / 1920) * 100;

    let prevPct = -100; // start well off-screen left
    for (const { pct, color } of boundaries) {
        // Map data pct (0-100% of data area) to container pct (0-100% of 1920px)
        const mappedLeft = dataLeftPct + (Math.max(0, prevPct) / 100) * dataWidthPct;
        const mappedRight = dataLeftPct + (Math.min(100, pct) / 100) * dataWidthPct;
        // Extend first segment to left edge, last segment to right edge
        const finalLeft = prevPct <= 0 ? 0 : mappedLeft;
        const finalRight = pct >= 100 ? 100 : mappedRight;
        if (finalRight > finalLeft) {
            axisSegments.push({ leftPct: finalLeft, widthPct: finalRight - finalLeft, color });
        }
        prevPct = pct;
    }

    return { thresholdPositions, thresholdLabelsVisible, tickMarks: filteredTickMarks, axisSegments };
});

// Collision avoidance constants (derived from dynamic sprite size)
const GAP_FROM_AXIS = 40; // enough clearance for tick labels below/above axis

// Run collision avoidance at default zoom to determine stable above/below assignments.
// This only recomputes when the underlying data changes, NOT when zoom/pan changes.
const baseLayout = computed(() => {
    const { entries, extremeOutliers, defaultMin, defaultMax } = baseTimelineData.value;
    if (entries.length === 0 && extremeOutliers.length === 0) return new Map<string, 'above' | 'below'>();

    const ss = fullZoomSpriteSize.value;
    const minXDist = ss + 4;
    const rowHeight = ss + 8;
    const range = defaultMax - defaultMin || 1;

    // Compute X positions at default zoom; extreme outliers are clamped to right edge
    const withX = [...entries, ...extremeOutliers].map(entry => {
        const xPct = ((entry.value - defaultMin) / range) * 100;
        const xPx = Math.min(PADDING_LEFT + TIMELINE_WIDTH, PADDING_LEFT + (xPct / 100) * TIMELINE_WIDTH);
        return { pkmnName: entry.pkmnName, xPx };
    });

    const aboveRows: { xPx: number }[][] = [];
    const belowRows: { xPx: number }[][] = [];
    const sideMap = new Map<string, 'above' | 'below'>();

    for (const entry of withX) {
        let placed = false;
        const maxRows = Math.max(aboveRows.length, belowRows.length) + 1;

        for (let rowLevel = 0; rowLevel < maxRows && !placed; rowLevel++) {
            // Try above
            if (rowLevel < aboveRows.length) {
                const row = aboveRows[rowLevel];
                if (!row.some(e => Math.abs(e.xPx - entry.xPx) < minXDist)) {
                    const yPx = AXIS_Y - GAP_FROM_AXIS - ss - rowLevel * rowHeight;
                    if (yPx >= ABOVE_MIN_Y) {
                        row.push({ xPx: entry.xPx });
                        sideMap.set(entry.pkmnName, 'above');
                        placed = true;
                        break;
                    }
                }
            } else if (rowLevel === aboveRows.length) {
                const yPx = AXIS_Y - GAP_FROM_AXIS - ss - rowLevel * rowHeight;
                if (yPx >= ABOVE_MIN_Y) {
                    aboveRows.push([{ xPx: entry.xPx }]);
                    sideMap.set(entry.pkmnName, 'above');
                    placed = true;
                    break;
                }
            }

            // Try below
            if (rowLevel < belowRows.length) {
                const row = belowRows[rowLevel];
                if (!row.some(e => Math.abs(e.xPx - entry.xPx) < minXDist)) {
                    const yPx = AXIS_Y + GAP_FROM_AXIS + rowLevel * rowHeight;
                    if (yPx + ss <= BELOW_MAX_Y) {
                        row.push({ xPx: entry.xPx });
                        sideMap.set(entry.pkmnName, 'below');
                        placed = true;
                        break;
                    }
                }
            } else if (rowLevel === belowRows.length) {
                const yPx = AXIS_Y + GAP_FROM_AXIS + rowLevel * rowHeight;
                if (yPx + ss <= BELOW_MAX_Y) {
                    belowRows.push([{ xPx: entry.xPx }]);
                    sideMap.set(entry.pkmnName, 'below');
                    placed = true;
                    break;
                }
            }
        }

        if (!placed) {
            if (aboveRows.length > 0) {
                aboveRows[aboveRows.length - 1].push({ xPx: entry.xPx });
            } else {
                aboveRows.push([{ xPx: entry.xPx }]);
            }
            sideMap.set(entry.pkmnName, 'above');
        }
    }

    return sideMap;
});

// During re-ranking, pin the animating Pokemon to its original side of the axis
const rerankSideOverride = ref<Map<string, 'above' | 'below'>>(new Map());

// Connector-line geometry for a sprite at vertical position `topY` with size `ss`.
function connectorGeom(topY: number, ss: number): { lineTop: number; lineHeight: number } {
    const spriteCenter = topY + ss / 2;
    if (spriteCenter < AXIS_Y) {
        const lineTop = topY + ss;
        return { lineTop, lineHeight: AXIS_Y - lineTop };
    }
    return { lineTop: AXIS_Y, lineHeight: topY - AXIS_Y };
}

// Positioned entries within the visible range — uses stable above/below from baseLayout
const positionedEntries = computed(() => {
    const { entries, extremeOutliers } = baseTimelineData.value;
    const { min, max } = visibleRange.value;
    if (entries.length === 0 && extremeOutliers.length === 0) return [];

    const baseSideMap = baseLayout.value;
    const overrides = rerankSideOverride.value;
    // Merge: overrides take precedence over base layout
    const sideMap = overrides.size > 0
        ? new Map([...baseSideMap, ...overrides])
        : baseSideMap;
    const ss = spriteSize.value;
    const rowHeight = ss + 8;
    const range = max - min || 1;

    // Each entry carries a horizontal collision footprint: a center `cx` and half-width
    // `chw`. Regular entries are just the sprite; extreme-outlier bubbles also include the
    // value-text pill (see below), so neighbours collide with the whole UI, not only the art.
    const includeMargin = range * 0.08;
    const withX = entries
        .filter(e => e.value >= min - includeMargin && e.value <= max + includeMargin)
        .map(entry => {
            const xPct = ((entry.value - min) / range) * 100;
            const xPx = PADDING_LEFT + (xPct / 100) * TIMELINE_WIDTH;
            return { ...entry, xPx, cx: xPx, chw: ss / 2, yPx: 0, lineTop: 0, lineHeight: 0, isExtremeOutlier: false, popoutAbove: false };
        });

    // Add extreme outliers clamped to the right edge (always visible). They render as a pill
    // (sprite + value text) anchored at `right: 20px` — see .outlier-bubble CSS — so the
    // collision footprint spans the whole pill: 1px border + 2/10px padding + 6px gap + the
    // value text (~8px/char at 13px Play-Bold). Using the full width keeps neighbouring
    // sprites from sliding under the time label.
    const OUTLIER_RIGHT_EDGE = 1920 - 20;
    for (const outlier of extremeOutliers) {
        const bubbleWidth = ss + 20 + outlier.formattedValue.length * 8;
        withX.push({
            ...outlier,
            xPx: PADDING_LEFT + TIMELINE_WIDTH,
            cx: OUTLIER_RIGHT_EDGE - bubbleWidth / 2,
            chw: bubbleWidth / 2,
            yPx: 0, lineTop: 0, lineHeight: 0,
            isExtremeOutlier: true,
            popoutAbove: false,
        });
    }

    // Place entries using their stable side assignment, with collision avoidance within each side
    // Clamp to screen bounds
    const maxAboveRows = Math.floor((AXIS_Y - GAP_FROM_AXIS - ABOVE_MIN_Y) / rowHeight);
    const maxBelowRows = Math.floor((BELOW_MAX_Y - AXIS_Y - GAP_FROM_AXIS) / rowHeight);

    type RowItem = { cx: number; chw: number };
    const aboveRows: RowItem[][] = [];
    const belowRows: RowItem[][] = [];

    const creditX = creditLeftX.value;
    const COLLISION_GAP = 4; // minimum clear space between two footprints in the same row

    // Place a footprint (center `cx`, half-width `chw`) into the first row of a side whose
    // existing footprints it doesn't overlap, creating a new row if needed. Returns the row
    // level, or -1 if the side is full (every row up to `maxRows` already overlaps it).
    const placeInSide = (rows: RowItem[][], maxRows: number, item: RowItem): number => {
        for (let rowLevel = 0; rowLevel < maxRows; rowLevel++) {
            if (rowLevel < rows.length) {
                if (!rows[rowLevel].some(e => Math.abs(e.cx - item.cx) < e.chw + item.chw + COLLISION_GAP)) {
                    rows[rowLevel].push(item);
                    return rowLevel;
                }
            } else {
                rows.push([item]);
                return rowLevel;
            }
        }
        return -1;
    };

    const yForRow = (above: boolean, rowLevel: number): number =>
        above
            ? AXIS_Y - GAP_FROM_AXIS - ss - rowLevel * rowHeight
            : AXIS_Y + GAP_FROM_AXIS + rowLevel * rowHeight;

    for (const entry of withX) {
        // Credits occupy the bottom-right corner: force entries in that horizontal
        // band above the axis so they dodge the credits overlay.
        const preferAbove = entry.xPx >= creditX || (sideMap.get(entry.pkmnName) ?? 'above') === 'above';

        const footprint = { cx: entry.cx, chw: entry.chw };

        // 1) Try the entry's preferred side.
        let above = preferAbove;
        let rowLevel = placeInSide(above ? aboveRows : belowRows, above ? maxAboveRows : maxBelowRows, footprint);

        // 2) Preferred side is full — spill to the other side rather than overlapping.
        //    computeSpriteSize sizes sprites so the densest cluster fits in above+below rows
        //    combined, so the other side is guaranteed to have a free row here.
        if (rowLevel === -1) {
            above = !preferAbove;
            rowLevel = placeInSide(above ? aboveRows : belowRows, above ? maxAboveRows : maxBelowRows, footprint);
        }

        // 3) Both sides full (extreme density even at the minimum sprite size) — force into
        //    the preferred side's last row as a last resort.
        if (rowLevel === -1) {
            above = preferAbove;
            const rows = above ? aboveRows : belowRows;
            rowLevel = Math.max(0, (above ? maxAboveRows : maxBelowRows) - 1);
            if (rows.length > rowLevel) rows[rowLevel].push(footprint);
            else rows.push([footprint]);
        }

        entry.yPx = yForRow(above, rowLevel);

        // Connector line
        const geom = connectorGeom(entry.yPx, ss);
        entry.lineTop = geom.lineTop;
        entry.lineHeight = geom.lineHeight;
    }

    // Determine popout direction with bounds checking
    const POPOUT_HEIGHT = 250;
    for (const entry of withX) {
        const isAboveAxis = entry.yPx + ss / 2 < AXIS_Y;
        if (isAboveAxis) {
            entry.popoutAbove = entry.yPx - POPOUT_HEIGHT >= 0;
        } else {
            entry.popoutAbove = entry.yPx + ss + POPOUT_HEIGHT > 1080;
        }
    }

    return withX;
});

// Split positioned entries for template rendering
const regularEntries = computed(() => positionedEntries.value.filter(e => !e.isExtremeOutlier));
const extremeEntries = computed(() => positionedEntries.value.filter(e => e.isExtremeOutlier));

// --- Animation system for smooth zoom/pan ---
let animTargetMin: number | null = null;
let animTargetMax: number | null = null;
let animFrameId: number | null = null;
let animLerp = 0.12; // active lerp factor (set per-action)
const ANIM_LERP_ZOOM = 0.12; // lerp for zoom (snappier)
const ANIM_LERP_PAN = 0.06; // lerp for pan (slower, more deliberate)
const ANIM_EPSILON = 0.5; // stop animating when within this many ms of target

function animateTick() {
    if (animTargetMin === null || animTargetMax === null) {
        animFrameId = null;
        return;
    }

    const { fullMin, fullMax } = baseTimelineData.value;
    const fullRange = fullMax - fullMin;
    const curMin = viewMin.value ?? fullMin;
    const curMax = viewMax.value ?? fullMax;

    // Lerp toward target
    const newMin = curMin + (animTargetMin - curMin) * animLerp;
    const newMax = curMax + (animTargetMax - curMax) * animLerp;

    // Check if close enough to snap
    if (Math.abs(newMin - animTargetMin) < ANIM_EPSILON && Math.abs(newMax - animTargetMax) < ANIM_EPSILON) {
        // Snap to target
        if (animTargetMax - animTargetMin >= fullRange * 0.99) {
            viewMin.value = null;
            viewMax.value = null;
        } else {
            viewMin.value = animTargetMin;
            viewMax.value = animTargetMax;
        }
        animTargetMin = null;
        animTargetMax = null;
        animFrameId = null;
        return;
    }

    if (newMax - newMin >= fullRange * 0.99) {
        viewMin.value = null;
        viewMax.value = null;
    } else {
        viewMin.value = newMin;
        viewMax.value = newMax;
    }

    animFrameId = requestAnimationFrame(animateTick);
}

function startAnimation(targetMin: number, targetMax: number) {
    animTargetMin = targetMin;
    animTargetMax = targetMax;
    if (!animFrameId) {
        animFrameId = requestAnimationFrame(animateTick);
    }
}

function clampRange(newMin: number, newMax: number): [number, number] {
    const { fullMin, fullMax } = baseTimelineData.value;
    if (newMin < fullMin) { newMax += fullMin - newMin; newMin = fullMin; }
    if (newMax > fullMax) { newMin -= newMax - fullMax; newMax = fullMax; }
    return [Math.max(fullMin, newMin), Math.min(fullMax, newMax)];
}

// Zoom: scroll wheel zooms into the cursor position on the timeline
function onWheel(e: WheelEvent) {
    e.preventDefault();
    const { fullMin, fullMax } = baseTimelineData.value;
    const fullRange = fullMax - fullMin;
    if (fullRange <= 0) return;

    const animated = e.altKey || e.shiftKey;

    // For animated modes, start from the animation target if one is in flight
    const curMin = animated && animTargetMin !== null ? animTargetMin : (viewMin.value ?? fullMin);
    const curMax = animated && animTargetMax !== null ? animTargetMax : (viewMax.value ?? fullMax);
    const curRange = curMax - curMin;

    // Shift+Wheel: smooth pan
    if (e.shiftKey && !e.altKey) {
        const panAmount = curRange * 0.08 * (e.deltaY > 0 ? 1 : -1);
        const [newMin, newMax] = clampRange(curMin + panAmount, curMax + panAmount);
        animLerp = ANIM_LERP_PAN;
        startAnimation(newMin, newMax);
        return;
    }

    // Get cursor position as fraction of timeline width
    const rect = containerRef.value?.getBoundingClientRect();
    if (!rect) return;
    const scale = 1920 / rect.width;
    const mouseX = (e.clientX - rect.left) * scale;
    const frac = Math.max(0, Math.min(1, (mouseX - PADDING_LEFT) / TIMELINE_WIDTH));

    // Zoom factor
    const zoomSpeed = e.altKey ? 0.25 : 0.15;
    const factor = e.deltaY > 0 ? (1 + zoomSpeed) : (1 - zoomSpeed);
    const newRange = Math.min(fullRange, Math.max(curRange * 0.001, curRange * factor));

    // Keep the point under the cursor fixed
    const cursorValue = curMin + frac * curRange;
    let newMin = cursorValue - frac * newRange;
    let newMax = cursorValue + (1 - frac) * newRange;

    [newMin, newMax] = clampRange(newMin, newMax);

    if (e.altKey) {
        // Alt+Wheel: animated zoom
        animLerp = ANIM_LERP_ZOOM;
        startAnimation(newMin, newMax);
    } else {
        // Plain wheel: instant zoom (existing behavior)
        if (newMax - newMin >= fullRange * 0.99) {
            viewMin.value = null;
            viewMax.value = null;
        } else {
            viewMin.value = newMin;
            viewMax.value = newMax;
        }
    }
}

// Pan: click-drag to pan when zoomed
function onMouseDown(e: MouseEvent) {
    if (!isZoomed.value) return;
    // Only pan on left-click, not on sprites
    if (e.button !== 0) return;

    const rect = containerRef.value?.getBoundingClientRect();
    if (!rect) return;

    dragState = {
        startX: e.clientX,
        startViewMin: viewMin.value!,
        startViewMax: viewMax.value!,
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e: MouseEvent) {
    if (!dragState) return;

    const rect = containerRef.value?.getBoundingClientRect();
    if (!rect) return;

    const scale = 1920 / rect.width;
    const deltaXPx = (e.clientX - dragState.startX) * scale;
    const curRange = dragState.startViewMax - dragState.startViewMin;
    const deltaValue = -(deltaXPx / TIMELINE_WIDTH) * curRange;

    const { fullMin, fullMax } = baseTimelineData.value;

    let newMin = dragState.startViewMin + deltaValue;
    let newMax = dragState.startViewMax + deltaValue;

    // Clamp
    if (newMin < fullMin) { newMax += fullMin - newMin; newMin = fullMin; }
    if (newMax > fullMax) { newMin -= newMax - fullMax; newMax = fullMax; }
    newMin = Math.max(fullMin, newMin);
    newMax = Math.min(fullMax, newMax);

    viewMin.value = newMin;
    viewMax.value = newMax;
}

function onMouseUp() {
    dragState = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
}

function generateTickMarks(min: number, max: number, metricKey: string, formatter: (x: number) => string) {
    const range = max - min;
    const isTime = metricKey.includes('time');
    const ticks: { pct: number; label: string }[] = [];

    if (isTime) {
        const intervals = [
            10_000,       // 10 sec
            30_000,       // 30 sec
            60_000,       // 1 min
            120_000,      // 2 min
            300_000,      // 5 min
            600_000,      // 10 min
            900_000,      // 15 min
            1_800_000,    // 30 min
            3_600_000,    // 1 hr
            7_200_000,    // 2 hr
        ];
        let interval = intervals[0];
        for (const iv of intervals) {
            if (range / iv <= 15) {
                interval = iv;
                break;
            }
        }
        const margin = range * 0.08; // extend past visible edges so ticks fade in/out
        const start = Math.ceil((min - margin) / interval) * interval;
        for (let v = start; v <= max + margin; v += interval) {
            const pct = ((v - min) / range) * 100;
            ticks.push({ pct, label: formatter(v) });
        }
    } else {
        const step = Math.pow(10, Math.floor(Math.log10(range / 6)));
        const niceStep = range / step > 10 ? step * 2 : step;
        const margin = range * 0.08;
        const start = Math.ceil((min - margin) / niceStep) * niceStep;
        for (let v = start; v <= max + margin; v += niceStep) {
            const pct = ((v - min) / range) * 100;
            ticks.push({ pct, label: formatter(v) });
        }
    }

    return ticks;
}

function unselectAll() {
    tierlist.activePkmn = '';
    tierlist.activePrev = '';
    tierlist.selectedPkmn.clear();
}

// --- Snapshot & Camera Automation ---
export type CameraSnapshot = {
    name: string;
    viewMin: number | null;
    viewMax: number | null;
};

export type CameraSequenceStep = {
    type: 'animate';
    startSnapshot: string;
    endSnapshot: string;
    durationMs: number;
} | {
    type: 'wait';
    durationMs: number;
};

const snapshots = ref<CameraSnapshot[]>([]);
const cameraWindowActive = ref(false);
const sequence = ref<CameraSequenceStep[]>([]);

// Playback state
const isPlaying = ref(false);
const countdown = ref(0); // 3, 2, 1, 0 (0 = no countdown)
let playbackFrameId: number | null = null;
const isRecording = ref(false);
const recordingProgress = ref({ current: 0, total: 0, message: '' });
let recordingCancelled = false;

// --- Deterministic motion smoothing during recording ---
// In live playback, vertical sprite moves are smoothed by the CSS `transition: top`.
// html-to-image samples that transition at wall-clock-variable progress (each frame
// capture takes an unpredictable amount of real time), which makes the exported video
// lurch instead of glide. During recording we instead smooth sprite Y + size ourselves,
// frame-by-frame, and disable the CSS transitions (see `.recording-capture` styles).
const recordSmoothY = ref<Map<string, number>>(new Map());
// Smoothed opacity multiplier (0-1) for the threshold value labels while recording, so
// they fade in/out as the crowding state changes instead of popping (the live CSS
// transition is sampled at unpredictable progress during frame capture).
const recordLabelOpacity = ref(1);
// Smoothed credits-dodge offset (px) per threshold (keyed by tier index) while recording:
// the label snaps up to clear the credits but eases back down once its text has cleared.
const recordLabelBottom = ref<Map<number, number>>(new Map());
let _inRecording = false;       // non-reactive: spriteSize is driven manually while recording
let _recordSmoothInit = false;  // first smoothing frame snaps to target (no slide-in)
const RECORD_SMOOTH = 0.15;     // per-frame lerp factor (~matches the live 0.55s ease)

// --- Camera persistence ---
const hasElectronVideo = !!window.electronVideo;
const CAMERA_FILENAME = '_camera.json';

function getCameraKey(): string {
    return `${tierlist.activeTierlist?.name || 'default'}::${tierlist.activeMetric || 'default'}`;
}

async function saveCameraData() {
    let allData: Record<string, { snapshots: CameraSnapshot[]; sequence: CameraSequenceStep[] }> = {};
    try {
        if (window.electronFS) {
            try {
                const raw = await window.electronFS.readFile(CAMERA_FILENAME);
                allData = JSON.parse(raw);
            } catch { /* file doesn't exist yet */ }
        } else {
            const raw = localStorage.getItem('stp-camera-data');
            if (raw) allData = JSON.parse(raw);
        }
    } catch { /* ignore */ }

    const key = getCameraKey();
    allData[key] = {
        snapshots: snapshots.value,
        sequence: sequence.value,
    };

    try {
        const json = JSON.stringify(allData, null, 2);
        if (window.electronFS) {
            await window.electronFS.writeFile(CAMERA_FILENAME, json);
        } else {
            localStorage.setItem('stp-camera-data', json);
        }
    } catch (e) {
        console.warn('Failed to save camera data:', e);
    }
}

async function loadCameraData() {
    const key = getCameraKey();
    try {
        let raw: string | null = null;
        if (window.electronFS) {
            try {
                raw = await window.electronFS.readFile(CAMERA_FILENAME);
            } catch { /* file doesn't exist */ }
        } else {
            raw = localStorage.getItem('stp-camera-data');
        }
        if (!raw) return;
        const allData = JSON.parse(raw);
        const data = allData[key];
        if (data) {
            snapshots.value = data.snapshots || [];
            sequence.value = (data.sequence || []).map((step: any) => {
                // Migration: old steps without type field
                if (!step.type) return { type: 'animate' as const, ...step };
                return step;
            });
        }
    } catch { /* no saved data */ }
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveCameraData(), 500);
}

// --- Camera easing with C1 continuity (no derivative jumps at transitions) ---
const EASE_CAP_MS = 1500;

function cameraEase(t: number, durationMs: number): number {
    const easeFrac = Math.min(0.5, EASE_CAP_MS / durationMs);

    if (easeFrac >= 0.5) {
        // Short animation: cubic ease-in-out
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // Long animation: ease-in, linear cruise, ease-out
    // Cubic polynomials with matching position AND derivative at phase boundaries
    // Derivative is 0 at endpoints and 1 (matching linear speed) at transitions
    const ef = easeFrac;
    if (t <= ef) {
        // Ease-in: f(0)=0, f(ef)=ef, f'(0)=0, f'(ef)=1
        return -t * t * t / (ef * ef) + 2 * t * t / ef;
    } else if (t >= 1 - ef) {
        // Ease-out: g(0)=1-ef, g(ef)=1, g'(0)=1, g'(ef)=0
        const s = t - (1 - ef);
        return -s * s * s / (ef * ef) + s * s / ef + s + 1 - ef;
    } else {
        // Linear cruise (speed = 1, continuous with ease-in/ease-out)
        return t;
    }
}

function takeSnapshot(name: string) {
    const { fullMin, fullMax } = baseTimelineData.value;
    snapshots.value.push({
        name,
        viewMin: viewMin.value ?? fullMin,
        viewMax: viewMax.value ?? fullMax,
    });
}

function removeSnapshot(index: number) {
    snapshots.value.splice(index, 1);
}

function goToSnapshot(snap: CameraSnapshot) {
    const { fullMin, fullMax } = baseTimelineData.value;
    const fullRange = fullMax - fullMin;
    if (snap.viewMin !== null && snap.viewMax !== null &&
        Math.abs((snap.viewMax - snap.viewMin) - fullRange) < fullRange * 0.01) {
        viewMin.value = null;
        viewMax.value = null;
    } else {
        viewMin.value = snap.viewMin;
        viewMax.value = snap.viewMax;
    }
}

async function playSequence() {
    if (sequence.value.length === 0) return;
    if (isPlaying.value || isRecording.value) return;

    // Close the camera window
    cameraWindowActive.value = false;

    // Jump to the first step's starting position before countdown
    const firstStep = sequence.value[0];
    if (firstStep.type === 'animate') {
        const firstSnap = snapshots.value.find(s => s.name === firstStep.startSnapshot);
        if (firstSnap) {
            goToSnapshot(firstSnap);
            await new Promise(r => requestAnimationFrame(r));
        }
    }

    // Countdown 3, 2, 1
    for (let i = 3; i >= 1; i--) {
        countdown.value = i;
        await new Promise(r => setTimeout(r, 1000));
    }
    countdown.value = 0;
    isPlaying.value = true;
    _inPlayback = true;

    // Pause after countdown so the viewer can take in the starting position
    await new Promise(r => setTimeout(r, 1000));

    for (const step of sequence.value) {
        if (!isPlaying.value) break; // cancelled

        if (step.type === 'wait') {
            // Hold current viewport for the duration
            await new Promise(r => setTimeout(r, step.durationMs));
            continue;
        }

        // Animate step
        const startSnap = snapshots.value.find(s => s.name === step.startSnapshot);
        const endSnap = snapshots.value.find(s => s.name === step.endSnapshot);
        if (!startSnap || !endSnap) continue;

        // Jump to start
        goToSnapshot(startSnap);
        await new Promise(r => requestAnimationFrame(r));

        // Animate to end over durationMs
        const { fullMin, fullMax } = baseTimelineData.value;
        const sMin = startSnap.viewMin ?? fullMin;
        const sMax = startSnap.viewMax ?? fullMax;
        const eMin = endSnap.viewMin ?? fullMin;
        const eMax = endSnap.viewMax ?? fullMax;

        await new Promise<void>((resolve) => {
            const startTime = performance.now();

            function tick() {
                if (!isPlaying.value) { playbackFrameId = null; resolve(); return; }
                const elapsed = performance.now() - startTime;
                const t = Math.min(1, elapsed / step.durationMs);
                const ease = cameraEase(t, step.durationMs);

                const curMin = sMin + (eMin - sMin) * ease;
                const curMax = sMax + (eMax - sMax) * ease;

                if (t >= 1) {
                    const fullRange = fullMax - fullMin;
                    if (Math.abs((eMax - eMin) - fullRange) < fullRange * 0.01) {
                        viewMin.value = null;
                        viewMax.value = null;
                    } else {
                        viewMin.value = eMin;
                        viewMax.value = eMax;
                    }
                    playbackFrameId = null;
                    resolve();
                } else {
                    viewMin.value = curMin;
                    viewMax.value = curMax;
                    playbackFrameId = requestAnimationFrame(tick);
                }
            }
            playbackFrameId = requestAnimationFrame(tick);
        });
    }

    _inPlayback = false;
    isPlaying.value = false;
}

function stopPlayback() {
    if (playbackFrameId !== null) {
        cancelAnimationFrame(playbackFrameId);
        playbackFrameId = null;
    }
    _inPlayback = false;
    isPlaying.value = false;
    countdown.value = 0;
    if (isRecording.value) {
        recordingCancelled = true;
    }
}

// --- Camera Sequence Recording (export as .mov) ---

async function recordSequence() {
    if (sequence.value.length === 0) return;
    if (isRecording.value || isPlaying.value) return;

    const video = window.electronVideo;
    if (!video) return;

    const outputPath = await video.saveFileDialog('camera-sequence.mov');
    if (!outputPath) return;

    // Derive the sibling folder + base name for the keyframe PNGs from the chosen .mov path.
    const sep = outputPath.includes('\\') ? '\\' : '/';
    const lastSep = outputPath.lastIndexOf(sep);
    const folder = lastSep >= 0 ? outputPath.slice(0, lastSep) : '';
    const fileBase = (lastSep >= 0 ? outputPath.slice(lastSep + 1) : outputPath).replace(/\.mov$/i, '');

    cameraWindowActive.value = false;
    isRecording.value = true;
    recordingCancelled = false;
    _inPlayback = true;
    _inRecording = true;
    _recordSmoothInit = false;
    recordSmoothY.value = new Map();
    if (spriteSizeFrameId) { cancelAnimationFrame(spriteSizeFrameId); spriteSizeFrameId = null; }

    const FPS = 60;
    const tmpDir = await video.createTempDir();

    // Pre-build font CSS for html-to-image
    let fontEmbedCSS = '';
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
        fontEmbedCSS = (await Promise.all(promises)).join('\n');
    } catch { /* fallback */ }

    const captureOpts = {
        backgroundColor: 'transparent' as string,
        cacheBust: false,
        pixelRatio: 1,
        skipFonts: true,
        // Keep the on-screen recording / playback overlays out of the captured frames.
        filter: (node: Node) => {
            const cl = (node as HTMLElement).classList;
            return !cl || !(cl.contains('recording-overlay') || cl.contains('playing-indicator') || cl.contains('countdown-overlay'));
        },
        ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: false, preferredFontFormat: 'truetype' as const }),
    };

    // Compute total duration and build step timeline
    const stepTimeline: Array<{ startMs: number; endMs: number; step: CameraSequenceStep }> = [];
    let cumulativeMs = 0;
    for (const step of sequence.value) {
        stepTimeline.push({ startMs: cumulativeMs, endMs: cumulativeMs + step.durationMs, step });
        cumulativeMs += step.durationMs;
    }
    const totalDurationMs = cumulativeMs;
    const totalFrames = Math.ceil(totalDurationMs / 1000 * FPS);

    const { fullMin, fullMax } = baseTimelineData.value;

    // Ordered, de-duplicated list of the snapshots used as keyframes in the sequence —
    // each is also exported as a still PNG alongside the .mov.
    const keyframeSnaps: CameraSnapshot[] = [];
    const seenKeyframes = new Set<string>();
    for (const step of sequence.value) {
        if (step.type !== 'animate') continue;
        for (const name of [step.startSnapshot, step.endSnapshot]) {
            if (seenKeyframes.has(name)) continue;
            const snap = snapshots.value.find(s => s.name === name);
            if (snap) { seenKeyframes.add(name); keyframeSnaps.push(snap); }
        }
    }

    // Apply a viewport for a capture frame. Set the exact eased values every frame — do NOT
    // snap to the full-range (null) state when within ~1% of full, the way an interactive
    // reset does. That early snap, combined with the ease-out deceleration, lands on the
    // final view well before the clip ends and then holds, which reads as the animation
    // "jumping" to the final frame and skipping its ease-out. Exact full-range values render
    // identically to null (visibleRange falls back to fullMin/fullMax), so easing all the way
    // in is both smooth and visually correct.
    const applyViewport = (vMin: number, vMax: number) => {
        viewMin.value = vMin;
        viewMax.value = vMax;
    };

    // Compute viewport at a given time in the sequence
    function getViewportAtTime(timeMs: number): { vMin: number; vMax: number } {
        let currentMin = fullMin;
        let currentMax = fullMax;

        // Set initial position from first animate step's start snapshot
        for (const { step } of stepTimeline) {
            if (step.type === 'animate') {
                const snap = snapshots.value.find(s => s.name === step.startSnapshot);
                if (snap) { currentMin = snap.viewMin ?? fullMin; currentMax = snap.viewMax ?? fullMax; }
                break;
            }
        }

        for (const { startMs, endMs, step } of stepTimeline) {
            if (timeMs < startMs) break;

            if (step.type === 'wait') {
                if (timeMs <= endMs) return { vMin: currentMin, vMax: currentMax };
                continue;
            }

            const startSnap = snapshots.value.find(s => s.name === step.startSnapshot);
            const endSnap = snapshots.value.find(s => s.name === step.endSnapshot);
            if (!startSnap || !endSnap) continue;

            const sMin = startSnap.viewMin ?? fullMin;
            const sMax = startSnap.viewMax ?? fullMax;
            const eMin = endSnap.viewMin ?? fullMin;
            const eMax = endSnap.viewMax ?? fullMax;

            if (timeMs <= endMs) {
                const t = Math.min(1, (timeMs - startMs) / step.durationMs);
                const ease = cameraEase(t, step.durationMs);
                return { vMin: sMin + (eMin - sMin) * ease, vMax: sMax + (eMax - sMax) * ease };
            }

            currentMin = eMin;
            currentMax = eMax;
        }

        return { vMin: currentMin, vMax: currentMax };
    }

    try {
        const el = containerRef.value;
        if (!el) throw new Error('Container not found');

        // --- Export each keyframe snapshot as a still PNG next to the .mov (best-effort) ---
        try {
            for (let k = 0; k < keyframeSnaps.length && !recordingCancelled; k++) {
                const snap = keyframeSnaps[k];
                recordingProgress.value = { current: k, total: keyframeSnaps.length, message: `Exporting keyframe ${k + 1}/${keyframeSnaps.length}` };

                applyViewport(snap.viewMin ?? fullMin, snap.viewMax ?? fullMax);
                await nextTick();
                await nextTick();
                // Snap the layout/labels to the resting state for this viewport (no slide trail).
                _recordSmoothInit = false;
                updateRecordSmoothing();
                await nextTick();
                await new Promise(r => requestAnimationFrame(r));

                const dataUrl = await htmlToImage.toPng(el, captureOpts);
                const safeName = snap.name.replace(/[^a-z0-9_-]+/gi, '_');
                await window.electronDialog?.saveFile(folder, `${fileBase}-keyframe${k + 1}-${safeName}.png`, dataUrl);
            }
        } catch (e) {
            console.warn('Failed to export keyframe PNG(s):', e);
        }
        // Re-arm the snap so the first animation frame also starts settled.
        _recordSmoothInit = false;

        for (let frame = 0; frame <= totalFrames; frame++) {
            if (recordingCancelled) break;

            const timeMs = (frame / FPS) * 1000;
            const { vMin, vMax } = getViewportAtTime(timeMs);

            recordingProgress.value = { current: frame, total: totalFrames, message: `Capturing frame ${frame}/${totalFrames}` };

            applyViewport(vMin, vMax);

            await nextTick();
            await nextTick();
            // Advance the deterministic Y/size smoothing for this frame, then let the
            // template apply it before capturing.
            updateRecordSmoothing();
            await nextTick();
            await new Promise(r => requestAnimationFrame(r));

            const dataUrl = await htmlToImage.toPng(el, captureOpts);
            await video.saveFrame(tmpDir, frame, dataUrl);
        }

        // --- Settle tail ---
        // The camera viewport reaches the final snapshot exactly at the last frame, but the
        // trailing Y/size/label smoothing (and the credits-label slide-down) still lag behind.
        // Hold the final viewport and keep capturing until that motion eases fully to rest, so
        // the clip decelerates smoothly into a settled final frame instead of cutting off.
        if (!recordingCancelled) {
            const finalView = getViewportAtTime(totalDurationMs);
            applyViewport(finalView.vMin, finalView.vMax);
            recordingProgress.value = { current: totalFrames, total: totalFrames, message: 'Settling final frame…' };

            let frameIdx = totalFrames + 1;
            const maxSettleFrames = Math.ceil(FPS); // hard cap ~1s so we never spin forever
            for (let s = 0; s < maxSettleFrames && !recordingCancelled; s++) {
                await nextTick();
                await nextTick();
                const remaining = updateRecordSmoothing();
                await nextTick();
                await new Promise(r => requestAnimationFrame(r));

                const dataUrl = await htmlToImage.toPng(el, captureOpts);
                await video.saveFrame(tmpDir, frameIdx++, dataUrl);

                if (remaining < 0.5) break; // settled (sub-pixel) — final frame is at rest
            }
        }

        if (!recordingCancelled) {
            recordingProgress.value = { current: totalFrames, total: totalFrames, message: 'Encoding video with FFmpeg...' };
            const result = await video.encode(tmpDir, outputPath, FPS);
            if (!result.success) {
                recordingProgress.value = { current: 0, total: 0, message: `FFmpeg error: ${result.error}` };
                await video.cleanup(tmpDir);
                _inPlayback = false;
                _inRecording = false;
                recordSmoothY.value = new Map();
                recordLabelOpacity.value = 1;
                recordLabelBottom.value = new Map();
                isRecording.value = false;
                return;
            }
            recordingProgress.value = { current: totalFrames, total: totalFrames, message: `Saved to ${outputPath}` };
        }

        await video.cleanup(tmpDir);
    } catch (e) {
        recordingProgress.value = { current: 0, total: 0, message: `Error: ${String(e)}` };
        try { await video.cleanup(tmpDir); } catch { /* ignore */ }
    }

    _inPlayback = false;
    _inRecording = false;
    recordSmoothY.value = new Map();
    recordLabelOpacity.value = 1;
    recordLabelBottom.value = new Map();
    isRecording.value = false;

    // Normalize the resting view: if it's at the full range, drop back to the unzoomed
    // (null) state so the editor doesn't treat the timeline as zoomed after exporting.
    const fr = fullMax - fullMin;
    if (viewMin.value !== null && viewMax.value !== null &&
        Math.abs((viewMax.value - viewMin.value) - fr) < fr * 0.01) {
        viewMin.value = null;
        viewMax.value = null;
    }
}

// --- Timeline Re-Ranking Animation ---
//
// Timeline uses the same phase state machine as TierList, but the visual is different:
//   FADE_OUT:     record old position, apply data immediately, start sliding
//   COLLAPSE_GAP: (slide continues — handled in FADE_OUT)
//   OPEN_SPACE:   (skipped)
//   FADE_IN:      (skipped — sprite stays visible throughout)
//   HIGHLIGHT:    glow
//
const rerankAnimOffsetX = ref<Map<string, number>>(new Map());
const rerankAnimOffsetY = ref<Map<string, number>>(new Map());
const rerankFadeClass = ref<Map<string, string>>(new Map());
let rerankAnimFrameId: number | null = null;

watch(() => reranking.phase, async (phase) => {
    if (phase === RerankPhase.IDLE) {
        rerankAnimOffsetX.value = new Map();
        rerankAnimOffsetY.value = new Map();
        rerankFadeClass.value = new Map();
        rerankSideOverride.value = new Map();
        return;
    }

    const pokemon = reranking.animatingPokemon;
    if (!pokemon) return;

    // ── FADE_OUT: record old position, apply data, slide to new position ──
    if (phase === RerankPhase.FADE_OUT) {
        // Record old position and side before data changes
        const oldEntry = positionedEntries.value.find(e => e.pkmnName === pokemon);
        const savedOldXPx = oldEntry ? oldEntry.xPx : 0;
        const savedOldYPx = oldEntry ? oldEntry.yPx : 0;

        // Pin this Pokemon to its current side of the axis so it doesn't jump
        const oldSide = baseLayout.value.get(pokemon) ?? 'above';
        rerankSideOverride.value = new Map([[pokemon, oldSide]]);

        // Apply pending insertions now
        const pending = [...reranking.pendingInsertions];
        reranking.committing = true;
        for (const ins of pending) {
            workspace.insertActiveTierlistEntry(ins.pokemon, ins.attempt);
        }
        reranking.committing = false;
        reranking.clearPending();

        // Wait for Vue to re-render
        await nextTick();
        await nextTick();

        // Find the new tier for the animating pokemon
        for (let i = 0; i < tierlist.groupedEntries.length; i++) {
            if (tierlist.groupedEntries[i].some(e => e.pkmnName === pokemon)) {
                reranking.newTierIndex = i;
                break;
            }
        }

        // Find the entry's new position
        const newEntry = positionedEntries.value.find(e => e.pkmnName === pokemon);
        const newXPx = newEntry ? newEntry.xPx : savedOldXPx;
        const newYPx = newEntry ? newEntry.yPx : savedOldYPx;

        // Set offsets so sprite visually stays at its old position
        const offsetX = savedOldXPx - newXPx;
        const offsetY = savedOldYPx - newYPx;
        rerankAnimOffsetX.value.set(pokemon, offsetX);
        rerankAnimOffsetY.value.set(pokemon, offsetY);
        rerankFadeClass.value.set(pokemon, 'timeline-rerank-sliding');

        // Ensure destination is in view — pan camera if needed
        const { min, max } = visibleRange.value;
        const range = max - min || 1;
        if (newEntry) {
            const pct = ((newEntry.value - min) / range);
            if (pct < 0.05 || pct > 0.95) {
                const halfRange = range / 2;
                const { fullMin, fullMax } = baseTimelineData.value;
                let nMin = newEntry.value - halfRange;
                let nMax = newEntry.value + halfRange;
                if (nMin < fullMin) { nMax += fullMin - nMin; nMin = fullMin; }
                if (nMax > fullMax) { nMin -= nMax - fullMax; nMax = fullMax; }
                animLerp = ANIM_LERP_PAN;
                startAnimation(Math.max(fullMin, nMin), Math.min(fullMax, nMax));
            }
        }

        // Animate both offsets from (old - new) → 0 over 1.5s
        const slideStart = performance.now();
        const slideDuration = 1500;

        function slideTick() {
            const t = Math.min(1, (performance.now() - slideStart) / slideDuration);
            const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
            rerankAnimOffsetX.value.set(pokemon, offsetX * (1 - ease));
            rerankAnimOffsetY.value.set(pokemon, offsetY * (1 - ease));

            if (t < 1) {
                rerankAnimFrameId = requestAnimationFrame(slideTick);
            } else {
                rerankAnimOffsetX.value.set(pokemon, 0);
                rerankAnimOffsetY.value.set(pokemon, 0);
                rerankAnimFrameId = null;
                reranking.setPhase(RerankPhase.HIGHLIGHT);
            }
        }
        rerankAnimFrameId = requestAnimationFrame(slideTick);
        return;
    }

    // Skip COLLAPSE_GAP, OPEN_SPACE, FADE_IN — slide handled everything
    if (phase === RerankPhase.COLLAPSE_GAP || phase === RerankPhase.OPEN_SPACE || phase === RerankPhase.FADE_IN) {
        return;
    }

    // ── HIGHLIGHT ──
    if (phase === RerankPhase.HIGHLIGHT) {
        rerankFadeClass.value.set(pokemon, 'timeline-rerank-highlight');
        rerankAnimOffsetX.value.set(pokemon, 0);
        rerankAnimOffsetY.value.set(pokemon, 0);
        await new Promise(r => setTimeout(r, 800));
        reranking.finishAnimation();
    }
});

function getRerankOffsetX(pkmnName: string): number {
    return rerankAnimOffsetX.value.get(pkmnName) || 0;
}

function getRerankOffsetY(pkmnName: string): number {
    return rerankAnimOffsetY.value.get(pkmnName) || 0;
}

function getTimelineRerankClass(pkmnName: string): string {
    return rerankFadeClass.value.get(pkmnName) || '';
}

// Vertical position to render for an entry: the JS-smoothed value while recording,
// otherwise the freshly-computed layout position.
function displayTop(entry: { pkmnName: string; yPx: number }): number {
    if (isRecording.value) {
        const sm = recordSmoothY.value.get(entry.pkmnName);
        if (sm !== undefined) return sm;
    }
    return entry.yPx;
}

// Credits-dodge `bottom` to render for a threshold value label: the smoothed (sliding)
// value while recording, otherwise the freshly-computed target (CSS handles the slide live).
function labelBottom(t: { tierIndex: number; valueBottom: number }): number {
    if (isRecording.value) {
        const sm = recordLabelBottom.value.get(t.tierIndex);
        if (sm !== undefined) return sm;
    }
    return t.valueBottom;
}

// Connector geometry to render — derived from the smoothed top while recording so the
// line stays attached to the sprite as it glides.
function displayConnector(entry: { pkmnName: string; yPx: number; lineTop: number; lineHeight: number }): { lineTop: number; lineHeight: number } {
    if (isRecording.value) {
        const sm = recordSmoothY.value.get(entry.pkmnName);
        if (sm !== undefined) return connectorGeom(sm, spriteSize.value);
    }
    return { lineTop: entry.lineTop, lineHeight: entry.lineHeight };
}

// Advance the recording motion smoothing one captured frame toward the current layout.
// Returns the largest remaining distance (in px-equivalent units) between the rendered
// and target states, so the settle tail can tell when the motion has come to rest.
function updateRecordSmoothing(): number {
    let maxDelta = 0;

    // Smooth sprite size so discrete 2px size steps don't shift the whole layout at once.
    const targetSize = targetSpriteSize.value;
    spriteSize.value = _recordSmoothInit
        ? spriteSize.value + (targetSize - spriteSize.value) * RECORD_SMOOTH
        : targetSize;
    maxDelta = Math.max(maxDelta, Math.abs(targetSize - spriteSize.value));

    // Fade the threshold value labels toward their shown/hidden target.
    const labelTarget = timelineView.value.thresholdLabelsVisible ? 1 : 0;
    recordLabelOpacity.value = _recordSmoothInit
        ? recordLabelOpacity.value + (labelTarget - recordLabelOpacity.value) * RECORD_SMOOTH
        : labelTarget;
    maxDelta = Math.max(maxDelta, Math.abs(labelTarget - recordLabelOpacity.value) * 100);

    // Credits-dodge offset: snap UP instantly so the label never overlaps the credits,
    // but ease DOWN only after the text has cleared, so it slides into place.
    const nextBottom = new Map<number, number>();
    for (const tp of timelineView.value.thresholdPositions ?? []) {
        const cur = recordLabelBottom.value.get(tp.tierIndex);
        let val: number;
        if (cur === undefined || !_recordSmoothInit || tp.valueBottom > cur) {
            val = tp.valueBottom; // first frame, or lifting up → snap
        } else {
            val = cur + (tp.valueBottom - cur) * RECORD_SMOOTH; // lowering → slide
        }
        nextBottom.set(tp.tierIndex, val);
        maxDelta = Math.max(maxDelta, Math.abs(tp.valueBottom - val));
    }
    recordLabelBottom.value = nextBottom;

    // Smooth each entry's vertical position toward its freshly-computed row target so
    // row re-assignments glide instead of teleporting between captured frames.
    const next = new Map<string, number>();
    for (const e of positionedEntries.value) {
        const cur = recordSmoothY.value.get(e.pkmnName);
        const val = (cur === undefined || !_recordSmoothInit)
            ? e.yPx
            : cur + (e.yPx - cur) * RECORD_SMOOTH;
        next.set(e.pkmnName, val);
        maxDelta = Math.max(maxDelta, Math.abs(e.yPx - val));
    }
    recordSmoothY.value = next;
    _recordSmoothInit = true;
    return maxDelta;
}

// --- Timeline-specific context menu ---
const contextMenu = useContextMenu();

function setupContextMenu() {
    contextMenu.setOptions([
        {
            label: 'Hide Timeline',
            shortcut: 'N',
            action() {
                emit('close');
            },
        },
        {
            label: 'Export as PNG',
            shortcut: 'Ctrl+E',
            action() {
                if (!containerRef.value) return;
                let startToastId = -1;
                fileexporter.exportElement(containerRef.value, 1, (message, state) => {
                    switch (state) {
                        case 'start':
                            startToastId = toast.addToast(message, 'info', { timeout: -1, pending: true });
                            break;
                        case 'success':
                            toast.removeToast(startToastId);
                            toast.addToast(message, 'success');
                            break;
                        case 'error':
                            toast.removeToast(startToastId);
                            toast.addToast(message, 'error');
                            break;
                    }
                });
            },
        },
        {
            label: '',  // separator
        },
        {
            label: 'Snapshot',
            action() {
                const name = `Snap ${snapshots.value.length + 1}`;
                takeSnapshot(name);
            },
        },
        ...snapshots.value.map((snap) => ({
            label: `Go to: ${snap.name}`,
            action() {
                goToSnapshot(snap);
            },
        })),
        {
            label: 'Automate Camera',
            action() {
                cameraWindowActive.value = !cameraWindowActive.value;
            },
        },
        {
            label: '',  // separator
        },
        {
            label: () => globalStore.animateReranking ? 'Animate Re-Ranking: ON' : 'Animate Re-Ranking: OFF',
            action() {
                globalStore.animateReranking = !globalStore.animateReranking;
                if (!globalStore.animateReranking) {
                    reranking.clearPending();
                }
            },
        },
        {
            label: '',  // separator
        },
        {
            label: () => isPlaying.value ? 'Stop Playback' : 'Play',
            shortcut: 'P',
            action() {
                if (isPlaying.value || countdown.value > 0) {
                    stopPlayback();
                } else {
                    playSequence();
                }
            },
        },
        ...(hasElectronVideo ? [{
            label: 'Export Sequence as .mov',
            action() { recordSequence(); },
        }] : []),
    ]);
}

const emit = defineEmits<{
    activated: [],
    deactivated: [],
    close: [],
}>();

onMounted(async () => {
    // Set initial view to the threshold-capped default range if outliers would compress the view
    const { fullMin, fullMax, defaultMin, defaultMax } = baseTimelineData.value;
    const fullRange = fullMax - fullMin;
    const defaultRange = defaultMax - defaultMin;
    if (fullRange > 0 && defaultRange < fullRange * 0.95) {
        viewMin.value = defaultMin;
        viewMax.value = defaultMax;
    }

    // Load saved camera presets (snapshots + sequence)
    await loadCameraData();

    setupContextMenu();
    emit('activated');
});

// Auto-save camera data when snapshots or sequence change
watch(snapshots, () => { debouncedSave(); setupContextMenu(); }, { deep: true });
watch(sequence, debouncedSave, { deep: true });

onUnmounted(() => {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (spriteSizeFrameId) cancelAnimationFrame(spriteSizeFrameId);
    if (rerankAnimFrameId) cancelAnimationFrame(rerankAnimFrameId);
    if (saveTimeout) clearTimeout(saveTimeout);
    stopPlayback();
    emit('deactivated');
});

onKeyDown('Escape', () => {
    if (isRecording.value) {
        recordingCancelled = true;
        return;
    }
    if (isPlaying.value || countdown.value > 0) {
        stopPlayback();
    }
});

defineExpose({
    setupContextMenu,
});
</script>


<template>
    <div
        class="timeline-container"
        ref="container"
        :class="{ 'is-zoomed': isZoomed, 'is-dragging': !!dragState, 'exporting': fileexporter.exportInProgress, 'recording-capture': isRecording }"
        @wheel.prevent="onWheel"
        @mousedown="onMouseDown"
        @click="unselectAll"
    >
        <!-- Threshold boundary lines -->
        <div
            v-for="(t, i) in timelineView.thresholdPositions"
            :key="'thresh-' + i"
            class="threshold-line"
            :style="{
                left: `${PADDING_LEFT + (t.pct / 100) * TIMELINE_WIDTH}px`,
            }"
        >
            <div class="threshold-tick" :style="{ background: t.color }"></div>
            <div class="threshold-tier-label" :style="{ color: t.color }">{{ t.tierName }}</div>
            <div class="threshold-value-label" :class="{ hidden: !timelineView.thresholdLabelsVisible }" :style="{ color: t.color, bottom: labelBottom(t) + 'px', ...(isRecording ? { opacity: 0.6 * recordLabelOpacity } : {}) }">{{ t.label }}</div>
        </div>

        <!-- Connector lines from sprites to axis (regular entries only) -->
        <div
            v-for="entry in regularEntries"
            :key="'line-' + entry.pkmnName"
            class="connector-line"
            :style="{
                left: entry.xPx + 'px',
                top: displayConnector(entry).lineTop + 'px',
                height: displayConnector(entry).lineHeight + 'px',
                background: entry.color,
                opacity: 0.6,
            }"
        ></div>

        <!-- Pokemon sprites (regular entries) -->
        <PkmnImage
            v-for="entry in regularEntries"
            :key="entry.pkmnName"
            :pokemon="entry.pkmnName"
            :active="tierlist.selectedPkmn.has(entry.pkmnName)"
            :no-hover="fileexporter.exportInProgress || isRecording"
            :height="spriteSize"
            :outline="1"
            class="timeline-sprite"
            :class="getTimelineRerankClass(entry.pkmnName)"
            :style="{
                left: (entry.xPx - spriteSize / 2 + getRerankOffsetX(entry.pkmnName)) + 'px',
                top: (displayTop(entry) + getRerankOffsetY(entry.pkmnName)) + 'px',
            }"
            @click.stop="
                if (!$event.ctrlKey) {
                    tierlist.activePkmn = entry.pkmnName;
                    tierlist.activePrev = '';
                    tierlist.selectedPkmn.clear();
                    tierlist.selectedPkmn.add(entry.pkmnName);
                } else {
                    if (tierlist.selectedPkmn.has(entry.pkmnName)) {
                        tierlist.selectedPkmn.delete(entry.pkmnName);
                    } else {
                        tierlist.selectedPkmn.add(entry.pkmnName);
                    }
                }
            "
        >
            <MetricPopout
                v-if="tierlist.selectedPkmn.has(entry.pkmnName) && !(reranking.isAnimating && entry.pkmnName === reranking.animatingPokemon)"
                :pokemon="entry.pkmnName"
                :open-to-top="entry.popoutAbove"
                :compact="true"
            />
        </PkmnImage>

        <!-- Extreme outlier bubbles (collision-aware, at right edge) -->
        <div
            v-for="entry in extremeEntries"
            :key="'outlier-' + entry.pkmnName"
            class="outlier-bubble"
            :style="{ top: displayTop(entry) + 'px' }"
        >
            <PkmnImage :pokemon="entry.pkmnName" :no-hover="fileexporter.exportInProgress || isRecording" :height="spriteSize" :outline="1" />
            <span class="outlier-value" :style="{ color: entry.color }">{{ entry.formattedValue }}</span>
        </div>

        <!-- X-axis line (colored by tier) -->
        <div class="axis-line-container" :style="{ top: AXIS_Y + 'px', left: '0px', width: '1920px' }">
            <div
                v-for="(seg, i) in timelineView.axisSegments"
                :key="'axis-' + i"
                class="axis-segment"
                :style="{
                    left: seg.leftPct + '%',
                    width: seg.widthPct + '%',
                    background: seg.color,
                }"
            ></div>
        </div>

        <!-- Tick marks -->
        <div
            v-for="(tick, i) in timelineView.tickMarks"
            :key="'tick-' + i"
            class="tick-mark"
            :style="{
                left: `${PADDING_LEFT + (tick.pct / 100) * TIMELINE_WIDTH}px`,
                top: AXIS_Y + 'px',
            }"
        >
            <div class="tick-line"></div>
            <div class="tick-label">{{ tick.label }}</div>
        </div>

        <!-- Countdown overlay -->
        <Transition name="countdown-fade">
            <div v-if="countdown > 0" class="countdown-overlay">
                <div class="countdown-number" :key="countdown">{{ countdown }}</div>
            </div>
        </Transition>

        <!-- Playing indicator -->
        <div v-if="isPlaying" class="playing-indicator">
            <div class="playing-dot"></div>
            Playing
        </div>

        <!-- Recording overlay -->
        <div v-if="isRecording" class="recording-overlay">
            <div class="recording-header">
                <div class="recording-dot"></div>
                Recording
            </div>
            <div class="recording-message">{{ recordingProgress.message }}</div>
            <div v-if="recordingProgress.total > 0" class="recording-bar-container">
                <div class="recording-bar" :style="{ width: (recordingProgress.current / recordingProgress.total * 100) + '%' }"></div>
            </div>
            <div class="recording-hint">Press Escape to cancel</div>
        </div>
    </div>

    <Teleport to="#app">
        <CameraAutomateWindow
            :visible="cameraWindowActive"
            :snapshots="snapshots"
            :sequence="sequence"
            :has-electron-video="hasElectronVideo"
            @close="cameraWindowActive = false"
            @take-snapshot="takeSnapshot"
            @remove-snapshot="removeSnapshot"
            @go-to-snapshot="goToSnapshot"
            @update-sequence="(s) => sequence = s"
            @play="playSequence"
            @export="recordSequence"
        />
    </Teleport>
</template>


<style scoped>
.timeline-container {
    position: relative;
    width: 1920px;
    height: 1080px;
    overflow: hidden;
    background: transparent;
    /* Uniform edge fade: all content fades as one cohesive image at left/right edges */
    -webkit-mask-image: linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%);
    mask-image: linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%);
}

.timeline-container.is-zoomed {
    cursor: grab;
}

/* While recording, sprite/connector motion is smoothed in JS frame-by-frame, so the
   wall-clock CSS transitions must be off — otherwise html-to-image samples them at
   unpredictable progress and the exported video lurches. */
.timeline-container.recording-capture .timeline-sprite,
.timeline-container.recording-capture .connector-line,
.timeline-container.recording-capture .threshold-value-label {
    transition: none !important;
}

.timeline-container.is-dragging {
    cursor: grabbing;
}

/* Threshold lines */
.threshold-line {
    position: absolute;
    /* Equal top/bottom insets so the timeline frame is vertically centered in the
       1080p canvas (the threshold lines are the tallest elements, so they define the
       graphic's top/bottom margins). */
    top: 35px;
    bottom: 35px;
    z-index: 5;
    pointer-events: none;
}

.threshold-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    opacity: 0.35;
    margin-left: -1px;
}

.threshold-tier-label {
    position: absolute;
    top: 0px;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'Teko', sans-serif;
    font-size: 32px;
    font-weight: 700;
    white-space: nowrap;
    opacity: 0.6;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}

.threshold-value-label {
    position: absolute;
    bottom: 0px;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'Play', sans-serif;
    font-size: 16px;
    font-weight: 700;
    white-space: nowrap;
    opacity: 0.6;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
    transition: opacity 0.3s ease, bottom 0.4s ease;
}
.threshold-value-label.hidden {
    opacity: 0;
}

/* Connector lines */
.connector-line {
    position: absolute;
    width: 2px;
    margin-left: -1px;
    z-index: 8;
    pointer-events: none;
    transition: top 0.55s cubic-bezier(0.25, 0.1, 0.25, 1),
                height 0.55s cubic-bezier(0.25, 0.1, 0.25, 1),
                opacity 0.55s ease;
}

/* Pokemon sprites */
.timeline-sprite {
    position: absolute;
    z-index: 20;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
    transition: top 0.55s cubic-bezier(0.25, 0.1, 0.25, 1),
                opacity 0.55s ease;
}

/* X-axis */
.axis-line-container {
    position: absolute;
    height: 5px;
    z-index: 7;
    overflow: hidden;
}

.axis-segment {
    position: absolute;
    top: 0;
    height: 100%;
    opacity: 0.7;
}

/* Tick marks */
.tick-mark {
    position: absolute;
    z-index: 9;
    pointer-events: none;
}

.tick-line {
    width: 2px;
    height: 14px;
    background: rgba(255, 255, 255, 0.4);
    margin-left: -1px;
    margin-top: -5px;
}

.tick-label {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'Play', sans-serif;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.6);
    white-space: nowrap;
}

/* Countdown overlay */
.countdown-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}

.countdown-number {
    font-family: 'Teko', sans-serif;
    font-size: 200px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.8);
    text-shadow: 0 4px 30px rgba(0, 0, 0, 0.6);
    animation: countdown-pop 1s ease-out;
}

@keyframes countdown-pop {
    0% { transform: scale(1.5); opacity: 0; }
    20% { transform: scale(1); opacity: 1; }
    80% { transform: scale(1); opacity: 1; }
    100% { transform: scale(0.8); opacity: 0; }
}

.countdown-fade-enter-active,
.countdown-fade-leave-active {
    transition: opacity 0.2s ease;
}
.countdown-fade-enter-from,
.countdown-fade-leave-to {
    opacity: 0;
}

/* Playing indicator */
.playing-indicator {
    position: absolute;
    top: 24px;
    left: 40px;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Play', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: rgba(255, 80, 80, 0.9);
    pointer-events: none;
}

.playing-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ff4444;
    animation: playing-pulse 1.2s ease-in-out infinite;
}

@keyframes playing-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
}

/* Extreme outlier bubbles */
.outlier-bubble {
    position: absolute;
    right: 20px;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px 2px 2px;
    background: rgba(0, 0, 0, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 20px;
}

.outlier-value {
    font-family: 'Play', sans-serif;
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
}

/* Visible during slide (sprite shown, offset animated via JS) */
.timeline-rerank-sliding {
    z-index: 50 !important;
}

/* Highlight glow */
.timeline-rerank-highlight {
    animation: timeline-rerank-glow 800ms ease !important;
    z-index: 50 !important;
}

@keyframes timeline-rerank-glow {
    0% {
        filter: brightness(1) drop-shadow(0 0 0px transparent);
    }
    30% {
        filter: brightness(1.6) drop-shadow(0 0 16px rgba(255, 215, 0, 0.9));
    }
    100% {
        filter: brightness(1) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
    }
}

/* Recording overlay */
.recording-overlay {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 16px 32px;
    background: rgba(0, 0, 0, 0.85);
    border: 1px solid rgba(255, 80, 80, 0.5);
    border-radius: 12px;
    pointer-events: none;
}

.recording-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Play', sans-serif;
    font-size: 20px;
    font-weight: 700;
    color: rgba(255, 80, 80, 0.95);
}

.recording-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #ff4444;
    animation: playing-pulse 1.2s ease-in-out infinite;
}

.recording-message {
    font-family: 'Play', sans-serif;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.7);
}

.recording-bar-container {
    width: 240px;
    height: 6px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    overflow: hidden;
}

.recording-bar {
    height: 100%;
    background: #ff4444;
    border-radius: 3px;
    transition: width 0.1s linear;
}

.recording-hint {
    font-family: 'Play', sans-serif;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.35);
}
</style>
