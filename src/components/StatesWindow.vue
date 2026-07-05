<script setup lang="ts">
import { computed } from 'vue';

import { useTierlist, useToast } from '../store';

defineProps<{
    visible: boolean
}>();

const emit = defineEmits<{
    close: []
    // Ask the parent to capture the current view (it handles episode naming + saving).
    capture: []
}>();

const tierlist = useTierlist();
const toast = useToast();

const CATEGORY_LABEL: Record<string, string> = {
    first: 'First',
    best: 'Followup',
    recent: 'Most Recent',
};

const states = computed(() => tierlist.states);

function categoryLabel(cat: string): string {
    return CATEGORY_LABEL[cat] ?? cat;
}

function formatCreated(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
    });
}

async function recall(id: string) {
    const ok = await tierlist.recallState(id);
    if (ok) {
        emit('close');
    } else {
        toast.addToast('Could not recall that state', 'error', { timeout: 2000 });
    }
}

function rename(id: string, currentName: string) {
    const name = prompt('Rename state:', currentName);
    if (name && name.trim()) {
        tierlist.renameState(id, name);
    }
}

function remove(id: string, name: string) {
    if (confirm(`Delete state "${name}"? This can't be undone.`)) {
        tierlist.deleteState(id);
        toast.addToast('State deleted', 'info', { timeout: 1500 });
    }
}

function returnToLive() {
    tierlist.returnToLive();
    toast.addToast('Back to live view', 'info', { timeout: 1500 });
}
</script>

<template>
    <div v-if="visible" class="states-overlay" @click.self="$emit('close')">
        <div class="states-window">
            <div class="states-header">
                <span>States</span>
                <button class="close-button" @click="$emit('close')" title="Close">×</button>
            </div>

            <div class="states-toolbar">
                <button class="capture-button" @click="$emit('capture')">
                    ＋ Capture current state
                </button>
                <button
                    v-if="tierlist.activeStateId"
                    class="live-button"
                    @click="returnToLive"
                    title="Stop viewing the saved state and return to the live tierlist"
                >
                    ⤺ Return to live
                </button>
            </div>

            <div class="states-body">
                <div v-if="states.length === 0" class="states-empty">
                    No saved states yet.<br />
                    Capture one to snapshot the current graphic — its view, thresholds,
                    date, filters and the exact species being displayed.
                </div>

                <div
                    v-for="state in states"
                    :key="state.id"
                    class="state-card"
                    :class="{ active: state.id === tierlist.activeStateId }"
                    @dblclick="recall(state.id)"
                >
                    <div class="state-main">
                        <div class="state-name" :title="state.name">{{ state.name }}</div>
                        <div class="state-meta">
                            <span class="tag">{{ categoryLabel(state.category) }}</span>
                            <span class="tag">{{ state.date }}</span>
                            <span class="tag">{{ state.species.length }} shown</span>
                            <span v-if="state.thresholdLabel" class="tag">⌁ {{ state.thresholdLabel }}</span>
                        </div>
                        <div class="state-sub">{{ formatCreated(state.createdAt) }}</div>
                    </div>
                    <div class="state-actions">
                        <button class="recall-button" @click="recall(state.id)">Recall</button>
                        <button class="ghost-button" @click="rename(state.id, state.name)" title="Rename">✎</button>
                        <button class="ghost-button danger" @click="remove(state.id, state.name)" title="Delete">🗑</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.states-overlay {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
}

.states-window {
    background-color: #2a2a2a;
    border: 1px solid #444;
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    width: 560px;
    max-width: 92vw;
    max-height: 82vh;
    display: flex;
    flex-direction: column;
    animation: popup-enter 0.2s ease-out;
}

@keyframes popup-enter {
    from { opacity: 0; transform: scale(0.9) translateY(-10px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
}

.states-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #444;
    background-color: #333;
    border-radius: 8px 8px 0 0;
}
.states-header span { font-weight: bold; color: #fff; }

.close-button {
    background: none;
    border: none;
    color: #ccc;
    font-size: 20px;
    cursor: pointer;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background-color 0.2s;
}
.close-button:hover { background-color: #444; color: #fff; }

.states-toolbar {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid #3a3a3a;
}

.capture-button {
    background-color: #007acc;
    border: none;
    color: #fff;
    padding: 8px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: background-color 0.2s;
}
.capture-button:hover { background-color: #0a8ae0; }

.live-button {
    background-color: #333;
    border: 1px solid #555;
    color: #ddd;
    padding: 8px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
}
.live-button:hover { background-color: #444; color: #fff; }

.states-body {
    padding: 12px 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.states-empty {
    color: #999;
    font-size: 14px;
    line-height: 1.5;
    text-align: center;
    padding: 24px 8px;
}

.state-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background-color: #1f1f1f;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    padding: 10px 12px;
    transition: border-color 0.15s, background-color 0.15s;
}
.state-card:hover { background-color: #262626; border-color: #4a4a4a; }
.state-card.active { border-color: #007acc; background-color: #16324a; }

.state-main { min-width: 0; flex: 1; }
.state-name {
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.state-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 5px;
}
.tag {
    font-size: 11px;
    color: #bbb;
    background-color: #2f2f2f;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 1px 6px;
}
.state-sub { color: #777; font-size: 11px; margin-top: 5px; }

.state-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}

.recall-button {
    background-color: #2f6b3f;
    border: none;
    color: #fff;
    padding: 6px 12px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 13px;
    transition: background-color 0.2s;
}
.recall-button:hover { background-color: #3a8a50; }

.ghost-button {
    background-color: #333;
    border: 1px solid #444;
    color: #ccc;
    width: 30px;
    height: 30px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}
.ghost-button:hover { background-color: #444; color: #fff; }
.ghost-button.danger:hover { background-color: #6b2f2f; border-color: #8a3a3a; color: #fff; }
</style>
