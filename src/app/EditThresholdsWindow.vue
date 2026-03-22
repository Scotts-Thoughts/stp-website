<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Window from '../components/Window.vue'
import { METRIC, METRIC_TIME_KEYS, type MetricKeys, useWorkspace } from '../store';
import { formatTimeHMS } from '../utils/time';

// ============================================================================
// Component Props & Emits
// ============================================================================

defineProps<{
    visible: boolean
}>();

defineEmits<{
    close: []
}>();

// ============================================================================
// Types
// ============================================================================

type ViewKey = 'first' | 'best' | 'recent';

/** A unified representation of a threshold group, merging data from all views. */
type UnifiedSet = {
    label: string
    data: number[]
}

// ============================================================================
// Constants
// ============================================================================

const TIER_NAMES = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'Surge'];
const ALL_VIEWS: ViewKey[] = ['first', 'best', 'recent'];
const VISIBLE_METRICS: MetricKeys[] = ['realtime', 'gametime', 'level', 'resets', 'blackouts', 'faults'];
const thresholdMetrics = VISIBLE_METRICS.map(k => ({ key: k, title: METRIC[k].title }));

// ============================================================================
// State
// ============================================================================

const workspace = useWorkspace();
const selectedMetric = ref<MetricKeys>('realtime');

// Use the 1920x1080 coordinate space that the Window component expects
const centeredPosition = computed(() => ({
    x: (1920 - 1400) / 2,
    y: (1080 - 600) / 2,
}));

// ---- Version bump pattern ----
// Vue cannot detect in-place mutations of deeply nested tierlist threshold objects.
// Incrementing `version` forces `allSets` and `isAssigned` to recompute.
const version = ref(0);
function bump() { version.value++; }

// ============================================================================
// Computed: Unified Threshold Sets
// ============================================================================

/**
 * Merges threshold groups from all three views (first, best, recent) into a
 * single deduplicated list keyed by label. This gives the UI a unified view
 * of all groups regardless of which views they belong to.
 */
const allSets = computed<UnifiedSet[]>(() => {
    void version.value; // dependency on version for reactivity
    const metric = selectedMetric.value;
    const tl = workspace.activeTierlist;

    const sources = [
        tl.thresholds_first[metric] ?? [],
        tl.thresholds_best[metric] ?? [],
        ...(tl.thresholds_recent ? [tl.thresholds_recent[metric] ?? []] : []),
    ];

    const byLabel = new Map<string, UnifiedSet>();
    for (const arr of sources) {
        for (const set of arr) {
            if (!byLabel.has(set.label)) {
                byLabel.set(set.label, { label: set.label, data: set.data });
            }
        }
    }
    return Array.from(byLabel.values());
});

// ============================================================================
// Threshold Array Accessors
// ============================================================================

/** Returns the threshold object for the given view, initializing thresholds_recent if needed. */
function getThresholdsObj(view: ViewKey) {
    const tl = workspace.activeTierlist;
    if (view === 'first') return tl.thresholds_first;
    if (view === 'best') return tl.thresholds_best;
    if (!tl.thresholds_recent) tl.thresholds_recent = {};
    return tl.thresholds_recent;
}

/** Gets the threshold array for the current metric in the given view. */
function getArr(view: ViewKey): { label: string; data: number[] }[] {
    return getThresholdsObj(view)[selectedMetric.value] ?? [];
}

/** Sets the threshold array for the current metric in the given view (immutable spread for reactivity). */
function setArr(view: ViewKey, arr: { label: string; data: number[] }[]) {
    const tl = workspace.activeTierlist;
    const metric = selectedMetric.value;
    if (view === 'first') {
        tl.thresholds_first = { ...tl.thresholds_first, [metric]: arr };
    } else if (view === 'best') {
        tl.thresholds_best = { ...tl.thresholds_best, [metric]: arr };
    } else {
        if (!tl.thresholds_recent) tl.thresholds_recent = {};
        tl.thresholds_recent = { ...tl.thresholds_recent, [metric]: arr };
    }
}

function isTimeMetric(metric: string): boolean {
    return (METRIC_TIME_KEYS as readonly string[]).includes(metric);
}

// ============================================================================
// CRUD Operations
// ============================================================================

