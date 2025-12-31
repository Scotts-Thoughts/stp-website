<script setup lang="ts">
import { computed, onUnmounted } from 'vue'
import PkmnImage from './PkmnImage.vue';
import MetricPopout from './MetricPopout.vue';
import { useGlobal, useTierlist, useFileExporter, CreditMode } from '../store';
import { getBaseSpeciesName, hasAlternativeMoveType } from '../utils/pokemon';

const global = useGlobal();
const tierlist = useTierlist();
const fileexporter = useFileExporter();

const tierData = computed(() => [
    { name: "S" },
    { name: "A" },
    { name: "B" },
    { name: "C" },
    { name: "D" },
    { name: "E" },
    { name: "F" },
    { name: "Surge", image: "./images/surge.png" },
    { name: "Bruno", image: "./images/bruno.png" },
    { name: tierlist.activeTierlist.finalTierLabel || "Impossible",  }
]);

const data = computed(() => { 
    const rankedEntries = tierlist.activeFilteredAttempts.filter(entry => {
        // Exclude untracked entries
        if (entry.tags.includes("untracked")) return false;
        // Exclude entries with alternative move types (detected from Pokemon name)
        if (hasAlternativeMoveType(entry.pkmnName)) return false;
        return true;
    });
    // Count unique species (not forms) by extracting base species names
    const uniqueSpecies = new Set(rankedEntries.map(entry => getBaseSpeciesName(entry.pkmnName)));
    
    return {
        groups:      tierlist.groupedEntries, 
        total:       tierlist.activeTierlist.total[tierlist.activeTotalIndex], 
        totalRanked: uniqueSpecies.size,
        labels:      tierlist.labels,
        rankedLabel: tierlist.activeCategory === "first" ? "Ranked" : "Ranked", // TODO: change labels
    };
});

function unselectAll() {
    tierlist.activePkmn = '';
    tierlist.activePrev = '';
    tierlist.selectedPkmn.clear();
}

onUnmounted(unselectAll)

</script>


<template>
    <svg style="display: none;">
        <filter id="outline10">
            <!-- <feMorphology in="SourceAlpha" result="ERODE_1"  operator="erode"  radius="0"></feMorphology> -->
            <!-- <feMorphology in="ERODE_1"     result="DILATE_1" operator="dilate" radius="0"></feMorphology> -->
            <!-- <feMorphology in="DILATE_1"    result="DILATE_2" operator="dilate" radius="2"></feMorphology> -->
            <feMorphology in="SourceAlpha"  result="DILATE_2" operator="dilate" radius="1"></feMorphology>
            <feFlood      flood-color="black" result="COLOR"></feFlood>
            <feComposite  in="COLOR" in2="DILATE_2" operator="in" result="OUTLINE"></feComposite>
            <feMerge>
                <feMergeNode in="OUTLINE" />
                <feMergeNode in="SourceGraphic" />
            </feMerge>
        </filter>
        
        <filter id="outline15">
            <feMorphology in="SourceAlpha"  result="DILATE_2" operator="dilate" radius="1.5"></feMorphology>
            <feFlood      flood-color="black" result="COLOR"></feFlood>
            <feComposite  in="COLOR" in2="DILATE_2" operator="in" result="OUTLINE"></feComposite>
            <feMerge>
                <feMergeNode in="OUTLINE" />
                <feMergeNode in="SourceGraphic" />
            </feMerge>
        </filter>
        
        <filter id="outline20">
            <feMorphology in="SourceAlpha"  result="DILATE_2" operator="dilate" radius="2"></feMorphology>
            <feFlood      flood-color="black" result="COLOR"></feFlood>
            <feComposite  in="COLOR" in2="DILATE_2" operator="in" result="OUTLINE"></feComposite>
            <feMerge>
                <feMergeNode in="OUTLINE" />
                <feMergeNode in="SourceGraphic" />
            </feMerge>
        </filter>
    </svg>

    <div :class="{
            'tier-list rounded': true,
            'no-credits': global.creditMode == CreditMode.NONE,
            'small-credits': global.creditMode == CreditMode.SMALL,
            'big-credits': global.creditMode == CreditMode.BIG,
        }" @click="unselectAll()"
    >
        <template v-for="(group, i) in data.groups" >
            <div :class="'category rounded tier-' + i + (global.hidden ? ' pending' : '')">
                <div class="label">{{ tierData[i].name }}</div>
                <img v-if="tierData[i].image"
                    class="image" :src="tierData[i].image" />
            </div>
            <div :class="'entry-row gray-grad rounded tier-' + i" :data-label="data.labels[i]">
                <PkmnImage v-for="entry in group"
                    :key="entry.pkmnName"
                    :pokemon="entry.pkmnName"
                    :neighbor="entry.prev"
                    :active="true"
                    :no-hover="fileexporter.exportInProgress"
                    @click.stop="
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
                    <MetricPopout 
                        v-if="global.popoutActive && tierlist.selectedPkmn.has(entry.pkmnName)"
                        :pokemon="entry.pkmnName"
                        :open-to-top="i >= 7"
                    />
                </PkmnImage>
            </div>
        </template>
        <div :class="'ranked gray-grad rounded'">
            <span>{{ data.rankedLabel }}:</span>
            <span>{{ data.totalRanked }}/{{ data.total }}</span>
        </div>
        <div class="credits-box"></div>
    </div>
