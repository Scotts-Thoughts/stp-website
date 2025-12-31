<script setup lang="ts">
import { ref, watch, useTemplateRef, onMounted, onUnmounted } from 'vue'
import { onKeyDown } from '@vueuse/core';

import { useContextMenu, useFileExporter, useGlobal, useTierlist, useToast, useWorkspace } from '../store';
import { currentDate } from '../utils/time';

import EditViewWindow from './EditViewWindow.vue'
import EditMetricsWindow from './EditMetricsWindow.vue'
import InsertMetricsWindow from './InsertMetricsWindow.vue'
import InsertCsvMetricsWindow from './InsertCsvMetricsWindow.vue'
import EditFilterWindow from './EditFilterWindow.vue'
import SearchWindow from './SearchWindow.vue'
import TierListTableWindow from './TierListTableWindow.vue'
import Tierlist from '../components/TierList.vue'
import QuickCalendarPopup from '../components/QuickCalendarPopup.vue'

const emit = defineEmits<{
    close: [],
}>();

const global = useGlobal();
const tierlist = useTierlist();
const workspace = useWorkspace();
const contextMenu = useContextMenu();
const fileexporter = useFileExporter();
const toast = useToast();

const root = useTemplateRef("root");

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
}

const mode = ref<Mode>(Mode.VIEWING);
const searchActive = ref(false);
const prevPopoutState = ref(false);
const tierlistTableActive = ref(false);
const quickCalendarActive = ref(false);

watch([mode], () => {
    // Keep shortcuts active for toggle functionality
    contextMenu.shortcutsActive = true;
});

contextMenu.setOptions([
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
        label: "Toggle Category",
        shortcut: 'D',
        action() {
            if (tierlist.activeCategory === "first") {
                tierlist.activeCategory = "best";
                toast.addToast("Switched to Followup Attemps", "info", { timeout: 2000 })
            } else {
                tierlist.activeCategory = "first";
                toast.addToast("Switched to First Attemps", "info", { timeout: 2000 })
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
]);

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
    e.preventDefault();
});



</script>


<template>
    <div class="wrapper" :class="{ 'exporting': fileexporter.exportInProgress, 'obs-mode': global.obsPresent }" ref="root">
        <Tierlist />
    </div>

    <Teleport to="#app">
        <TierListTableWindow :visible="tierlistTableActive"          @close="tierlistTableActive = false" />
        <InsertMetricsWindow :visible="mode === Mode.INSERT_METRIC"  @close="mode = Mode.VIEWING" />
        <InsertCsvMetricsWindow :visible="mode === Mode.INSERT_CSV_METRIC"  @close="mode = Mode.VIEWING" />
        <EditMetricsWindow   :visible="mode === Mode.EDIT_METRIC"    @close="mode = Mode.VIEWING" />
        <EditViewWindow      :visible="mode === Mode.EDIT_VIEW"      @close="mode = Mode.VIEWING" />
        <EditFilterWindow    :visible="mode === Mode.EDIT_FILTER"    @close="mode = Mode.VIEWING" />
        <SearchWindow        :visible="searchActive"                 @close="searchActive = false" />
        <QuickCalendarPopup  :visible="quickCalendarActive"          @close="quickCalendarActive = false" />
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
</style>