/** Creates a new threshold group and adds it to all three views. */
function createSet() {
    const name = `Set ${allSets.value.length + 1}`;
    for (const view of ALL_VIEWS) {
        setArr(view, [...getArr(view), { label: name, data: Array(8).fill(0) }]);
    }
    bump();
}

/** Deletes a threshold group from all three views (with confirmation). */
function deleteSet(idx: number) {
    const set = allSets.value[idx];
    if (!set) return;
    if (!confirm(`Delete threshold group "${set.label}"?`)) return;
    for (const view of ALL_VIEWS) {
        setArr(view, getArr(view).filter(s => s.label !== set.label));
    }
    cancelCellEdit();
    if (editingLabelIdx.value === idx) editingLabelIdx.value = null;
    bump();
}

// ============================================================================
// Default Assignment
// ============================================================================

/** Ensures the thresholdDefaults object exists on the tierlist and returns it. */
function ensureDefaults() {
    const tl = workspace.activeTierlist;
    if (!tl.thresholdDefaults) tl.thresholdDefaults = {};
    return tl.thresholdDefaults;
}

/**
 * Assigns a threshold group as the default for a specific view and metric.
 * Also ensures the group exists in that view's array (adds it if missing).
 */
function assignToView(idx: number, view: ViewKey) {
    const set = allSets.value[idx];
    if (!set) return;
    const metric = selectedMetric.value;

    // Ensure this group exists in the view's array
    const arr = [...getArr(view)];
    if (!arr.some(s => s.label === set.label)) {
        arr.push({ label: set.label, data: [...set.data] });
        setArr(view, arr);
    }

    // Store as the default for this view + metric
    const defaults = ensureDefaults();
    if (!defaults[view]) defaults[view] = {};
    defaults[view]![metric] = set.label;

    bump();
}

/** Checks whether a threshold group is the assigned default for a given view and metric. */
function isAssigned(idx: number, view: ViewKey): boolean {
    void version.value; // dependency on version for reactivity
    const set = allSets.value[idx];
    if (!set) return false;
    const defaults = workspace.activeTierlist.thresholdDefaults;
    return defaults?.[view]?.[selectedMetric.value] === set.label;
}

// ============================================================================
// Cell Editing (Threshold Values)
// ============================================================================

const editingCell = ref<{ idx: number; tierIdx: number } | null>(null);
const numberInput = ref('');

// `advancing` flag prevents handleCellBlur from saving when Tab/Enter triggers
// saveCellAndAdvance (which already saves and moves to the next cell).
let advancing = false;

function startCellEdit(idx: number, tierIdx: number) {
    editingCell.value = { idx, tierIdx };
    digits.value = [];
    numberInput.value = '';
    nextTick(() => {
        const input = document.querySelector('.cell-input') as HTMLInputElement;
        if (input) input.focus();
    });
}

function cancelCellEdit() {
    editingCell.value = null;
    digits.value = [];
    numberInput.value = '';
}

function handleCellBlur() {
    if (advancing) return;
    saveCellEdit();
}

/**
 * Saves the current cell edit value to all views that contain the group.
 * Returns the saved cell position (for use by saveCellAndAdvance), or null if nothing was saved.
 */
function saveCellEdit(): { idx: number; tierIdx: number } | null {
    if (!editingCell.value) return null;
    const { idx, tierIdx } = editingCell.value;
    const set = allSets.value[idx];
    if (!set) { cancelCellEdit(); return null; }

    let newValue: number;
    if (isTimeMetric(selectedMetric.value)) {
        if (digits.value.length === 0) { cancelCellEdit(); return null; }
        newValue = digitsToMs();
    } else {
        const n = Number(numberInput.value);
        if (isNaN(n) || n < 0) { cancelCellEdit(); return null; }
        newValue = n;
    }

    // Update the value in ALL views that contain this group (keeps views in sync)
    const tl = workspace.activeTierlist;
    const metric = selectedMetric.value;
    for (const source of [tl.thresholds_first[metric], tl.thresholds_best[metric], tl.thresholds_recent?.[metric]]) {
        if (!source) continue;
        const entry = source.find(s => s.label === set.label);
        if (entry) entry.data[tierIdx] = newValue;
    }

    const pos = { idx, tierIdx };
    cancelCellEdit();
    bump();
    return pos;
}

