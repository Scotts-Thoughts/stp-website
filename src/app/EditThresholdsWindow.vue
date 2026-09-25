<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Window from '../components/Window.vue'
import { METRIC, METRIC_TIME_KEYS, type MetricKeys, type ThresholdScheduleEntry, type ThresholdView, useTierlist, useWorkspace } from '../store';
import { formatTimeHM, formatTimeHMS } from '../utils/time';
import { THRESHOLD_VIEWS, activeScheduleEntryIndex, ensureThresholdSchedule, getThresholdSchedule, resolveScheduledLabel } from '../utils/threshold-schedule';

// ============================================================================
// Component Props & Emits
// ============================================================================

const props = defineProps<{
    visible: boolean
}>();

defineEmits<{
    close: []
}>();

// ============================================================================
// Types
// ============================================================================

type ViewKey = ThresholdView;

/** A unified representation of a threshold group, merging data from all views. */
type UnifiedSet = {
    label: string
    data: number[]
}

// ============================================================================
// Constants
// ============================================================================

const TIER_NAMES = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'Surge'];
const ALL_VIEWS: ViewKey[] = THRESHOLD_VIEWS;
/** UI names per internal view key ('best' is shown as Followup, 'recent' as Best). */
const VIEW_TITLES: Record<ViewKey, string> = { first: 'First', best: 'Followup', recent: 'Best' };
const VISIBLE_METRICS: MetricKeys[] = ['realtime', 'gametime', 'level', 'resets', 'blackouts', 'faults'];
const thresholdMetrics = VISIBLE_METRICS.map(k => ({ key: k, title: METRIC[k].title }));

// ============================================================================
// State
// ============================================================================

const workspace = useWorkspace();
const tierlist = useTierlist();
const selectedMetric = ref<MetricKeys>('realtime');

// Use the 1920x1080 coordinate space that the Window component expects
const centeredPosition = computed(() => ({
    x: (1920 - 1400) / 2,
    y: (1080 - 600) / 2,
}));

// ---- Version bump pattern ----
// Vue cannot detect in-place mutations of deeply nested tierlist threshold objects.
// Incrementing `version` forces `allSets`, `isActiveFor` and the schedule to recompute.
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

/** Gets the threshold array for the given metric (defaults to the selected one) in the given view. */
function getArr(view: ViewKey, metric: MetricKeys = selectedMetric.value): { label: string; data: number[] }[] {
    return getThresholdsObj(view)[metric] ?? [];
}

