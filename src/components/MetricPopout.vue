<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { METRIC, MetricKeys, useTierlist } from '../store';
import { formatTimeHMS, formatTimeFull, parseTime } from '../utils/time';

const props = withDefaults(defineProps<{
    pokemon: string,
    openToTop: boolean,
    compact?: boolean,
}>(), {
    compact: false,
});

const tierlist = useTierlist();

// Edit mode state
const editing = ref(false);
const editValues = ref<Record<string, string>>({});

const METRIC_DISPLAY_ORDER = [
    "realtime",
    "resets",
    "blackouts",
    "faults",
    "level",
    "gametime",
] as const;

// Editable keys (faults is computed, not directly editable)
const EDITABLE_KEYS = new Set(["realtime", "resets", "blackouts", "level", "gametime"]);

function isEditable(key: string): boolean {
    return EDITABLE_KEYS.has(key);
}

function enterEditMode() {
    const attempt = tierlist.getMetrics(props.pokemon);
    const values: Record<string, string> = {};
    for (const key of METRIC_DISPLAY_ORDER) {
        if (!isEditable(key)) continue;
        const m = attempt[key as MetricKeys];
        const v = (typeof m === 'function') ? m() : m;
        if (v === undefined || v < 0) {
            values[key] = "-1";
        } else if (key === "gametime") {
            values[key] = formatTimeHMS(v, false);
        } else if (key === "realtime") {
            values[key] = formatTimeFull(v, false);
        } else {
            values[key] = v.toString();
        }
    }
    editValues.value = values;
    editing.value = true;
    nextTick(updatePosition);
}

function cancelEdit() {
    editing.value = false;
    nextTick(updatePosition);
}

function saveEdit() {
    const entry = tierlist.activeTierlist.entries[props.pokemon];
    if (!entry) return;

    // Find the actual attempt object that matches the one being displayed
    const displayedAttempt = tierlist.getMetrics(props.pokemon);
    // Find the index of this attempt in the entry's attempts array
    const attemptIndex = entry.attempts.findIndex(a => a === displayedAttempt);
    if (attemptIndex === -1) return;

    const attempt = entry.attempts[attemptIndex];

    // Parse and apply each edited value
    for (const [key, value] of Object.entries(editValues.value)) {
        if (key === "realtime" || key === "gametime") {
            attempt[key] = parseTime(value);
        } else if (key === "level" || key === "resets" || key === "blackouts") {
            attempt[key] = parseInt(value);
        }
    }

    editing.value = false;
    nextTick(updatePosition);
}

// Position state for the teleported popout
const popoutStyle = ref({
    top: '0px',
    left: '0px',
    visibility: 'hidden' as 'hidden' | 'visible',
});

// Reference to a hidden anchor element to get parent position
const anchorRef = ref<HTMLElement | null>(null);
const popoutRef = ref<HTMLElement | null>(null);

function updatePosition() {
    if (!anchorRef.value) return;

    const parent = anchorRef.value.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();

    // Get actual popout dimensions if available
    const popoutRect = popoutRef.value?.getBoundingClientRect();
    const popoutHeight = popoutRect?.height ?? 200;

    // Center horizontally on the parent element
    let left = rect.left + rect.width / 2;

    let top: number;
    if (props.openToTop) {
        // Position above the element
        top = rect.top - popoutHeight - 16;
    } else {
        // Position below the element
        top = rect.bottom + 8;
    }

    popoutStyle.value = {
        top: `${top}px`,
        left: `${left}px`,
        visibility: 'visible',
    };
}

// Track previous parent position to detect changes
let previousParentRect: DOMRect | null = null;
let animationFrameId: number | null = null;
let isWatching = false;

function watchParentPosition() {
    if (!isWatching || !anchorRef.value) return;

    const parent = anchorRef.value.parentElement;
    if (!parent) {
        animationFrameId = requestAnimationFrame(watchParentPosition);
        return;
    }

    const currentRect = parent.getBoundingClientRect();
    if (previousParentRect) {
        // Check if position changed (accounting for floating point precision)
        if (Math.abs(currentRect.left - previousParentRect.left) > 0.1 ||
            Math.abs(currentRect.top - previousParentRect.top) > 0.1 ||
            Math.abs(currentRect.width - previousParentRect.width) > 0.1 ||
            Math.abs(currentRect.height - previousParentRect.height) > 0.1) {
            updatePosition();
        }
    }
    previousParentRect = currentRect;

    animationFrameId = requestAnimationFrame(watchParentPosition);
}

// Update position when mounted and when pokemon changes
onMounted(() => {
    nextTick(updatePosition);
    // Update again after a frame to get accurate popout dimensions
    requestAnimationFrame(() => {
        updatePosition();
    });
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    // Watch for viewport scale changes by checking parent position each frame
    // This catches CSS transform changes that don't trigger resize events
    isWatching = true;
    watchParentPosition();
});

onUnmounted(() => {
    window.removeEventListener('scroll', updatePosition, true);
    window.removeEventListener('resize', updatePosition);

    isWatching = false;
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    previousParentRect = null;
});

