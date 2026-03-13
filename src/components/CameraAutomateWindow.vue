<script setup lang="ts">
import { ref, computed } from 'vue'
import Window from './Window.vue';
import type { CameraSnapshot, CameraSequenceStep } from './TimelineView.vue';

const props = defineProps<{
    visible: boolean;
    snapshots: CameraSnapshot[];
    sequence: CameraSequenceStep[];
}>();

const emit = defineEmits<{
    close: [];
    takeSnapshot: [name: string];
    removeSnapshot: [index: number];
    goToSnapshot: [snap: CameraSnapshot];
    updateSequence: [steps: CameraSequenceStep[]];
    play: [];
}>();

const newSnapshotName = ref('');

function addSnapshot() {
    const name = newSnapshotName.value.trim() || `Snap ${props.snapshots.length + 1}`;
    emit('takeSnapshot', name);
    newSnapshotName.value = '';
}

function addStep() {
    const names = props.snapshots.map(s => s.name);
    if (names.length < 2) return;
    const newSteps = [...props.sequence, {
        startSnapshot: names[0],
        endSnapshot: names[1],
        durationMs: 3000,
    }];
    emit('updateSequence', newSteps);
}

function removeStep(index: number) {
    const newSteps = [...props.sequence];
    newSteps.splice(index, 1);
    emit('updateSequence', newSteps);
}

function updateStep(index: number, field: keyof CameraSequenceStep, value: string | number) {
    const newSteps = [...props.sequence];
    newSteps[index] = { ...newSteps[index], [field]: value };
    emit('updateSequence', newSteps);
}

const canPlay = computed(() => {
    if (props.sequence.length === 0) return false;
    return props.sequence.every(step => {
        return props.snapshots.some(s => s.name === step.startSnapshot) &&
               props.snapshots.some(s => s.name === step.endSnapshot);
    });
});
</script>


<template>
    <Window :visible="visible" title="Automate Camera" :width="420" @close="$emit('close')" :keep-position-on-show="true" :custom-position="{ x: 20, y: 20 }">
        <!-- Snapshots section -->
        <div class="section-label">Snapshots</div>
        <div class="snapshot-list">
            <div v-for="(snap, i) in snapshots" :key="i" class="snapshot-item">
                <span class="snapshot-name" @click="$emit('goToSnapshot', snap)">{{ snap.name }}</span>
                <button class="small-btn danger" @click="$emit('removeSnapshot', i)">&times;</button>
            </div>
            <div v-if="snapshots.length === 0" class="empty-text">No snapshots yet</div>
        </div>
        <div class="snapshot-add">
            <input
                v-model="newSnapshotName"
                class="text-input"
                placeholder="Snapshot name..."
                @keydown.enter="addSnapshot"
            />
            <button class="small-btn accent" @click="addSnapshot">Snapshot</button>
        </div>

        <!-- Sequence section -->
        <div class="section-label" style="margin-top: 14px;">Sequence</div>
        <div class="sequence-list">
            <div v-for="(step, i) in sequence" :key="i" class="sequence-step">
                <div class="step-row">
                    <label>From:</label>
                    <select :value="step.startSnapshot" @change="updateStep(i, 'startSnapshot', ($event.target as HTMLSelectElement).value)">
                        <option v-for="s in snapshots" :key="s.name" :value="s.name">{{ s.name }}</option>
                    </select>
                </div>
                <div class="step-row">
                    <label>To:</label>
                    <select :value="step.endSnapshot" @change="updateStep(i, 'endSnapshot', ($event.target as HTMLSelectElement).value)">
                        <option v-for="s in snapshots" :key="s.name" :value="s.name">{{ s.name }}</option>
                    </select>
                </div>
                <div class="step-row">
                    <label>Duration:</label>
                    <input
                        type="number"
                        class="num-input"
                        :value="step.durationMs / 1000"
                        min="0.5"
                        step="0.5"
                        @change="updateStep(i, 'durationMs', parseFloat(($event.target as HTMLInputElement).value) * 1000)"
                    />
                    <span class="unit">sec</span>
                    <button class="small-btn danger" @click="removeStep(i)">&times;</button>
                </div>
            </div>
            <div v-if="sequence.length === 0" class="empty-text">No steps yet</div>
        </div>
        <div class="sequence-actions">
            <button class="small-btn" @click="addStep" :disabled="snapshots.length < 2">Add Step</button>
            <button class="small-btn play-btn" :disabled="!canPlay" @click="$emit('play')">Play (P)</button>
        </div>
    </Window>
</template>


<style scoped>
.section-label {
    font-size: 14px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 6px;
}

.snapshot-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
}

.snapshot-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
}

.snapshot-name {
    cursor: pointer;
    color: #8cb4ff;
}
.snapshot-name:hover {
    text-decoration: underline;
}

.snapshot-add {
    display: flex;
    gap: 6px;
}

.text-input {
    flex: 1;
    padding: 4px 8px;
    font-family: Consolas, monospace;
    font-size: 14px;
    background: #222;
    color: #fff;
    border: 1px solid #555;
    border-radius: 4px;
}
.text-input:focus {
    outline: none;
    border-color: #1976d2;
}

.num-input {
    width: 60px;
    padding: 3px 6px;
    font-family: Consolas, monospace;
    font-size: 14px;
    background: #222;
    color: #fff;
    border: 1px solid #555;
    border-radius: 4px;
}
.num-input:focus {
    outline: none;
    border-color: #1976d2;
}

.unit {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
}

.small-btn {
    padding: 3px 10px;
    font-family: Consolas, monospace;
    font-size: 14px;
    border: 1px solid #555;
    border-radius: 4px;
    background: #444;
    color: #fff;
    cursor: pointer;
    white-space: nowrap;
}
.small-btn:hover:not(:disabled) {
    background: #555;
}
.small-btn:disabled {
    opacity: 0.4;
    cursor: default;
}
.small-btn.danger {
    background: transparent;
    border: none;
    color: #ff6666;
    font-size: 18px;
    padding: 0 4px;
}
.small-btn.danger:hover {
    color: #ff3333;
    background: transparent;
}
.small-btn.accent {
    background: #1976d2;
    border-color: #1976d2;
}
.small-btn.accent:hover {
    background: #1565c0;
}

.play-btn {
    background: #388e3c;
    border-color: #388e3c;
}
.play-btn:hover:not(:disabled) {
    background: #2e7d32;
}

.sequence-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 8px;
}

.sequence-step {
    padding: 8px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.step-row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.step-row label {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.6);
    width: 65px;
    flex-shrink: 0;
}

.step-row select {
    flex: 1;
    padding: 3px 6px;
    font-family: Consolas, monospace;
    font-size: 14px;
    background: #222;
    color: #fff;
    border: 1px solid #555;
    border-radius: 4px;
}

.sequence-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
}

.empty-text {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.3);
    font-style: italic;
    padding: 4px 0;
}
</style>
