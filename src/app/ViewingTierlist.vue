<script setup lang="ts">
import { ref, watch, useTemplateRef, onMounted, onUnmounted, nextTick, type ComponentPublicInstance } from 'vue'
import { onKeyDown } from '@vueuse/core';

import { useContextMenu, useFileExporter, useGlobal, useTierlist, useToast, useWorkspace, useReranking, type PendingInsertion, type ContextMenuOptionArg } from '../store';
import { currentDate } from '../utils/time';
import { recordRerankingAnimation, recordChangeAnimation } from '../utils/video-recorder';

import EditViewWindow from './EditViewWindow.vue'
import EditMetricsWindow from './EditMetricsWindow.vue'
import InsertMetricsWindow from './InsertMetricsWindow.vue'
import InsertCsvMetricsWindow from './InsertCsvMetricsWindow.vue'
import EditFilterWindow from './EditFilterWindow.vue'
import EditThresholdsWindow from './EditThresholdsWindow.vue'
import SearchWindow from './SearchWindow.vue'
import TierListTableWindow from './TierListTableWindow.vue'
import Tierlist from '../components/TierList.vue'
import TimelineView from '../components/TimelineView.vue'
import QuickCalendarPopup from '../components/QuickCalendarPopup.vue'
import ExportChangeAnimationModal from '../components/ExportChangeAnimationModal.vue'

const emit = defineEmits<{
    close: [],
}>();

const global = useGlobal();
const tierlist = useTierlist();
const workspace = useWorkspace();
const contextMenu = useContextMenu();
const fileexporter = useFileExporter();
const toast = useToast();
const reranking = useReranking();

const root = useTemplateRef("root");

// Drag-and-drop CSV import
const isDraggingOver = ref(false);
const droppedFile = ref<File | null>(null);
const cachedCsvDate = ref<string>("");
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null;

function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null; }
    if (e.dataTransfer?.types.includes('Files')) {
        isDraggingOver.value = true;
    }
}

function onDragLeave(e: DragEvent) {
    e.preventDefault();
    // Short timer to avoid flickering when dragging between child elements
    dragLeaveTimer = setTimeout(() => { isDraggingOver.value = false; }, 50);
}

function onDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingOver.value = false;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.csv')) {
        toast.addToast('Only .csv files are supported', 'error');
        return;
    }

    // Open the CSV import window with the dropped file
    droppedFile.value = file;
    mode.value = Mode.INSERT_CSV_METRIC;
}

function onCsvWindowClose() {
    mode.value = Mode.VIEWING;
    droppedFile.value = null;
}

function onCsvImported(date: string) {
    // Cache the date from drag-and-drop imports for reuse in the same session
    if (droppedFile.value) {
        cachedCsvDate.value = date;
    }
}

// Calculate viewport scale for the tierlist wrapper
function updateViewportScale() {
    const scaleX = window.innerWidth / 1920;
    const scaleY = window.innerHeight / 1080;
    const scale = Math.min(scaleX, scaleY);
    document.documentElement.style.setProperty('--viewport-scale', String(scale));
}

// Update scale on mount and resize
onMounted(() => {
    updateViewportScale();
    window.addEventListener('resize', updateViewportScale);

    // Show which display category is active on open
    const categoryToast: Record<string, [string, "info" | "error" | "warning"]> = {
        first: ["Viewing First Attempts", "error"],
        best: ["Viewing Followup Attempts", "info"],
        recent: ["Viewing Most Recent Attempts", "warning"],
    };
    const [msg, type] = categoryToast[tierlist.activeCategory] ?? categoryToast.first;
    toast.addToast(msg, type, { timeout: 2000, key: 'view-category' });
});
onUnmounted(() => {
    window.removeEventListener('resize', updateViewportScale);
});

const enum Mode {
    VIEWING,
    INSERT_METRIC,
    INSERT_CSV_METRIC,
    EDIT_METRIC,
    EDIT_VIEW,
    EDIT_FILTER,
    EDIT_THRESHOLDS,
}

const mode = ref<Mode>(Mode.VIEWING);
const searchActive = ref(false);
const prevPopoutState = ref(false);
const tierlistTableActive = ref(false);
const quickCalendarActive = ref(false);
const changeAnimActive = ref(false);
const timelineActive = ref(false);
const timelineRef = ref<ComponentPublicInstance | null>(null);

