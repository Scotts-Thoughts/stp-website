<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { useTierlist } from '../store';

const props = defineProps<{
    visible: boolean
    /** Date the tierlist is currently being viewed on; pre-fills Date 1. */
    date1: string
}>();

export type ChangeAnimationExport = {
    date1: string
    date2: string
    /** 'sequence' = one video per Pokémon plus stills; 'single' = everything fades in at once. */
    mode: 'sequence' | 'single'
    /** Reveal order for the sequence (first video first). */
    order: string[]
};

const emit = defineEmits<{
    close: []
    export: [payload: ChangeAnimationExport]
}>();

const tierlist = useTierlist();

const popupRef = ref<HTMLDivElement>();
const startDate = ref<string>(props.date1);
const endDate = ref<string>(nextDay(props.date1));
const view = ref<'dates' | 'order'>('dates');

/** YYYY-MM-DD string for the day after `date`; UTC math avoids DST/timezone off-by-one. */
function nextDay(date: string): string {
    const d = new Date(`${date}T00:00:00Z`);
    if (isNaN(d.getTime())) return date;
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

// Pokémon whose result changes between the two dates, worst result first.
const defaultOrder = computed(() => {
    if (!props.visible || !startDate.value || !endDate.value) return [];
    return tierlist.featuredBetween(startDate.value, endDate.value);
});

// A user-chosen order, kept only while it still covers exactly the detected Pokémon.
const customOrder = ref<string[] | null>(null);
const order = computed(() => {
    const custom = customOrder.value;
    const detected = defaultOrder.value;
    if (custom && custom.length === detected.length && detected.every(n => custom.includes(n))) return custom;
    return detected;
});
const isCustomOrder = computed(() => order.value !== defaultOrder.value);

// Re-seed the fields each time the modal opens so Date 1 reflects the current view.
watch(() => props.visible, async (visible) => {
    if (visible) {
        startDate.value = props.date1;
        endDate.value = nextDay(props.date1);
        customOrder.value = null;
        view.value = 'dates';
        await nextTick();
        popupRef.value?.focus();
    }
});

onClickOutside(popupRef, () => {
    if (props.visible) emit('close');
});

function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        if (view.value === 'order') view.value = 'dates';
        else emit('close');
        e.preventDefault();
    }
}

function doExport(mode: 'sequence' | 'single') {
    if (!startDate.value || !endDate.value) return;
    emit('export', { date1: startDate.value, date2: endDate.value, mode, order: [...order.value] });
}

// ── Order editing ──

function move(from: number, to: number) {
    const list = [...order.value];
    if (to < 0 || to >= list.length || from === to) return;
    const [name] = list.splice(from, 1);
    list.splice(to, 0, name);
    customOrder.value = list;
}

const dragIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);

function onDragStart(e: DragEvent, i: number) {
    dragIndex.value = i;
    e.dataTransfer?.setData('text/plain', String(i));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e: DragEvent, i: number) {
    if (dragIndex.value === null) return;
    e.preventDefault();
    dropIndex.value = i;
}

function onDrop(i: number) {
    if (dragIndex.value !== null) move(dragIndex.value, i);
    dragIndex.value = null;
    dropIndex.value = null;
}

function onDragEnd() {
    dragIndex.value = null;
    dropIndex.value = null;
}
</script>

