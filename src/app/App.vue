<script setup lang="ts">
import { ref, onMounted } from 'vue';

import { useContextMenu, useFileExporter, useWorkspace } from '../store';

import ViewingTierlist from './ViewingTierlist.vue'
import ChooseWorkspace from './ChooseWorkspace.vue'
import ChooseTierlist from './ChooseTierlist.vue'
import ContextMenu from '../components/ContextMenu.vue'
import ToastContainer from '../components/ToastContainer.vue'


const enum Mode {
    LOADING,
    CHOOSE_WORKSPACE,
    CHOOSE_TIERLIST,
    VIEWING_TIERLIST,
}

const workspace = useWorkspace();
const fileexporter = useFileExporter();

// Start in loading mode if Electron, otherwise in choose workspace mode
const mode = ref<Mode>(workspace.runningInElectron ? Mode.LOADING : Mode.CHOOSE_WORKSPACE);

// Auto-load workspace when running in Electron
onMounted(async () => {
    if (workspace.runningInElectron) {
        try {
            const result = await workspace.loadWorkspace();
            if (result.success) {
                mode.value = Mode.CHOOSE_TIERLIST;
                workspace.setActiveTierlist(-1);
            } else {
                console.error('Failed to load workspace:', result.message);
                // Show error state - for now just log
            }
        } catch (e) {
            console.error('Failed to load workspace:', e);
        }
    }
});

function onWorkspaceLoaded() {
    mode.value = Mode.CHOOSE_TIERLIST;
    workspace.setActiveTierlist(-1);
}

function onTierlistSelected(index: number) {
    mode.value = Mode.VIEWING_TIERLIST;
    workspace.setActiveTierlist(index);
    fileexporter.unloadFolder();
}

function onBackToTierlistSelection() {
    mode.value = Mode.CHOOSE_TIERLIST;
    workspace.setActiveTierlist(-1);
}

function handler(e: MouseEvent) {
    const contextMenu = useContextMenu();
    contextMenu.show(e.clientX, e.clientY);
    if (contextMenu.isVisible) {
        e.preventDefault();
    }
}
</script>


<template>
    <Suspense>
        <template #default>
            <div class="app" @contextmenu="handler">
                <!-- Loading state for Electron -->
                <div v-if="mode == Mode.LOADING" class="loading-screen">
                    <div class="loading-content">
                        <div class="loading-spinner"></div>
                        <div class="loading-text">Loading Tierlists...</div>
                    </div>
                </div>
                
                <!-- Browser workspace selection -->
                <ChooseWorkspace v-if="mode == Mode.CHOOSE_WORKSPACE" @loaded="onWorkspaceLoaded" @error="(msg, err) => console.error(msg, err)"/>
                
                <!-- Tierlist selection -->
                <ChooseTierlist v-if="mode == Mode.CHOOSE_TIERLIST" @select="onTierlistSelected" />
                
                <!-- Viewing a tierlist -->
                <ViewingTierlist v-if="mode == Mode.VIEWING_TIERLIST" @close="onBackToTierlistSelection"/>
            </div>
        </template>
        <template #fallback>
            <div class="app loading">
                <div class="loading-spinner"></div>
            </div>
        </template>
    </Suspense>
    <Teleport to="body">
        <KeepAlive>
            <ContextMenu />
        </KeepAlive>
        <KeepAlive>
            <ToastContainer />
        </KeepAlive>
    </Teleport>
</template>


<style scoped>
.app {
    width: 100%;
    height: 100%;
}

.app.loading {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1a1a1a;
}

.loading-screen {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
}

.loading-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
}

.loading-spinner {
    width: 48px;
    height: 48px;
    border: 4px solid rgba(255, 255, 255, 0.1);
    border-left-color: #ffcb05;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

.loading-text {
    color: white;
    font-size: 1.5rem;
    font-family: 'Teko', sans-serif;
    letter-spacing: 2px;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
