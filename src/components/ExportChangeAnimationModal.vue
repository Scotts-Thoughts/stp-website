<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { onClickOutside } from '@vueuse/core';

const props = defineProps<{
    visible: boolean
    /** Date the tierlist is currently being viewed on; pre-fills Date 1. */
    date1: string
}>();

const emit = defineEmits<{
    close: []
    export: [payload: { date1: string, date2: string }]
}>();

const popupRef = ref<HTMLDivElement>();
const startDate = ref<string>(props.date1);
const endDate = ref<string>(props.date1);

// Re-seed the fields each time the modal opens so Date 1 reflects the current view.
watch(() => props.visible, async (visible) => {
    if (visible) {
        startDate.value = props.date1;
        endDate.value = props.date1;
        await nextTick();
        popupRef.value?.focus();
    }
});

onClickOutside(popupRef, () => {
    if (props.visible) emit('close');
});

function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
        e.preventDefault();
    }
}

function doExport() {
    if (!startDate.value || !endDate.value) return;
    emit('export', { date1: startDate.value, date2: endDate.value });
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
                <span>Export Change Animation</span>
                <button class="close-button" @click="$emit('close')" title="Close">×</button>
            </div>
            <div class="change-anim-content">
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
                <div class="actions">
                    <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
                    <button
                        class="btn btn-primary"
                        :disabled="!startDate || !endDate"
                        @click="doExport"
                    >Export</button>
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
    max-width: 420px;
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

.btn-secondary:hover {
    background-color: #444;
    color: #fff;
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