watch([mode], () => {
    // Keep shortcuts active for toggle functionality
    contextMenu.shortcutsActive = true;
});

// Watch timeline active state to swap context menus
watch(timelineActive, (active) => {
    if (active) {
        // TimelineView sets its own menu on mount via setupContextMenu
    } else {
        // Restore main tierlist context menu
        setupMainContextMenu();
    }
});

function setupMainContextMenu() {
    contextMenu.setOptions(mainContextMenuOptions);
}

const mainContextMenuOptions: ContextMenuOptionArg[] = [
    // {
    //     label: () => global.hidden ? "Show Pokemon" : "Hide Pokemon",
    //     shortcut: 'R',
    //     action() {
    //         if (mode.value === Mode.EDIT_FILTER) return false
    //         global.hidden = !global.hidden;
    //     },
    // },
    {
        label: "Import CSV",
        shortcut: "V",
        action() {
            mode.value = mode.value === Mode.INSERT_CSV_METRIC ? Mode.VIEWING : Mode.INSERT_CSV_METRIC;
        }
    },
    {
        label: "Insert Metrics",
        shortcut: "X",
        // hidden: global.obsPresent,
        action() {
            mode.value = mode.value === Mode.INSERT_METRIC ? Mode.VIEWING : Mode.INSERT_METRIC;
        }
    },
    {
        label: "Edit Metrics",
        shortcut: "Z",
        // hidden: global.obsPresent,
        action() {
            mode.value = mode.value === Mode.EDIT_METRIC ? Mode.VIEWING : Mode.EDIT_METRIC;
        }
    },
    {
        label: "Edit View",
        shortcut: "C",
        // hidden: global.obsPresent,
        action() {
            mode.value = mode.value === Mode.EDIT_VIEW ? Mode.VIEWING : Mode.EDIT_VIEW;
        }
    },
    {
        label: "Edit Filter",
        shortcut: "F",
        action() {
            mode.value = mode.value === Mode.EDIT_FILTER ? Mode.VIEWING : Mode.EDIT_FILTER;
        }
    },
    {
        label: "Thresholds",
        shortcut: "G",
        action() {
            mode.value = mode.value === Mode.EDIT_THRESHOLDS ? Mode.VIEWING : Mode.EDIT_THRESHOLDS;
        }
    },
    {
        label: () => timelineActive.value ? "Hide Timeline" : "Show Timeline",
        shortcut: 'N',
        action() {
            timelineActive.value = !timelineActive.value;
            if (timelineActive.value) {
                toast.addToast('Timeline View', 'info', { timeout: 2000 });
            }
        },
    },
    {
        label: "Toggle Category",
        shortcut: 'D',
        action() {
            if (tierlist.activeCategory === "first") {
                tierlist.activeCategory = "best";
                toast.addToast("Switched to Followup Attempts", "info", { timeout: 2000, key: 'view-category' })
            } else if (tierlist.activeCategory === "best") {
                tierlist.activeCategory = "recent";
                toast.addToast("Switched to Most Recent Attempts", "warning", { timeout: 2000, key: 'view-category' })
            } else {
                tierlist.activeCategory = "first";
                toast.addToast("Switched to First Attempts", "error", { timeout: 2000, key: 'view-category' })
            }
        },
    },
    {
        label: () => tierlistTableActive.value ? "Hide Table" : "Show Table",
        shortcut: 'T',
        action() {
            tierlistTableActive.value = !tierlistTableActive.value;
            if (tierlistTableActive.value) {
                prevPopoutState.value = global.popoutActive;
                global.popoutActive = false;
            } else {
                global.popoutActive = prevPopoutState.value;
            }
        },
    },
    {
        label: () => global.popoutActive ? "Hide Popout" : "Show Popout",
        shortcut: 'R',
        action() {
            global.popoutActive = !global.popoutActive;
        },
    },
    {
        label: () => global.showBoxArt ? "Hide Box Art" : "Show Box Art",
        action() {
            global.showBoxArt = !global.showBoxArt;
        },
    },
    {
        label: "Hide Selected",
        shortcut: "H",
        action() {
            for (const entry of tierlist.selectedPkmn) {
                tierlist.excludePokemonList.push(entry);
            }
            tierlist.selectedPkmn.clear();
        }
    },
    {
        label: () => global.animateReranking ? "Animate Re-Ranking: ON" : "Animate Re-Ranking: OFF",
        action() {
            global.animateReranking = !global.animateReranking;
            toast.addToast(
                global.animateReranking ? 'Animate Re-Ranking enabled (Ctrl+F1 to confirm)' : 'Animate Re-Ranking disabled',
                'info',
                { timeout: 2000 }
            );
            // Clear any pending insertions when disabling
            if (!global.animateReranking) {
                reranking.clearPending();
            }
        }
    },
    {
        label: 'Export Re-Ranking as Video',
        hidden: () => !global.animateReranking,
        action() {
            if (!window.electronVideo) {
                toast.addToast('Video export requires the desktop app', 'error');
                return;
            }
            if (!reranking.hasPending) {
                toast.addToast('No pending re-ranking to export', 'warning', { timeout: 2000 });
                return;
            }
            exportRerankingVideo();
        }
    },
    {
        label: "", // Separator
    },
    {
        label: 'Save Workspace',
        shortcut: 'Ctrl+S',
        // hidden: global.obsPresent,
        action() { workspace.saveWorkspace(); }
    },
    {
        label: 'Reload Workspace',
        shortcut: 'Ctrl+R',
        action() { workspace.loadWorkspace(); }
    },
    {
        label: 'Close Tierlist',
        shortcut: 'Alt+W',
        action() { 
            contextMenu.hide();
            emit('close'); 
        }
    },
    {
        label: "", // Separator
        // hidden: global.obsPresent
    },
    {
        label: 'Export as PNG',
        shortcut: 'Ctrl+E',
        action() {
            let startToastId = -1;
            // Export the wrapper element directly - it has fixed 1920x1080 dimensions
            fileexporter.exportElement(root.value!, 1, (message, state) => {
                switch (state) {
                    case 'start':
                        startToastId = toast.addToast(message, 'info', { timeout: -1, pending: true});
                        break;
                    case 'success':
                        toast.removeToast(startToastId);
                        toast.addToast(message, 'success');
                        break;
                    case 'error':
                        toast.removeToast(startToastId);
                        toast.addToast(message, 'error');
                        break;
                }
            });
        }
    },
    // {
    //     label: 'Export as PNG (old)',
    //     // hidden: global.obsPresent,
    //     action() {
    //         const filename = tierlist.activeTierlist.filename.replace('.json', '.png');
    //         exportElement(root.value!, filename);
    //     }
    {
        label: 'Export Change Animation',
        action() {
            if (!window.electronVideo) {
                toast.addToast('Video export requires the desktop app', 'error');
                return;
            }
            changeAnimActive.value = true;
        }
    },
    {
        label: 'Quick Date Filter',
        shortcut: 'Q',
        action() {
            quickCalendarActive.value = !quickCalendarActive.value;
        }
    },
    {
        label: 'Set to Current Date',
        shortcut: 'W',
        action() {
            const today = currentDate();
            tierlist.releaseDateTreshold = today;
            toast.addToast('Filter: Current Date', 'info');
        }
    },
    {
        label: 'Set to Max Date',
        shortcut: 'E',
        action() {
            const maxDate = '2099-01-01';
            tierlist.releaseDateTreshold = maxDate;
            toast.addToast('Filter: Max Date', 'info');
        }
    },
    {
        label: 'Cycle Credits',
        shortcut: 'Ctrl+Q',
        // hidden: global.obsPresent,
        action() { global.cycleCreditModes(); }
    },
];

