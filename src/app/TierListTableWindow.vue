<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'
import { METRIC, MetricKeys, CreditMode, useGlobal, useFileExporter, useTierlist } from '../store';

import PkmnImage from '../components/PkmnImage.vue';
import Window from '../components/Window.vue';

defineProps<{
    visible: boolean
}>();

defineEmits<{
    close: []
}>();

const global = useGlobal();
const tierlist = useTierlist();
const exporter = useFileExporter();

const TABLE_RANK_LABEL = computed(() => [
    "Tier S",
    "Tier A",
    "Tier B",
    "Tier C",
    "Tier D",
    "Tier E",
    "Tier F",
    "Tier " + (tierlist.activeTierlist.surgeTierLabel || "Surge"),
    "Tier " + (tierlist.activeTierlist.brunoTierLabel || "Bruno"),
    (tierlist.activeTierlist.finalTierLabel || "Impossible") + " -",
]);

const TABLE_COLUMNS = [
    //["finished", "finished"], 
    ["realtime", "Realtime"],
    ["resets", "Resets"],
    ["blackouts", "Blackouts"],
    ["faults", "Faults"],
    ["level", "Level"],
    ["gametime", "Gametime"],
    // ["realtime_0", "realtime_0"], 
    // ["resets_0", "resets_0"], 
    // ["blackouts_0", "blackouts_0"], 
    // ["faults_0", "faults_0"],
    // ["level_0", "level_0"], 
    // ["gametime_0", "gametime_0"], 
] as const;

const data = computed(() => ({ 
    groups: tierlist.groupedEntries.map(g => g.map(e => {
        const obj = {
            pkmnName: e.pkmnName,
            prev: e.prev,
            metrics: {} as Record<MetricKeys, string>,
        };

        for (const [key, _] of TABLE_COLUMNS) {
            const m = e.metrics[key as MetricKeys];
            const value = (typeof m === 'function') ? m() : m;
            if (value !== undefined && value >= 0) {
                obj.metrics[key] = METRIC[key as MetricKeys]?.formatLabel?.(value) ?? value.toString();
            } else {
                obj.metrics[key] = "-";
            }
        }

        return obj;
    })),
    rankedNames: tierlist.groupedEntries.flat().map((value) => value.pkmnName),
    labels: tierlist.labels,
}));

const windowRef = useTemplateRef("windowRef");

// by default the window is centered
// adjust position when credit state changes
function updatePosition(creditMode: CreditMode)  {
    const windowState = windowRef.value!.state;

    windowState.x = (1920 - windowState.width) / 2;
    windowState.y = (1080 - windowState.height) / 2;
    
    if (creditMode == CreditMode.SMALL) windowState.x -= 110;
    if (creditMode == CreditMode.BIG)   windowState.x -= 300;
}
watch(() => global.creditMode, updatePosition);
onMounted(() => updatePosition(global.creditMode));

watch(() => tierlist.activePkmn, (pkmnName) => {
    document.getElementById("table-entry-" + pkmnName)?.scrollIntoView({
        behavior: "smooth",
        block: "center"
    })
})

watch(() => exporter.exportInProgress, (exporting) => {
    const contentDom = windowRef.value?.windowRoot?.querySelector(".content");
    const tableDom = contentDom?.querySelector("table");
    if (!contentDom || !tableDom) return;

    if (exporting) {
        const offset = contentDom.scrollTop;
        (contentDom as any)._scrollTop = offset;
        tableDom.style.top = -offset + "px";
        contentDom.scrollTop = 0;
    } else {
        const offset = (contentDom as any)._scrollTop;
        tableDom.style.top = "0px";
        contentDom.scrollTop = offset;
    }
})

</script>


<template>

    <Window
        ref="windowRef"
        :class="{
            'tierlist-table-window': true,
            'exporting': exporter.exportInProgress
        }"
        :width="900"
        :height="960"
        :visible="visible"
        :keepPositionOnShow="true"
        @close="$emit('close')"
    >
        <table>
            <thead>
                <tr>
                    <th>Rank</th>
                    <th></th>
                    <th>Pokemon</th>
                    <th v-for="(col, index) in TABLE_COLUMNS" :key="index">{{ col[1] }}</th>
                </tr>
            </thead>
            <tbody v-for="(group, i) in data.groups" :key="i">
                <tr class="tier-header">
                    <td colspan="9999">
                        <div>{{ TABLE_RANK_LABEL[i] }} {{ data.labels[i] }}</div>
                    </td>
                </tr>
                <tr v-for="entry in group"
                    :class="{
                        'tier-entry': true,
                        'selected': tierlist.selectedPkmn.has(entry.pkmnName),
                    }"
                    :key="entry.pkmnName"
                    @click="
                        if (!$event.ctrlKey) {
                            tierlist.activePkmn = entry.pkmnName;
                            tierlist.activePrev = entry.prev;
                            tierlist.selectedPkmn.clear();
                            tierlist.selectedPkmn.add(entry.pkmnName);
                        } else {
                            if (tierlist.selectedPkmn.has(entry.pkmnName)) {
                                tierlist.selectedPkmn.delete(entry.pkmnName);
                            } else {
                                tierlist.selectedPkmn.add(entry.pkmnName);
                            }
                        }
                    "
                >
                    <td>
                        {{ data.rankedNames.indexOf(entry.pkmnName) + 1 }}
                    </td>
                    <td>
                        <div class="tier-image" :id="'table-entry-' + entry.pkmnName">
                            <PkmnImage :pokemon="entry.pkmnName" :height="36" :outline="1" noHover />
                        </div>
                    </td>
                    <td>
                        {{ entry.pkmnName }}
                    </td>
                    <td v-for="(col, index) in TABLE_COLUMNS" :key="index" v-html="entry.metrics[col[0]]">
                    </td> 
                </tr>
                
            </tbody>
        </table>
    </Window>