watch(() => props.pokemon, () => {
    editing.value = false;
    nextTick(updatePosition);
});

const metrics = computed(() => {
    const metrics = tierlist.getMetrics(props.pokemon);
    const formattedMetrics: Record<string, string> = {};
    for (const key of METRIC_DISPLAY_ORDER) {
        const m = metrics[key as MetricKeys];
        const v = (typeof m === 'function') ? m() : m;
        if (v === undefined || v < 0) continue;
        formattedMetrics[key] = METRIC[key as MetricKeys]?.formatValue?.(v) ?? v.toString();
    }
    return formattedMetrics;
});

</script>


<template>
    <!-- Hidden anchor to track parent position -->
    <span ref="anchorRef" class="anchor"></span>

    <!-- Teleport popout to body to escape overflow clipping -->
    <Teleport to="body">
        <div
            ref="popoutRef"
            class="metric-popout"
            :class="{ editing, 'metric-popout-compact': props.compact }"
            :style="popoutStyle"
            @click.stop
        >
            <div class="content">
                <div class="header">
                    <h3>{{ pokemon }}</h3>
                </div>

                <!-- View mode -->
                <div v-if="!editing" class="body" @click.stop="enterEditMode()">
                    <template v-for="(value, key) in metrics" :key="key">
                        <div>{{ METRIC[key as MetricKeys]?.title }}: </div>
                        <div>{{ value }}</div>
                    </template>
                </div>

                <!-- Edit mode -->
                <div v-else class="body editing-body">
                    <template v-for="key in METRIC_DISPLAY_ORDER" :key="key">
                        <template v-if="isEditable(key) && editValues[key] !== undefined">
                            <div class="edit-label">{{ METRIC[key as MetricKeys]?.title }}: </div>
                            <div class="edit-input-wrapper">
                                <input
                                    class="edit-input"
                                    :type="(key === 'realtime' || key === 'gametime') ? 'text' : 'number'"
                                    v-model="editValues[key]"
                                    @keydown.enter="saveEdit()"
                                    @keydown.escape="cancelEdit()"
                                />
                            </div>
                        </template>
                    </template>
                    <div class="edit-buttons" style="grid-column: 1 / -1;">
                        <button class="save-btn" @click.stop="saveEdit()">Save</button>
                        <button class="cancel-btn" @click.stop="cancelEdit()">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>


<style scoped>
.anchor {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
}
</style>

<!-- Non-scoped styles for teleported content -->
<style>
.metric-popout {
    position: fixed;
    transform: translateX(-50%);
    background: #333333e8;
    box-shadow: 0 10px 25px #000, 0 10px 25px -10px #000;
    border-radius: 10px;
    z-index: 10000;
    padding: 20px;
    font-size: 24px;
    pointer-events: auto;
}

.metric-popout .header h3 {
    margin: 0;
    padding-bottom: 8px;
    font-family: Consolas, monospace;
    font-size: 24px;
    font-weight: bold;
    text-align: center;
    text-decoration: bold;
}

.metric-popout .body {
    display: grid;
    grid-template-columns: 175px 1fr;
    font-family: Consolas, monospace;
    gap: 5px;
    cursor: pointer;
}

.metric-popout .body > :nth-child(odd) {
    justify-self: start;
}

.metric-popout .body > :nth-child(even) {
    justify-self: end;
}

.metric-popout .editing-body {
    cursor: default;
}

.metric-popout .edit-label {
    display: flex;
    align-items: center;
}

.metric-popout .edit-input-wrapper {
    justify-self: stretch;
}

.metric-popout .edit-input {
    width: 100%;
    padding: 4px 8px;
    font-family: Consolas, monospace;
    font-size: 20px;
    background: #222;
    color: #fff;
    border: 1px solid #555;
    border-radius: 4px;
    box-sizing: border-box;
}

.metric-popout .edit-input:focus {
    outline: none;
    border-color: #1976d2;
}

.metric-popout .edit-buttons {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    justify-content: flex-end;
}

.metric-popout .edit-buttons button {
    padding: 6px 16px;
    font-family: Consolas, monospace;
    font-size: 18px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.metric-popout .save-btn {
    background: #388e3c;
    color: #fff;
}
.metric-popout .save-btn:hover {
    background: #2e7d32;
}

.metric-popout .cancel-btn {
    background: #555;
    color: #fff;
}
.metric-popout .cancel-btn:hover {
    background: #444;
}

/* Compact variant (timeline view) */
.metric-popout-compact {
    padding: 10px 14px !important;
    border-radius: 6px !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
    font-size: 13px !important;
}

.metric-popout-compact .header h3 {
    font-size: 14px !important;
    padding-bottom: 4px !important;
}

.metric-popout-compact .body {
    grid-template-columns: auto 1fr !important;
    gap: 2px 8px !important;
    font-size: 13px !important;
}

.metric-popout-compact .edit-input {
    font-size: 13px !important;
    padding: 2px 6px !important;
}

.metric-popout-compact .edit-buttons button {
    font-size: 13px !important;
    padding: 3px 10px !important;
}

.metric-popout-compact .edit-buttons {
    margin-top: 4px !important;
}
</style>
