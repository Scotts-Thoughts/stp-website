<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import Window from '../components/Window.vue';
import { eventToShortcut, SHORTCUT_ACTIONS, useShortcuts, type ShortcutAction } from '../store/shortcuts';

const props = defineProps<{
    visible: boolean
}>();

defineEmits<{
    close: []
}>();

const WIDTH = 620;
const HEIGHT = 760;

const shortcuts = useShortcuts();

const filter = ref('');
const recordingId = ref<string | null>(null);
const notice = ref('');

const customPosition = computed(() => ({
    x: Math.max(10, (window.innerWidth - WIDTH) / 2),
    y: Math.max(10, (window.innerHeight - HEIGHT) / 2),
}));

const groups = computed(() => {
    const needle = filter.value.trim().toLowerCase();
    const result = new Map<string, ShortcutAction[]>();
    for (const action of SHORTCUT_ACTIONS) {
        const text = `${action.label} ${action.group} ${shortcuts.bindingOf(action.id)}`.toLowerCase();
        if (needle && !text.includes(needle)) continue;
        if (!result.has(action.group)) result.set(action.group, []);
        result.get(action.group)!.push(action);
    }
    return result;
});

const hasChanges = computed(() => Object.keys(shortcuts.overrides).length > 0);

function reportTaken(key: string, taken: ShortcutAction[]) {
    notice.value = taken.length
        ? `${key} was taken from ${taken.map(a => a.label).join(', ')}, which now has no shortcut.`
        : '';
}

function onRecordKey(e: KeyboardEvent) {
    // Nothing else may see this key: it's being assigned, not used.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
        stopRecording();
        return;
    }
    const key = eventToShortcut(e);
    if (!key) return; // modifiers on their own: keep waiting for the rest of the combination
    const id = recordingId.value!;
    stopRecording();
    reportTaken(key, shortcuts.assign(id, key));
}

function stopRecording() {
    recordingId.value = null;
    shortcuts.recording = false;
    window.removeEventListener('keydown', onRecordKey, true);
}

function startRecording(id: string) {
    stopRecording();
    notice.value = '';
    recordingId.value = id;
    shortcuts.recording = true;
    window.addEventListener('keydown', onRecordKey, true);
}

function isChanged(action: ShortcutAction) {
    return shortcuts.bindingOf(action.id) !== action.default;
}

function restore(action: ShortcutAction) {
    reportTaken(action.default, shortcuts.restoreDefault(action.id));
}

function restoreAll() {
    if (!confirm('Put every keyboard shortcut back to its default?')) return;
    stopRecording();
    notice.value = '';
    shortcuts.restoreAllDefaults();
}

watch(() => props.visible, (visible) => {
    if (!visible) stopRecording();
});
onUnmounted(stopRecording);
</script>


<template>
    <Window title="Keyboard Shortcuts" :visible="visible" :width="WIDTH" :height="HEIGHT" :custom-position="customPosition" @close="$emit('close')">
        <div class="toolbar">
            <input v-model="filter" class="filter" type="text" placeholder="filter..." />
            <button :disabled="!hasChanges" @click="restoreAll">Reset All</button>
        </div>
        <div class="hint">{{ recordingId ? 'Press the new shortcut. Esc cancels.' : notice || 'Click a shortcut, then press the keys to assign.' }}</div>

        <section v-for="[group, actions] in groups" :key="group">
            <h3>{{ group }}</h3>
            <div v-for="action in actions" :key="action.id" class="row" :data-action="action.id">
                <span class="label">{{ action.label }}</span>
                <button class="key" :class="{ recording: recordingId === action.id, none: !shortcuts.bindingOf(action.id) }"
                    @click="startRecording(action.id)">
                    {{ recordingId === action.id ? '...' : shortcuts.bindingOf(action.id) || 'none' }}
                </button>
                <button class="small" :disabled="!shortcuts.bindingOf(action.id)" title="Remove this shortcut" @click="shortcuts.clear(action.id)">Clear</button>
                <button class="small" :disabled="!isChanged(action)" title="Back to the default" @click="restore(action)">Default</button>
            </div>
        </section>
    </Window>
</template>


<style scoped>
.toolbar {
    display: flex;
    gap: 8px;
    position: sticky;
    top: -10px;
    padding-block: 4px;
    background-color: #333;
}
.filter {
    flex: 1;
    min-width: 0;
    font: inherit;
}
.hint {
    min-height: 2.6em;
    padding-block: 4px;
    font-size: 0.8em;
    color: #bbb;
}
h3 {
    margin: 14px 0 4px;
    font-size: 0.85em;
    color: #ffcb05;
}
.row {
    display: grid;
    grid-template-columns: 1fr 130px auto auto;
    gap: 6px;
    align-items: center;
    padding-block: 2px;
    font-size: 0.85em;
}
.row:hover {
    background-color: #fff1;
}
.label {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
button {
    cursor: pointer;
}
button:disabled {
    cursor: default;
    opacity: 0.4;
}
.key {
    font: inherit;
    padding-block: 2px;
}
.key.none {
    opacity: 0.55;
}
.key.recording {
    outline: 2px solid #ffcb05;
}
.small {
    font-size: 0.8em;
    padding: 1px 6px;
}
</style>