</template>


<style scoped>
.tierlist-table-window {
    --window-color: #444;
    --border-color: #222;
    --table-header-color: #222;
    --table-tier-color: #333;
    --table-row-hover-color: #0004;
    --table-row-selected-color: #000a;
    --table-cell-separator-color: #fff1;
}


.tierlist-table-window {
    background-color: var(--window-color);
}

.tierlist-table-window :deep(.title) {
    background-color: transparent;
    height: calc(56px + 6px);
}

.tierlist-table-window :deep(.close) {
    border-radius: 20px;
    margin: 2px;
    font-size: 16px;
    background-color: #111;
    opacity: 0.1;
}

.tierlist-table-window :deep(.resize) {
    opacity: 0;
    height: 40px;
    width: 40px
}

.tierlist-table-window :deep(.close:hover) {
    opacity: 1;
}

.exporting.tierlist-table-window :deep(.close) {
    opacity: 0;
}

.tierlist-table-window :deep(.content) {
    position: relative;                                                                                                                                                                                                                                                                                                                                                                      
    padding: 0;
    overflow-x: hidden;
    overflow-y: scroll;
    margin-top: -32px;
    z-index: -1;
    border: 6px var(--border-color) solid;
    border-right-width: 0px;
    border-radius: 8px;
}
.exporting.tierlist-table-window :deep(.content) {
    scrollbar-width: none;
    border-right-width: 6px;
}

.tierlist-table-window ::-webkit-scrollbar {
    width: 6px;
}
.tierlist-table-window ::-webkit-scrollbar-thumb {
    background: #fff4;
}
.tierlist-table-window ::-webkit-scrollbar-track {
    background: var(--border-color);
}

table {
    position: absolute;
    font-family: Consolas, monospace;
    border-collapse: collapse;
    width: calc(100% + 1px);
}

thead {
    position: sticky;
    top: 0;
    background-color: var(--table-header-color);
    color: #fff;
    z-index: 2;
}

thead th {
    z-index: 2;
    height: 56px;
    padding-inline: 8px;
}

thead th,
tbody tr.tier-header,
tbody tr.tier-entry td:nth-child(1),
tbody tr.tier-entry td:nth-child(3) {
    font-family: 'play';
}

tbody {
    position: relative;
}
tbody tr.tier-header {
    height: 48px;
}
tbody tr.tier-header td {
    position: absolute;
    inset: 0;
    pointer-events: none;
}
tbody tr.tier-header td div {
    position: sticky;
    top: 56px;
    height: 48px;
    z-index: 1;
    background-color: var(--table-tier-color);
    border-bottom: var(--window-color) 1px solid;
    font-weight: bold;
    padding-block: 10px;
    text-align: center;
}

tbody tr.tier-entry {
    height: 48px;
    cursor: pointer;
}
tbody tr.tier-entry:hover {
    background-color: var(--table-row-hover-color);
}
.exporting tr.tier-entry:hover {
    background-color: transparent;
}
tbody tr.tier-entry.selected {
    background-color: var(--table-row-selected-color);
}

thead th:first-child,
tbody tr.tier-entry td:first-child {
    text-align: center;
    padding-left: 16px;
}
thead th:last-child,
tbody tr.tier-entry td:last-child {
    padding-right: 16px;
}
tbody tr.tier-entry td:nth-child(2) {
    width: 56px;
    text-align: center;
}
.tier-image {
    width: 56px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
}

tbody tr.tier-entry td:nth-child(2) {
    padding-inline: 10px;
    width: 250px;
}
tbody tr.tier-entry td:nth-child(n+3) {
    text-align: center;
    padding-inline: 8px;
    border-left: 1px solid var(--table-cell-separator-color);
    width: 150px;
}
tbody tr.tier-entry td:last-child { 
    padding-right: 20px;
}

</style>
