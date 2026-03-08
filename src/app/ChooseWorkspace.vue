<script setup lang="ts">
import { ref } from 'vue';
import { useWorkspace, useToast } from '../store';

const emit = defineEmits<{
    loaded: [],
    error: [message: string, error: any],
}>();

const workspace = useWorkspace();
const toast = useToast();
const cached = ref(await workspace.checkHandleCached());
const loading = ref(false);

async function load() {
    if (loading.value) return;
    loading.value = true;
    try {
        const result = await workspace.loadWorkspace();
        if (result.success) {
            emit('loaded');
        } else {
            const msg = typeof result.message === 'string' ? result.message : 'Failed to load workspace';
            toast.addToast(msg, 'error');
            alert(msg);
            emit('error', msg, result.message);
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.addToast(msg, 'error');
        alert(msg);
        emit('error', 'Failed to load workspace', e);
    } finally {
        loading.value = false;
    }
}

async function clear() {
    await workspace.removeCachedHandle();
    cached.value = false;
}

</script>


<template>
    <div class="choose-workspace">
        <h1>Choose a Workspace</h1>
        <div style="height: 10px;"></div>
        <button class="big" @click="load" :disabled="loading">
            <template v-if="loading">Loading…</template>
            <template v-else-if="cached">
                Load Workspace from Cache
            </template>
            <template v-else>
                Load Workspace
            </template>
        </button>
        <button v-if=cached class="big" @click="clear">
            Clear Cache
        </button>
    </div>
</template>


<style scoped>
.choose-workspace {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 10px; 
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #222;
    border-radius: 10px;
    padding: 20px;
}

button {
    width: 400px;
}
</style>