</template>


<style scoped>
.rounded {
    border-radius: 11px;
}

.gray-grad {
    background: linear-gradient(#2a2a2a, #1c1c1c);
}

.tier-list {
    width: 100%;
    height: 100%;

    background-color: #010101;
    padding: 10px;

    display: grid;
    grid-template-columns: auto 1fr 217px 715px;
    grid-template-rows: auto;
    gap: 10px;
}

.small-credits.tier-list {
    grid-template-columns: auto 1fr 217px 531px;
}

.no-credits.tier-list {
    grid-template-columns: auto 1fr 0px 217px;
}

.category {
    position: relative;
    width: 106px;
    height: 93px;

    font-size: 106px;
    line-height: 1.05em;
    color: #000000;
    font-weight: 700;

    color: black;
    overflow: hidden;

    display: flex;
    align-items: center;
    justify-content: center;

    box-shadow:
        inset  2px  2px 4px 0px #ffffff20,
        inset -3px -3px 3px 0px #00000040;
}

.category .label {
    position: absolute;
    inset: 0;
    text-align: center;
}

.entry-row {
    position: relative;
    padding: 3px 6px;
    grid-column: span 3;

    display: flex;
    gap: 2px;
    flex-direction: row;
    flex-wrap: nowrap;
    image-rendering: optimizeQuality;
    align-items: flex-end;
}

.entry-row::after {
    content: attr(data-label);

    position: absolute;
    top: 0;
    bottom: 0;
    right: 7px;

    display: flex;
    align-items: center;

    font-size: 30px;
    color: #ffffff;
    font-weight: 700;
    font-family: "play";
    opacity: 0.388;
    filter: drop-shadow(0 0 9px rgba(0,0,0,0.69));
}

.ranked {
    display: flex;
    flex-direction: column;
    justify-content: center;
    color: #919191;
    line-height: 1;
    font-family: "play";
}
.ranked span:nth-child(1) {
    margin-top: 5px;
    font-size: 30px;
}
.ranked span:nth-child(2) {
    margin-top: -4px;
    font-size: 44px;
}

.credits-box {
    grid-row: 7 / span 4;
    grid-column: 4;
    background-color: red;
    opacity: 0.380;
    opacity: 0;
}


.small-credits .credits-box {
    grid-row: 8 / span 3;
}

.no-credits .credits-box {
    display: none;
}


.entry-row.tier-6 { grid-column: span 2; }
.entry-row.tier-7 { grid-column: span 2; }
.entry-row.tier-8 { grid-column: span 2; }
.entry-row.tier-9 { grid-column: span 1; }

.small-credits .entry-row.tier-6 { grid-column: span 3; }

.no-credits .entry-row.tier-6 { grid-column: span 3; }
.no-credits .entry-row.tier-7 { grid-column: span 3; }
.no-credits .entry-row.tier-8 { grid-column: span 3; }
.no-credits .entry-row.tier-9 { grid-column: span 2; }

.category.tier-0 { background: linear-gradient(#fe0000, #d10000); }
.category.tier-1 { background: linear-gradient(#fb9a3b, #d8802a); }
.category.tier-2 { background: linear-gradient(#fce10e, #c8b206); }
.category.tier-3 { background: linear-gradient(#91e261, #5bab2c); }
.category.tier-4 { background: linear-gradient(#7eacfa, #4776c5); }
.category.tier-5 { background: linear-gradient(#703edd, #5728bf); }
.category.tier-6 { background: linear-gradient(#7f337e, #6b276a); }
.category.tier-7 { background: linear-gradient(#6c003d, #4a002a); }
.category.tier-8 { background: linear-gradient(#920019, #630213); }
.category.tier-9 { background: linear-gradient(#634809, #503a06); }

.category.tier-7 .label,
.category.tier-8 .label {
    font-size: 30px;
    line-height: 140%;
}
.category.tier-7 .image,
.category.tier-8 .image {
    transform: translateY(14px);
    opacity: 0.871;
    filter: drop-shadow(0 0 3px rgba(0,0,0,0.56));
    image-rendering: pixelated;
}
.category.tier-9 .label {
    transform: rotate(-40deg) translate(-4px, -7px);
    font-size: 26px;
}

.category.pending  {
    background: linear-gradient(#2a2a2a, #1c1c1c);
    color: #ffffff08;
}
.category.pending .label {
    transform: unset;

    font-size: 106px;
    line-height: 1.05em;
}
.category.pending .image {
    display: none;
}
</style>