/**
 * Saves the current cell and advances to the next (or previous with Shift) tier column.
 * Sets the `advancing` flag to prevent handleCellBlur from double-saving.
 */
function saveCellAndAdvance(reverse = false) {
    advancing = true;
    const pos = saveCellEdit();
    if (pos) {
        const next = reverse ? pos.tierIdx - 1 : pos.tierIdx + 1;
        if (next >= 0 && next <= 7) startCellEdit(pos.idx, next);
    }
    nextTick(() => { advancing = false; });
}

function handleCellKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        saveCellAndAdvance(event.shiftKey);
        return;
    }
    if (event.key === 'Escape') { event.preventDefault(); cancelCellEdit(); return; }

    // For time metrics, intercept keys to feed the digit-entry system
    if (isTimeMetric(selectedMetric.value)) {
        if (event.key === 'Backspace') { event.preventDefault(); digitsPop(); return; }
        if (/^\d$/.test(event.key)) { event.preventDefault(); digitsPush(parseInt(event.key, 10)); return; }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.preventDefault();
    }
}

function handleCellPaste(event: ClipboardEvent) {
    if (!isTimeMetric(selectedMetric.value)) return;
    event.preventDefault();
    const text = (event.clipboardData?.getData('text') || '').replace(/\D/g, '');
    if (text) digits.value = text.split('').map(Number).slice(-6).reverse();
}

// ============================================================================
// Digit-Based Time Entry
// ============================================================================
//
// Time values are entered digit-by-digit, right-to-left (like a calculator).
// The `digits` array stores individual digits in reverse order:
//   digits[0] = seconds ones, digits[1] = seconds tens,
//   digits[2] = minutes ones, digits[3] = minutes tens,
//   digits[4] = hours ones,   digits[5] = hours tens.
// Max 6 digits = HH:MM:SS.

const digits = ref<number[]>([]);

/** Converts the current digit buffer to a display string "H:MM:SS". */
function digitsToDisplay(): string {
    const d = digits.value;
    const pad = (n: number) => String(n).padStart(2, '0');
    const h = ((d[5] ?? 0) * 10) + (d[4] ?? 0);
    const m = ((d[3] ?? 0) * 10) + (d[2] ?? 0);
    const s = ((d[1] ?? 0) * 10) + (d[0] ?? 0);
    return `${h}:${pad(m)}:${pad(s)}`;
}

/** Converts the current digit buffer to milliseconds. */
function digitsToMs(): number {
    const d = digits.value;
    const h = ((d[5] ?? 0) * 10) + (d[4] ?? 0);
    const m = ((d[3] ?? 0) * 10) + (d[2] ?? 0);
    const s = ((d[1] ?? 0) * 10) + (d[0] ?? 0);
    return ((h * 60 + m) * 60 + s) * 1000;
}

/** Pushes a new digit onto the front (ones place) and shifts existing digits left. */
function digitsPush(digit: number) { digits.value = [digit, ...digits.value].slice(0, 6); }

/** Removes the most recent digit (from the ones place), shifting everything right. */
function digitsPop() { if (digits.value.length > 0) digits.value = digits.value.slice(1); }

// ============================================================================
// Label Editing
// ============================================================================

const editingLabelIdx = ref<number | null>(null);
const editLabelValue = ref('');

function startLabelEdit(idx: number) {
    const set = allSets.value[idx];
    if (!set) return;
    editingLabelIdx.value = idx;
    editLabelValue.value = set.label;
    nextTick(() => {
        const input = document.querySelector('.label-input') as HTMLInputElement;
        if (input) { input.focus(); input.select(); }
    });
}

/** Saves the label edit, renaming the group in all views for the current metric. */
function saveLabelEdit() {
    if (editingLabelIdx.value === null) return;
    const set = allSets.value[editingLabelIdx.value];
    if (!set) { editingLabelIdx.value = null; return; }
    const newName = editLabelValue.value.trim() || 'unnamed';
    const oldName = set.label;
    const tl = workspace.activeTierlist;
    const metric = selectedMetric.value;
    for (const source of [tl.thresholds_first[metric], tl.thresholds_best[metric], tl.thresholds_recent?.[metric]]) {
        if (!source) continue;
        const entry = source.find(s => s.label === oldName);
        if (entry) entry.label = newName;
    }
    editingLabelIdx.value = null;
    bump();
}

function handleLabelKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); saveLabelEdit(); }
    if (event.key === 'Escape') { event.preventDefault(); editingLabelIdx.value = null; }
}

// ============================================================================
// Drag-and-Drop Reordering
// ============================================================================
//
// Rows can be dragged to reorder threshold groups. When a drop occurs,
// the reorder is applied to all three view arrays simultaneously so they
// stay in sync. The drag state tracks both the source index and the
// current hover target for visual feedback.

const dragIdx = ref<number | null>(null);
const dragOverIdx = ref<number | null>(null);

function onDragStart(idx: number, event: DragEvent) {
    dragIdx.value = idx;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(idx));
    }
}

function onDragOver(idx: number, event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverIdx.value = idx;
}

function onDragLeave() {
    dragOverIdx.value = null;
}

function onDrop(idx: number) {
    const from = dragIdx.value;
    dragIdx.value = null;
    dragOverIdx.value = null;
    if (from === null || from === idx) return;

    // Reorder in all three view arrays by matching labels (not indices, since
    // each view's array may have different lengths or orderings)
    for (const view of ALL_VIEWS) {
        const arr = [...getArr(view)];
        const fromLabel = allSets.value[from]?.label;
        const toLabel = allSets.value[idx]?.label;
        if (!fromLabel || !toLabel) continue;
        const fi = arr.findIndex(s => s.label === fromLabel);
        const ti = arr.findIndex(s => s.label === toLabel);
        if (fi >= 0 && ti >= 0) {
            const [entry] = arr.splice(fi, 1);
            arr.splice(ti, 0, entry);
            setArr(view, arr);
        }
    }
    bump();
}

function onDragEnd() {
    dragIdx.value = null;
    dragOverIdx.value = null;
}

// ============================================================================
// Formatting
// ============================================================================

/** Formats a threshold value for display. Negative values show as '--'. */
function formatValue(v: number): string {
    if (v < 0) return '--';
    if (isTimeMetric(selectedMetric.value)) return formatTimeHMS(v, false);
    return String(v);
}
</script>


<template>
    <Window title="Threshold Groups" :visible="visible" :width="1400" :height="600" @close="$emit('close')" :resizable="true" :custom-position="centeredPosition">
        <div class="thresholds-window">
            <div class="top-bar">
                <select v-model="selectedMetric" class="metric-select">
                    <option v-for="m in thresholdMetrics" :key="m.key" :value="m.key">{{ m.title }}</option>
                </select>
                <button class="add-btn" @click="createSet">+ New</button>
            </div>

            <div class="row header">
                <div class="name-cell">Name</div>
                <div v-for="(t, ti) in TIER_NAMES" :key="t" class="val-cell" :class="'tier-color-' + ti">{{ t }}</div>
                <div class="btn-cell"></div>
            </div>

            <div v-if="allSets.length === 0" class="empty">No threshold sets for this metric.</div>

            <div
                v-for="(set, idx) in allSets"
                :key="set.label + version"
                class="row"
                :class="{ 'drag-over': dragOverIdx === idx, 'dragging': dragIdx === idx }"
                draggable="true"
                @dragstart="onDragStart(idx, $event)"
                @dragover="onDragOver(idx, $event)"
                @dragleave="onDragLeave"
                @drop="onDrop(idx)"
                @dragend="onDragEnd"
            >
                <div class="name-cell" @click="startLabelEdit(idx)">
                    <input v-if="editingLabelIdx === idx" v-model="editLabelValue" class="label-input" @blur="saveLabelEdit" @keydown="handleLabelKeydown" />
                    <span v-else class="name-text" :title="set.label">{{ set.label }}</span>
                </div>

                <div v-for="(v, ti) in set.data" :key="ti" class="val-cell" @click="startCellEdit(idx, ti)">
                    <input
                        v-if="editingCell?.idx === idx && editingCell?.tierIdx === ti"
                        :value="isTimeMetric(selectedMetric) ? digitsToDisplay() : numberInput"
                        @input="!isTimeMetric(selectedMetric) && (numberInput = ($event.target as HTMLInputElement).value)"
                        class="cell-input"
                        :class="'tier-color-' + ti"
                        @blur="handleCellBlur"
                        @keydown="handleCellKeydown"
                        @paste="handleCellPaste"
                    />
                    <span v-else class="val-text" :class="'tier-color-' + ti">{{ formatValue(v) }}</span>
                </div>

                <div class="btn-cell">
                    <button class="view-btn" :class="{ on: isAssigned(idx, 'first') }" @click="assignToView(idx, 'first')" title="Use for First Playthroughs">First</button>
                    <button class="view-btn" :class="{ on: isAssigned(idx, 'best') }" @click="assignToView(idx, 'best')" title="Use for Followup Playthroughs">Followup</button>
                    <button class="view-btn" :class="{ on: isAssigned(idx, 'recent') }" @click="assignToView(idx, 'recent')" title="Use for Best Playthroughs">Best</button>
                    <button class="view-btn del" @click="deleteSet(idx)" title="Delete group">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                    </button>
                </div>
            </div>

            <div class="hint">Click values to edit. Tab/Enter to advance. Assign a group to a view with First/Followup/Best. Ctrl+S to save.</div>
        </div>
    </Window>
