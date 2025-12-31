<script setup lang="ts">
import { ref } from 'vue';
import { useWorkspace } from '../store';

const emit = defineEmits<{
    loaded: [],
    error: [message: string, error: any],
}>();

const workspace = useWorkspace();
const cached = ref(await workspace.checkHandleCached());

async function load() {
    try {
        const result = await workspace.loadWorkspace();
        if (result.success) {
            emit('loaded');
        } else {
            emit('error', 'Failed to load workspace', result.message);
        }
    } catch (e) {
        emit('error', 'Failed to load workspace', e);
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
        <button class="big" @click="load">
            <template v-if=cached>
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