contextMenu.setOptions(mainContextMenuOptions);

onKeyDown(' ', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    searchActive.value = !searchActive.value;
    e.preventDefault();
});

onKeyDown('Escape', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    mode.value = Mode.VIEWING;
    searchActive.value = false;
    tierlistTableActive.value = false;
    quickCalendarActive.value = false;
    timelineActive.value = false;
    e.preventDefault();
});

// Export re-ranking animation as transparent .mov video
async function exportRerankingVideo() {
    if (!reranking.hasPending || !root.value) return;

    const pending = [...reranking.pendingInsertions];
    const animPokemon = pending[pending.length - 1].pokemon;

    // Find old tier
    let oldTier = -1;
    for (let i = 0; i < tierlist.groupedEntries.length; i++) {
        if (tierlist.groupedEntries[i].some(e => e.pkmnName === animPokemon)) {
            oldTier = i;
            break;
        }
    }

    let recordingToastId = toast.addToast('Preparing video export...', 'info', { timeout: -1, pending: true });

    const success = await recordRerankingAnimation({
        wrapperEl: root.value,
        findOldEl() {
            if (oldTier < 0) return null;
            return root.value?.querySelector(`[data-pokemon="${CSS.escape(animPokemon)}"]`) as HTMLElement | null;
        },
        applyData() {
            reranking.committing = true;
            for (const ins of pending) {
                workspace.insertActiveTierlistEntry(ins.pokemon, ins.attempt);
            }
            reranking.committing = false;
            reranking.clearPending();
        },
        findNewEl() {
            return root.value?.querySelector(`[data-pokemon="${CSS.escape(animPokemon)}"]`) as HTMLElement | null;
        },
        onProgress(p) {
            toast.removeToast(recordingToastId);
            if (p.phase === 'capturing') {
                recordingToastId = toast.addToast(p.message, 'info', { timeout: -1, pending: true });
            } else if (p.phase === 'encoding') {
                recordingToastId = toast.addToast(p.message, 'info', { timeout: -1, pending: true });
            } else if (p.phase === 'done') {
                toast.addToast(p.message, 'success');
            } else if (p.phase === 'error') {
                toast.addToast(p.message, 'error');
            }
        },
    });

    if (!success) return;
}

