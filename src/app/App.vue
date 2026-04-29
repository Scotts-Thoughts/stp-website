<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

import { useContextMenu, useFileExporter, useWorkspace } from '../store';

import ViewingTierlist from './ViewingTierlist.vue'
import ChooseWorkspace from './ChooseWorkspace.vue'
import ChooseTierlist from './ChooseTierlist.vue'
import ContextMenu from '../components/ContextMenu.vue'
import ToastContainer from '../components/ToastContainer.vue'
import ExternalChangesModal from '../components/ExternalChangesModal.vue'


const enum Mode {
    LOADING,
    CHOOSE_WORKSPACE,
    CHOOSE_TIERLIST,
    VIEWING_TIERLIST,
}

const workspace = useWorkspace();
const fileexporter = useFileExporter();

// Start in loading mode so we can auto-load workspace (Electron or browser cache)
const mode = ref<Mode>(Mode.LOADING);

// External-change popup: filenames that the main process reported as modified
// outside this app while the window was unfocused.
const externalChangedFiles = ref<string[]>([]);
let unsubscribeExternalChange: (() => void) | null = null;

function mergeChangedFiles(filenames: string[]) {
    if (filenames.length === 0) return;
    // Only surface tierlist files — settings.json / pokemon.json aren't relevant
    // to the scheduler-sync workflow and would just confuse the user.
    const tierlistNames = new Set(workspace.tierlists.map(t => t.filename));
    const relevant = filenames.filter(f => tierlistNames.has(f));
    if (relevant.length === 0) return;
    const merged = new Set([...externalChangedFiles.value, ...relevant]);
    externalChangedFiles.value = Array.from(merged);
}

function dismissExternalChanges() {
    externalChangedFiles.value = [];
}

onMounted(() => {
    console.log('[watch] electronWatch available:', !!window.electronWatch);
    if (window.electronWatch) {
        unsubscribeExternalChange = window.electronWatch.onExternalChange((filenames) => {
            console.log('[watch] received externalChange in renderer:', filenames);
            mergeChangedFiles(filenames);
        });
    }
});

onBeforeUnmount(() => {
    if (unsubscribeExternalChange) {
        unsubscribeExternalChange();
        unsubscribeExternalChange = null;
    }
});

// Auto-load workspace on launch: Electron uses userData path; browser uses cached handle if available
onMounted(async () => {
    try {
        if (workspace.runningInElectron) {
            const result = await workspace.loadWorkspace();
            if (result.success) {
                mode.value = Mode.CHOOSE_TIERLIST;
                workspace.setActiveTierlist(-1);
            } else {
                console.error('Failed to load workspace:', result.message);
                mode.value = Mode.CHOOSE_WORKSPACE;
            }
        } else {
            // Browser: try loading from cached folder handle so user doesn't have to click "Load from Cache"
            const cached = await workspace.checkHandleCached();
            if (cached) {
                const result = await workspace.loadWorkspace();
                if (result.success) {
                    mode.value = Mode.CHOOSE_TIERLIST;
                    workspace.setActiveTierlist(-1);
                    return;
                }
            }
            mode.value = Mode.CHOOSE_WORKSPACE;
        }
    } catch (e) {
        console.error('Failed to load workspace:', e);
        mode.value = Mode.CHOOSE_WORKSPACE;
    }
});

function onWorkspaceLoaded() {
    mode.value = Mode.CHOOSE_TIERLIST;
    workspace.setActiveTierlist(-1);
}

function onTierlistSelected(index: number) {
    const tierlist = workspace.tierlists[index];
    if (tierlist?.name === 'Default Tierlist') {
        const name = window.prompt('Assign a name to this tierlist:', 'Default Tierlist');
        if (name == null) return; // user cancelled
        const trimmed = name.trim();
        if (!trimmed) return; // empty name, stay on selection
        tierlist.name = trimmed;
        workspace.saveWorkspace();
    }
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
                <!-- Loading state while workspace is auto-loading -->
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
        <ExternalChangesModal
            v-if="externalChangedFiles.length > 0"
            :filenames="externalChangedFiles"
            @close="dismissExternalChanges"
        />
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