</template>


<style scoped>
.thresholds-window { display: flex; flex-direction: column; gap: 6px; }

.top-bar { display: flex; align-items: center; gap: 8px; }

.metric-select {
    flex: 1; padding: 8px 10px; background: #222;
    border: 1px solid #444; border-radius: 4px; color: white; font-size: 16px;
}

.add-btn {
    padding: 8px 16px; background: #2a5a2a; border: 1px solid #3a7a3a;
    border-radius: 4px; color: #ccc; cursor: pointer; font-size: 16px; white-space: nowrap;
}
.add-btn:hover { background: #3a7a3a; color: white; }

.row { display: flex; align-items: center; gap: 8px; }
.row.header { color: #666; font-size: 16px; border-bottom: 1px solid #444; padding-bottom: 6px; }
.row:not(.header) { padding: 6px 0; border-bottom: 1px solid #2a2a2a; cursor: grab; }
.row.dragging { opacity: 0.4; }
.row.drag-over { border-top: 2px solid #4a90e2; }

.name-cell {
    width: 130px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; cursor: pointer; font-size: 18px;
}
.name-text { display: block; overflow: hidden; text-overflow: ellipsis; }
.name-text:hover { color: #fff; }
.label-input {
    width: 100%; padding: 4px 6px; background: #111;
    border: 1px solid #4a90e2; border-radius: 3px; color: white; font-size: 18px;
}

.val-cell { width: 90px; flex-shrink: 0; text-align: center; cursor: pointer; font-size: 18px; }
.val-text { display: block; padding: 6px 4px; border-radius: 3px; }
.val-text:hover { background: rgba(255,255,255,0.12); }

.tier-color-0 { color: #fe4040; }
.tier-color-1 { color: #fb9a3b; }
.tier-color-2 { color: #fce10e; }
.tier-color-3 { color: #91e261; }
.tier-color-4 { color: #7eacfa; }
.tier-color-5 { color: #a06ef0; }
.tier-color-6 { color: #c060bf; }
.tier-color-7 { color: #d04080; }

.cell-input {
    width: 100%; padding: 6px 2px; background: #111;
    border: 1px solid #4a90e2; border-radius: 3px; color: white; font-size: 16px; text-align: center;
}

.btn-cell { width: 240px; flex-shrink: 0; display: flex; gap: 4px; justify-content: flex-end; align-items: center; }
.view-btn {
    padding: 4px 8px; background: #333; border: 1px solid #444;
    border-radius: 3px; color: #777; cursor: pointer; font-size: 14px;
    display: flex; align-items: center; justify-content: center;
}
.view-btn:hover { background: #444; color: #ccc; }
.view-btn.on { background: #1a3a1a; border-color: #3a7a3a; color: #6c6; }
.view-btn.del { color: #a44; padding: 4px 6px; }
.view-btn.del:hover { color: #f66; }

.empty { color: #888; font-style: italic; text-align: center; padding: 20px 0; }
.hint { font-size: 11px; color: #999; text-align: center; margin-top: 4px; }
</style>