// Export a "change animation" morphing the tierlist from date1's state to date2's state.
async function exportChangeAnimation(payload: { date1: string, date2: string }) {
    changeAnimActive.value = false;
    if (!window.electronVideo) {
        toast.addToast('Video export requires the desktop app', 'error');
        return;
    }
    if (!root.value) return;

    // Preserve the current view + selection so we can restore it after capture.
    const originalDate = tierlist.releaseDateTreshold;
    const prevPopout = global.popoutActive;
    const prevSelected = new Set(tierlist.selectedPkmn);
    global.popoutActive = false;
    tierlist.selectedPkmn.clear();

    let toastId = toast.addToast('Preparing change animation...', 'info', { timeout: -1, pending: true });

    try {
        await recordChangeAnimation({
            wrapperEl: root.value,
            date1: payload.date1,
            date2: payload.date2,
            async setDate(d) {
                tierlist.releaseDateTreshold = d;
                await nextTick();
                // Two extra frames so the reactive re-layout fully settles before measuring.
                await new Promise(r => requestAnimationFrame(() => r(null)));
                await new Promise(r => requestAnimationFrame(() => r(null)));
            },
            onProgress(p) {
                toast.removeToast(toastId);
                if (p.phase === 'capturing' || p.phase === 'encoding') {
                    toastId = toast.addToast(p.message, 'info', { timeout: -1, pending: true });
                } else if (p.phase === 'done') {
                    toast.addToast(p.message, 'success');
                } else if (p.phase === 'error') {
                    toast.addToast(p.message, 'error');
                }
            },
        });
    } finally {
        // Restore the original view + selection.
        tierlist.releaseDateTreshold = originalDate;
        global.popoutActive = prevPopout;
        tierlist.selectedPkmn.clear();
        for (const n of prevSelected) tierlist.selectedPkmn.add(n);
    }
}

// Last animation data for replay
let lastReplay: { insertions: PendingInsertion[]; pokemon: string } | null = null;

// Ctrl+F1: Start the re-ranking animation, or replay the last one
onKeyDown('F1', async (e) => {
    if (!e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!global.animateReranking) return;
    if (reranking.isAnimating) return;

    // If no pending insertions, try replaying the last animation
    if (!reranking.hasPending) {
        if (!lastReplay) {
            toast.addToast('No pending re-ranking to apply', 'warning', { timeout: 2000 });
            return;
        }

        // Undo: remove the last attempt(s) that were inserted
        for (const ins of lastReplay.insertions) {
            const entry = workspace.activeTierlist.entries[ins.pokemon];
            if (entry) {
                entry.attempts.pop();
                if (entry.attempts.length === 0) {
                    delete workspace.activeTierlist.entries[ins.pokemon];
                }
            }
        }

        // Wait for Vue to re-render so the Pokemon is back at its old position
        await nextTick();
        await nextTick();

        // Re-queue them as pending
        for (const ins of lastReplay.insertions) {
            reranking.addPendingInsertion(ins.pokemon, ins.attempt);
        }

        toast.addToast('Replaying last re-ranking...', 'info', { timeout: 1500 });
    }

    // Figure out which pokemon we're animating (last pending insertion)
    const pending = [...reranking.pendingInsertions];
    const lastInsertion = pending[pending.length - 1];
    const animPokemon = lastInsertion.pokemon;

    // Save for replay
    lastReplay = { insertions: pending, pokemon: animPokemon };

    // Find the old position (if the pokemon already exists in the tierlist)
    let oldTier = -1;
    for (let i = 0; i < tierlist.groupedEntries.length; i++) {
        if (tierlist.groupedEntries[i].some(e => e.pkmnName === animPokemon)) {
            oldTier = i;
            break;
        }
    }

    // Start the animation — data stays unchanged, the entry is still at its old position
    // The TierList component will apply the data between COLLAPSE_GAP and OPEN_SPACE
    reranking.startAnimation(animPokemon, oldTier, -1);
});


