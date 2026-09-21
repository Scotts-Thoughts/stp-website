<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';

defineProps<{
    tierlistName: string;
}>();

const emit = defineEmits<{
    save: [];
    discard: [];
    cancel: [];
}>();

// Escape backs out without closing the tierlist, so a stray Alt+W can't lose work.
function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        e.preventDefault();
        emit('cancel');
    }
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
    <div class="modal-overlay unsaved-changes-overlay" @click.self="emit('cancel')">
        <div class="modal unsaved-changes-modal">
            <h2>Unsaved changes</h2>
            <p class="modal-intro">
                There are unsaved changes, what would you like to do?
            </p>
            <div class="tierlist-name">{{ tierlistName }}</div>
            <div class="modal-actions">
                <button class="discard-btn" @click="emit('discard')">Close (Don't Save)</button>
                <button class="save-btn" @click="emit('save')">Save</button>
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

.unsaved-changes-modal {
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 10px;
    padding: 24px;
    min-width: 360px;
    max-width: 480px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.unsaved-changes-modal h2 {
    color: white;
    margin: 0 0 12px 0;
    font-size: 1.25rem;
}

.modal-intro {
    color: #ccc;
    margin: 0 0 14px 0;
    font-size: 0.95rem;
}

.tierlist-name {
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 10px 12px;
    margin: 0 0 14px 0;
    color: #e0e0e0;
    font-weight: 600;
    font-size: 0.95rem;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 4px;
}

.modal-actions .discard-btn,
.modal-actions .save-btn {
    flex: 1 1 0;
    min-width: 0;
}

.discard-btn {
    padding: 8px 16px;
    background: #444;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
}

.discard-btn:hover {
    background: #6a3a3a;
}

.save-btn {
    padding: 8px 16px;
    background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
}

.save-btn:hover {
    filter: brightness(1.1);
}
</style>
