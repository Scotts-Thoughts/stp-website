<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspace } from '../store';

const props = defineProps<{
    filenames: string[];
}>();

const emit = defineEmits<{
    close: [];
}>();

const workspace = useWorkspace();

type ChangeRow = {
    filename: string;
    displayName: string;
    unsaved: { added: number; removed: number; modified: number } | null;
};

const rows = computed<ChangeRow[]>(() => {
    return props.filenames.map(filename => {
        const tierlist = workspace.tierlists.find(t => t.filename === filename);
        const displayName = tierlist?.name ?? filename;
        const unsaved = workspace.summarizeUnsavedChanges(filename);
        return { filename, displayName, unsaved };
    });
});

const anyUnsaved = computed(() => rows.value.some(r => r.unsaved !== null));

function summaryText(diff: { added: number; removed: number; modified: number }): string {
    const parts: string[] = [];
    if (diff.added > 0) parts.push(`+${diff.added} ${diff.added === 1 ? 'entry' : 'entries'}`);
    if (diff.removed > 0) parts.push(`-${diff.removed} ${diff.removed === 1 ? 'entry' : 'entries'}`);
    if (diff.modified > 0) parts.push(`~${diff.modified} modified`);
    return parts.length > 0 ? parts.join(', ') : 'edited';
}

async function reload() {
    if (anyUnsaved.value) {
        const ok = window.confirm(
            'Reloading will discard your unsaved changes in the affected tierlists. Continue?'
        );
        if (!ok) return;
    }
    const result = await workspace.reloadFiles(props.filenames);
    if (!result.success) {
        window.alert(`Reload failed: ${result.message}`);
        return;
    }
    emit('close');
}

async function keepCurrent() {
    // Acknowledge the external changes so the popup doesn't reappear on next focus.
    // The user's next save will overwrite the external edits — that's their choice.
    for (const filename of props.filenames) {
        await workspace.acknowledgeExternalChange(filename);
    }
    emit('close');
}
</script>

<template>
    <div class="modal-overlay external-changes-overlay" @click.self="keepCurrent">
        <div class="modal external-changes-modal">
            <h2>Tierlist data changed externally</h2>
            <p class="modal-intro">
                {{ filenames.length === 1 ? 'A tierlist file was' : 'Tierlist files were' }}
                modified outside this app (likely by the scheduler):
            </p>
            <ul class="changes-list">
                <li v-for="row in rows" :key="row.filename" class="change-row">
                    <div class="change-name">{{ row.displayName }}</div>
                    <div v-if="row.unsaved" class="change-warning">
                        Unsaved local edits will be lost: {{ summaryText(row.unsaved) }}
                    </div>
                </li>
            </ul>
            <p v-if="anyUnsaved" class="warning-banner">
                You have unsaved local changes in some of these tierlists.
                Reloading will discard them.
            </p>
            <div class="modal-actions">
                <button class="cancel-btn" @click="keepCurrent">Keep current</button>
                <button class="reload-btn" @click="reload">Reload from disk</button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
}

.external-changes-modal {
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 10px;
    padding: 24px;
    min-width: 360px;
    max-width: 560px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.external-changes-modal h2 {
    color: white;
    margin: 0 0 12px 0;
    font-size: 1.25rem;
}

.modal-intro {
    color: #ccc;
    margin: 0 0 14px 0;
    font-size: 0.95rem;
}

.changes-list {
    list-style: none;
    padding: 0;
    margin: 0 0 14px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.change-row {
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 10px 12px;
}

.change-name {
    color: #e0e0e0;
    font-weight: 600;
    font-size: 0.95rem;
}

.change-warning {
    color: #f0c674;
    font-size: 0.85rem;
    margin-top: 4px;
}

.warning-banner {
    color: #f0c674;
    background: rgba(240, 198, 116, 0.1);
    border: 1px solid rgba(240, 198, 116, 0.3);
    border-radius: 6px;
    padding: 10px 12px;
    margin: 0 0 14px 0;
    font-size: 0.9rem;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 4px;
}

.modal-actions .cancel-btn,
.modal-actions .reload-btn {
    flex: 1 1 0;
    min-width: 0;
}

.cancel-btn {
    padding: 8px 16px;
    background: #444;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
}

.cancel-btn:hover {
    background: #555;
}

.reload-btn {
    padding: 8px 16px;
    background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
}

.reload-btn:hover {
    filter: brightness(1.1);
}
</style>