</script>


<template>
    <div
        class="wrapper"
        :class="{ 'exporting': fileexporter.exportInProgress, 'obs-mode': global.obsPresent }"
        ref="root"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
    >
        <TimelineView v-if="timelineActive" ref="timelineRef" @close="timelineActive = false" />
        <Tierlist v-else :context-menu-options="mainContextMenuOptions" @restore-context-menu="setupMainContextMenu" />
        <!-- Drop overlay -->
        <div v-if="isDraggingOver" class="drop-overlay">
            <div class="drop-overlay-content">
                <div class="drop-overlay-icon">CSV</div>
                <div class="drop-overlay-text">Drop CSV file to import results</div>
            </div>
        </div>
    </div>

    <Teleport to="#app">
        <TierListTableWindow :visible="tierlistTableActive"          @close="tierlistTableActive = false" />
        <InsertMetricsWindow :visible="mode === Mode.INSERT_METRIC"  @close="mode = Mode.VIEWING" />
        <InsertCsvMetricsWindow :visible="mode === Mode.INSERT_CSV_METRIC" :initialFile="droppedFile" :cachedDate="cachedCsvDate" @close="onCsvWindowClose" @imported="onCsvImported" />
        <EditMetricsWindow   :visible="mode === Mode.EDIT_METRIC"    @close="mode = Mode.VIEWING" />
        <EditViewWindow      :visible="mode === Mode.EDIT_VIEW"      @close="mode = Mode.VIEWING" />
        <EditFilterWindow    :visible="mode === Mode.EDIT_FILTER"    @close="mode = Mode.VIEWING" />
        <EditThresholdsWindow :visible="mode === Mode.EDIT_THRESHOLDS" @close="mode = Mode.VIEWING" />
        <SearchWindow        :visible="searchActive"                 @close="searchActive = false" />
        <QuickCalendarPopup  :visible="quickCalendarActive"          @close="quickCalendarActive = false" />
        <ExportChangeAnimationModal
            :visible="changeAnimActive"
            :date1="tierlist.releaseDateTreshold"
            @close="changeAnimActive = false"
            @export="exportChangeAnimation"
        />
    </Teleport>
</template>


<style scoped>
.wrapper {
    width: 1920px;
    height: 1080px;
    padding: 20px;
    display: inline-block;
    text-align: center;
    
    /* Scale from center for proper centering */
    transform-origin: center center;
}

/* Responsive scaling for viewing - center and scale to fit */
.wrapper:not(.exporting):not(.obs-mode) {
    position: fixed;
    top: 50%;
    left: 50%;
    /* Center the element, then scale from its center */
    transform: translate(-50%, -50%) scale(var(--viewport-scale, 0.5));
}

/* For OBS, render at natural size without scaling - OBS handles the display scaling */
.wrapper.obs-mode:not(.exporting) {
    position: absolute;
    top: 0;
    left: 0;
    transform: none;
}

/* When exporting, maintain original size and positioning */
.wrapper.exporting {
    position: static;
    transform: none;
    top: auto;
    left: auto;
}

/* Drop overlay */
.drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    border: 4px dashed rgba(255, 203, 5, 0.8);
    border-radius: 20px;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}

.drop-overlay-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
}

.drop-overlay-icon {
    font-size: 64px;
    font-weight: 700;
    font-family: 'Teko', sans-serif;
    color: #ffcb05;
    background: rgba(255, 203, 5, 0.15);
    border-radius: 16px;
    padding: 16px 32px;
    line-height: 1;
}

.drop-overlay-text {
    font-size: 28px;
    font-family: 'Play', sans-serif;
    color: #ffffff;
    opacity: 0.9;
}
</style>