<template>
    <div v-if="visible" class="quick-calendar-overlay">
        <div
            ref="popupRef"
            class="change-anim-popup"
            @keydown="handleKeydown"
            tabindex="0"
        >
            <div class="change-anim-header">
                <span>{{ view === 'order' ? 'Change Export Order' : 'Export Change Animation' }}</span>
                <button class="close-button" @click="$emit('close')" title="Close">×</button>
            </div>

            <div v-if="view === 'dates'" class="change-anim-content">
                <p class="hint">
                    Animate the tierlist morphing from its state on Date 1 to its state on Date 2.
                </p>
                <div class="date-field">
                    <label for="cae-date1">Date 1 (from)</label>
                    <input id="cae-date1" type="date" v-model="startDate" class="date-input" />
                </div>
                <div class="date-field">
                    <label for="cae-date2">Date 2 (to)</label>
                    <input id="cae-date2" type="date" v-model="endDate" class="date-input" />
                </div>

                <div class="sequence-summary">
                    <div class="sequence-summary-header">
                        <span>Reveal order{{ isCustomOrder ? ' (custom)' : ' (worst → best)' }}</span>
                        <button
                            class="link-button"
                            :disabled="order.length < 2"
                            @click="view = 'order'"
                        >Change order…</button>
                    </div>
                    <ol v-if="order.length > 0" class="sequence-list">
                        <li v-for="name in order" :key="name">{{ name }}</li>
                    </ol>
                    <p v-else class="hint">No Pokémon change between these dates.</p>
                </div>

                <p class="hint">
                    <b>Export Sequence</b> asks for a folder and saves one video per Pokémon, a still
                    before the first reveal, highlight stills (the Pokémon, one rank below, one rank
                    above) after each reveal, and a still per type among the revealed Pokémon. The
                    view is left on Date 2.
                </p>

                <div class="actions">
                    <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
                    <button
                        class="btn btn-secondary"
                        :disabled="!startDate || !endDate"
                        title="One video with every change animated at once"
                        @click="doExport('single')"
                    >Single Video</button>
                    <button
                        class="btn btn-primary"
                        :disabled="!startDate || !endDate || order.length === 0"
                        @click="doExport('sequence')"
                    >Export Sequence</button>
                </div>
            </div>

            <div v-else class="change-anim-content">
                <p class="hint">
                    Drag or use the arrows to set the order the Pokémon are revealed in. Video 1
                    reveals the top entry.
                </p>
                <ol class="order-list">
                    <li
                        v-for="(name, i) in order"
                        :key="name"
                        class="order-item"
                        :class="{ dragging: dragIndex === i, 'drop-target': dropIndex === i && dragIndex !== i }"
                        draggable="true"
                        @dragstart="onDragStart($event, i)"
                        @dragover="onDragOver($event, i)"
                        @drop.prevent="onDrop(i)"
                        @dragend="onDragEnd"
                    >
                        <span class="order-index">{{ i + 1 }}</span>
                        <span class="order-name">{{ name }}</span>
                        <button class="arrow-button" :disabled="i === 0" title="Move up" @click="move(i, i - 1)">▲</button>
                        <button class="arrow-button" :disabled="i === order.length - 1" title="Move down" @click="move(i, i + 1)">▼</button>
                    </li>
                </ol>
                <div class="actions">
                    <button
                        class="btn btn-secondary"
                        :disabled="!isCustomOrder"
                        @click="customOrder = null"
                    >Reset (worst → best)</button>
                    <button class="btn btn-primary" @click="view = 'dates'">Done</button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.quick-calendar-overlay {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
}

.change-anim-popup {
    background-color: #2a2a2a;
    border: 1px solid #444;
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    min-width: 340px;
    max-width: 440px;
    animation: popup-enter 0.2s ease-out;
    outline: none;
}

@keyframes popup-enter {
    from { opacity: 0; transform: scale(0.9) translateY(-10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}

.change-anim-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #444;
    background-color: #333;
    border-radius: 8px 8px 0 0;
}

.change-anim-header span {
    font-weight: bold;
    color: #fff;
}

.close-button {
    background: none;
    border: none;
    color: #ccc;
    font-size: 20px;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background-color 0.2s;
}

.close-button:hover {
    background-color: #444;
    color: #fff;
}

.change-anim-content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.hint {
    margin: 0;
    color: #aaa;
    font-size: 13px;
    line-height: 1.4;
}

.date-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.date-field label {
    color: #ccc;
    font-size: 14px;
    font-weight: 500;
}

.date-input {
    padding: 8px 12px;
    background-color: #1a1a1a;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s;
    color-scheme: dark;
}

.date-input:focus {
    border-color: #007acc;
}

.sequence-summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background-color: #1f1f1f;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
}

.sequence-summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: #ccc;
    font-size: 14px;
    font-weight: 500;
}

.sequence-list {
    margin: 0;
    padding-left: 22px;
    color: #eee;
    font-size: 14px;
    line-height: 1.5;
    max-height: 160px;
    overflow-y: auto;
}

.link-button {
    background: none;
    border: none;
    color: #4aa8ff;
    font-size: 13px;
    cursor: pointer;
    padding: 0;
}

.link-button:hover:not(:disabled) {
    text-decoration: underline;
}

.link-button:disabled {
    color: #666;
    cursor: not-allowed;
}

.order-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 320px;
    overflow-y: auto;
}

.order-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background-color: #1f1f1f;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #eee;
    font-size: 14px;
    cursor: grab;
}

.order-item.dragging {
    opacity: 0.4;
}

.order-item.drop-target {
    border-color: #007acc;
}

.order-index {
    width: 20px;
    color: #888;
    text-align: right;
}

.order-name {
    flex: 1;
}

.arrow-button {
    background-color: #333;
    border: 1px solid #444;
    border-radius: 3px;
    color: #ccc;
    font-size: 10px;
    width: 24px;
    height: 22px;
    cursor: pointer;
}

.arrow-button:hover:not(:disabled) {
    background-color: #444;
    color: #fff;
}

.arrow-button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

.actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
}

.btn {
    padding: 8px 16px;
    border-radius: 4px;
    border: 1px solid #444;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
}

.btn-secondary {
    background-color: #333;
    color: #ccc;
}

.btn-secondary:hover:not(:disabled) {
    background-color: #444;
    color: #fff;
}

.btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn-primary {
    background-color: #007acc;
    border-color: #007acc;
    color: #fff;
}

.btn-primary:hover:not(:disabled) {
    background-color: #0a8ae0;
}

.btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