/** Sets the threshold array for the given metric (defaults to the selected one) in the given view (immutable spread for reactivity). */
function setArr(view: ViewKey, arr: { label: string; data: number[] }[], metric: MetricKeys = selectedMetric.value) {
    const tl = workspace.activeTierlist;
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

/** Gametime thresholds are entered/displayed without seconds (H:MM); realtime keeps H:MM:SS. */
function isGametimeMetric(metric: string): boolean {
    return metric === 'gametime' || metric === 'gametime_0';
}

/**
 * Ensures all three views contain every threshold group label for the given metric,
 * adding any missing ones by copying data from a view that already has it.
 *
 * This is non-destructive: an existing per-view entry is never modified, only missing
 * labels are appended. Keeping the label sets identical across views is what guarantees
 * every group defined here is selectable in the Filter dialog's dropdown, regardless of
 * which view (First/Followup/Best) is currently active.
 */
function syncViewGroups(metric: MetricKeys) {
    const order: string[] = [];
    const dataByLabel = new Map<string, number[]>();
    for (const view of ALL_VIEWS) {
        for (const set of getArr(view, metric)) {
            if (!dataByLabel.has(set.label)) {
                dataByLabel.set(set.label, set.data);
                order.push(set.label);
            }
        }
    }
    if (order.length === 0) return;
    for (const view of ALL_VIEWS) {
        const arr = getArr(view, metric);
        const have = new Set(arr.map(s => s.label));
        const missing = order.filter(l => !have.has(l));
        if (missing.length === 0) continue;
        const added = missing.map(l => ({ label: l, data: [...(dataByLabel.get(l) ?? Array(8).fill(0))] }));
        setArr(view, [...arr, ...added], metric);
    }
}

/** Completes the group lists across views for every editable metric (used when the dialog opens). */
function syncAllMetrics() {
    for (const m of VISIBLE_METRICS) syncViewGroups(m);
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
    updateScheduleReferences(selectedMetric.value, set.label, undefined);
    cancelCellEdit();
    if (editingLabelIdx.value === idx) editingLabelIdx.value = null;
    bump();
}

// ============================================================================
// Dated Schedule
// ============================================================================
//
// Each view (First/Followup/Best) has a list of dated changes. An entry assigns a
// threshold group per metric from its date onward; metrics it leaves blank carry
// over from earlier entries. The tierlist's display date picks the entry in effect.

/** Checks whether a threshold group is the one in effect for a view on the display date (selected metric). */
function isActiveFor(idx: number, view: ViewKey): boolean {
    void version.value; // dependency on version for reactivity
    const set = allSets.value[idx];
    if (!set) return false;
    return resolveScheduledLabel(workspace.activeTierlist, view, selectedMetric.value, tierlist.releaseDateTreshold) === set.label;
}

/** Group labels available for a metric (union across views, in display order). */
function labelsFor(metric: MetricKeys): string[] {
    void version.value;
    const labels: string[] = [];
    for (const view of ALL_VIEWS) {
        for (const set of getArr(view, metric)) {
            if (!labels.includes(set.label)) labels.push(set.label);
        }
    }
    return labels;
}

/** Metrics shown in schedule entries: those with at least one threshold group. */
const scheduleMetrics = computed(() => {
    void version.value;
    return VISIBLE_METRICS.filter(m => labelsFor(m).length > 0).map(m => ({ key: m, title: METRIC[m].title }));
});

type ScheduleColumn = {
    view: ViewKey
    title: string
    entries: ThresholdScheduleEntry[]
    activeIdx: number
}

/** Each view's entries sorted by date, with the entry in effect on the display date marked. */
const scheduleColumns = computed<ScheduleColumn[]>(() => {
    void version.value;
    const schedule = getThresholdSchedule(workspace.activeTierlist);
    return ALL_VIEWS.map(view => {
        const entries = [...(schedule[view] ?? [])].sort((a, b) => a.from.localeCompare(b.from));
        return { view, title: VIEW_TITLES[view], entries, activeIdx: activeScheduleEntryIndex(entries, tierlist.releaseDateTreshold) };
    });
});

/**
 * Current stored entries for a view. Converts legacy defaults into a schedule first,
 * so edits always target thresholdSchedule. Entries are identified by their date,
 * which is unique within a view.
 */
function editableEntries(view: ViewKey): ThresholdScheduleEntry[] {
    return ensureThresholdSchedule(workspace.activeTierlist)[view] ?? [];
}

/** Replaces a view's entry list (immutable spread for reactivity). */
function setEntries(view: ViewKey, entries: ThresholdScheduleEntry[]) {
    const tl = workspace.activeTierlist;
    tl.thresholdSchedule = { ...ensureThresholdSchedule(tl), [view]: entries };
    bump();
}

/** Adds an empty change to a view on the display date (every metric carries over until set). */
function addEntry(view: ViewKey) {
    const entries = editableEntries(view);
    const from = tierlist.releaseDateTreshold;
    if (entries.some(e => e.from === from)) {
        alert(`${VIEW_TITLES[view]} already has a change on ${from}. Change the display date or edit that entry.`);
        return;
    }
    setEntries(view, [...entries, { from, sets: {} }]);
}

function deleteEntry(view: ViewKey, from: string) {
    if (!confirm(`Delete the ${VIEW_TITLES[view]} change on ${from}?`)) return;
    setEntries(view, editableEntries(view).filter(e => e.from !== from));
}

function setEntryDate(view: ViewKey, from: string, value: string) {
    if (!value || value === from) { bump(); return; }
    const entries = editableEntries(view);
    if (entries.some(e => e.from === value)) {
        alert(`${VIEW_TITLES[view]} already has a change on ${value}.`);
        bump(); // re-render the input with the old date
        return;
    }
    setEntries(view, entries.map(e => e.from === from ? { ...e, from: value } : e));
}

/** Sets (or clears, with '') the group an entry assigns to a metric. */
function setEntryMetric(view: ViewKey, from: string, metric: MetricKeys, label: string) {
    setEntries(view, editableEntries(view).map(e => {
        if (e.from !== from) return e;
        const sets = { ...e.sets };
        if (label) sets[metric] = label; else delete sets[metric];
        return { ...e, sets };
    }));
}

/** The group a blank metric in this entry resolves to (earlier entries first, then later ones). */
function inheritedLabel(column: ScheduleColumn, entryIdx: number, metric: MetricKeys): string | undefined {
    for (let i = entryIdx - 1; i >= 0; i--) {
        const label = column.entries[i].sets[metric];
        if (label) return label;
    }
    for (let i = entryIdx + 1; i < column.entries.length; i++) {
        const label = column.entries[i].sets[metric];
        if (label) return label;
    }
    return undefined;
}

/** Label for a blank metric's option: what it currently falls back to. */
function inheritedOptionText(column: ScheduleColumn, entryIdx: number, metric: MetricKeys): string {
    const label = inheritedLabel(column, entryIdx, metric);
    return label ? `(same: ${label})` : '(first group)';
}

/** Applies a group rename (or removal, with newLabel undefined) to schedule references for a metric. */
function updateScheduleReferences(metric: MetricKeys, oldLabel: string, newLabel: string | undefined) {
    const tl = workspace.activeTierlist;
    if (tl.thresholdSchedule) {
        const next = { ...tl.thresholdSchedule };
        for (const view of ALL_VIEWS) {
            const entries = next[view];
            if (!entries) continue;
            next[view] = entries.map(e => {
                if (e.sets[metric] !== oldLabel) return e;
                const sets = { ...e.sets };
                if (newLabel) sets[metric] = newLabel; else delete sets[metric];
                return { ...e, sets };
            });
        }
        tl.thresholdSchedule = next;
    }
    // Legacy defaults (not yet converted) must keep resolving too.
    for (const view of ALL_VIEWS) {
        const defaults = tl.thresholdDefaults?.[view];
        if (!defaults || defaults[metric] !== oldLabel) continue;
        if (newLabel) defaults[metric] = newLabel; else delete defaults[metric];
    }
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
    // Time cells use digit-entry (start blank). Numeric cells prefill the current value
    // so it's visible/editable and tabbing past a cell doesn't blank it to 0.
    const set = allSets.value[idx];
    numberInput.value = isTimeMetric(selectedMetric.value) ? '' : String(set?.data[tierIdx] ?? '');
    nextTick(() => {
        const input = document.querySelector('.cell-input') as HTMLInputElement;
        if (input) {
            input.focus();
            if (!isTimeMetric(selectedMetric.value)) input.select();
        }
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
        if (numberInput.value.trim() === '') { cancelCellEdit(); return null; }
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
    const max = isGametimeMetric(selectedMetric.value) ? 4 : 6;
    if (text) digits.value = text.split('').map(Number).slice(-max).reverse();
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
// Gametime has no seconds field, so its buffer is 4 digits max:
//   digits[0] = minutes ones, digits[1] = minutes tens,
//   digits[2] = hours ones,   digits[3] = hours tens.

const digits = ref<number[]>([]);

/** Converts the current digit buffer to a display string "H:MM:SS" (or "H:MM" for gametime). */
function digitsToDisplay(): string {
    const d = digits.value;
    const pad = (n: number) => String(n).padStart(2, '0');
    if (isGametimeMetric(selectedMetric.value)) {
        const h = ((d[3] ?? 0) * 10) + (d[2] ?? 0);
        const m = ((d[1] ?? 0) * 10) + (d[0] ?? 0);
        return `${h}:${pad(m)}`;
    }
    const h = ((d[5] ?? 0) * 10) + (d[4] ?? 0);
    const m = ((d[3] ?? 0) * 10) + (d[2] ?? 0);
    const s = ((d[1] ?? 0) * 10) + (d[0] ?? 0);
    return `${h}:${pad(m)}:${pad(s)}`;
}

/** Converts the current digit buffer to milliseconds. */
function digitsToMs(): number {
    const d = digits.value;
    if (isGametimeMetric(selectedMetric.value)) {
        const h = ((d[3] ?? 0) * 10) + (d[2] ?? 0);
        const m = ((d[1] ?? 0) * 10) + (d[0] ?? 0);
        return (h * 60 + m) * 60 * 1000;
    }
    const h = ((d[5] ?? 0) * 10) + (d[4] ?? 0);
    const m = ((d[3] ?? 0) * 10) + (d[2] ?? 0);
    const s = ((d[1] ?? 0) * 10) + (d[0] ?? 0);
    return ((h * 60 + m) * 60 + s) * 1000;
}

/** Pushes a new digit onto the front (ones place) and shifts existing digits left. */
function digitsPush(digit: number) {
    const max = isGametimeMetric(selectedMetric.value) ? 4 : 6;
    digits.value = [digit, ...digits.value].slice(0, max);
}

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
    if (newName !== oldName) updateScheduleReferences(metric, oldName, newName);
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
    if (isGametimeMetric(selectedMetric.value)) return formatTimeHM(v);
    if (isTimeMetric(selectedMetric.value)) return formatTimeHMS(v, false);
    return String(v);
}

// ============================================================================
// View synchronization
// ============================================================================

// When the dialog opens, complete every view's group list so each set is available
// in the Filter dropdown regardless of which view (First/Followup/Best) is active.
watch(() => props.visible, (visible) => {
    if (!visible) return;
    cancelCellEdit();
    editingLabelIdx.value = null;
    syncAllMetrics();
    bump();
});

// Switching metrics inside the dialog: drop any in-progress edit and complete the new
// metric's group list across views.
watch(selectedMetric, (metric) => {
    cancelCellEdit();
    editingLabelIdx.value = null;
    syncViewGroups(metric);
    bump();
});
</script>


<template>
    <Window title="Threshold Groups" :visible="visible" :width="1400" :height="900" @close="$emit('close')" :resizable="true" :custom-position="centeredPosition">
        <div class="thresholds-window">
            <div class="top-bar">
                <select v-model="selectedMetric" class="metric-select">
                    <option v-for="m in thresholdMetrics" :key="m.key" :value="m.key">{{ m.title }}</option>
                </select>
                <button class="add-btn" @click="createSet">+ New</button>
                <label class="display-date" title="The tierlist display date decides which dated change is in effect">
                    Display date
                    <input type="date" v-model="tierlist.releaseDateTreshold" />
                </label>
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
                    <span
                        v-for="view in ALL_VIEWS" :key="view"
                        class="view-badge" :class="{ on: isActiveFor(idx, view) }"
                        :title="(isActiveFor(idx, view) ? 'In effect' : 'Not in effect') + ' for ' + VIEW_TITLES[view] + ' on ' + tierlist.releaseDateTreshold"
                    >{{ VIEW_TITLES[view] }}</span>
                    <button class="view-btn del" @click="deleteSet(idx)" title="Delete group">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                    </button>
                </div>
            </div>

            <div class="schedule-title">Schedule</div>
            <div class="schedule">
                <div v-for="column in scheduleColumns" :key="column.view" class="schedule-col">
                    <div class="schedule-col-title">{{ column.title }}</div>
                    <div v-if="column.entries.length === 0" class="empty">No changes. Every metric uses its first group.</div>
                    <div
                        v-for="(entry, ei) in column.entries"
                        :key="entry.from + version"
                        class="schedule-entry"
                        :class="{ active: ei === column.activeIdx }"
                    >
                        <div class="entry-head">
                            <input type="date" class="entry-date" :value="entry.from" @change="setEntryDate(column.view, entry.from, ($event.target as HTMLInputElement).value)" />
                            <span v-if="ei === column.activeIdx" class="entry-active">in effect</span>
                            <button class="view-btn del" @click="deleteEntry(column.view, entry.from)" title="Delete this change">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                            </button>
                        </div>
                        <div v-for="m in scheduleMetrics" :key="m.key" class="entry-metric">
                            <span class="entry-metric-name">{{ m.title }}</span>
                            <select
                                class="entry-select"
                                :class="{ inherited: !entry.sets[m.key] }"
                                :value="entry.sets[m.key] ?? ''"
                                @change="setEntryMetric(column.view, entry.from, m.key, ($event.target as HTMLSelectElement).value)"
                            >
                                <option value="">{{ inheritedOptionText(column, ei, m.key) }}</option>
                                <option v-for="label in labelsFor(m.key)" :key="label" :value="label">{{ label }}</option>
                            </select>
                        </div>
                    </div>
                    <button class="add-btn add-entry" @click="addEntry(column.view)">+ Change on {{ tierlist.releaseDateTreshold }}</button>
                </div>
            </div>

            <div class="hint">Click values to edit. Tab/Enter to advance. Each schedule change applies from its date until the next one; blank metrics keep the previous group. Ctrl+S to save.</div>
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

.display-date { display: flex; align-items: center; gap: 6px; color: #aaa; font-size: 14px; white-space: nowrap; }
.display-date input, .entry-date {
    padding: 6px 8px; background: #222; border: 1px solid #444; border-radius: 4px;
    color: white; font-size: 14px; color-scheme: dark;
}

.view-badge {
    padding: 4px 8px; background: #333; border: 1px solid #444;
    border-radius: 3px; color: #666; font-size: 14px; cursor: default;
}
.view-badge.on { background: #1a3a1a; border-color: #3a7a3a; color: #6c6; }

.schedule-title { margin-top: 12px; color: #aaa; font-size: 16px; border-bottom: 1px solid #444; padding-bottom: 6px; }
.schedule { display: flex; gap: 12px; align-items: flex-start; }
.schedule-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.schedule-col-title { font-size: 16px; color: #ddd; }
.schedule-entry { border: 1px solid #333; border-radius: 4px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
.schedule-entry.active { border-color: #3a7a3a; background: rgba(58, 122, 58, 0.12); }
.entry-head { display: flex; align-items: center; gap: 8px; }
.entry-active { color: #6c6; font-size: 12px; }
.entry-head .del { margin-left: auto; }
.entry-metric { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.entry-metric-name { width: 90px; flex-shrink: 0; color: #999; }
.entry-select {
    flex: 1; min-width: 0; padding: 4px 6px; background: #222;
    border: 1px solid #444; border-radius: 3px; color: white; font-size: 14px;
}
.entry-select.inherited { color: #777; }
.add-entry { font-size: 14px; padding: 6px 10px; }

.empty { color: #888; font-style: italic; text-align: center; padding: 20px 0; }
.hint { font-size: 11px; color: #999; text-align: center; margin-top: 4px; }
</style>
