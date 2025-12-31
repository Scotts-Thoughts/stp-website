<script setup lang="ts">
import { computed } from 'vue'
import Window from '../components/Window.vue'
import DropdownSelect from '../components/DropdownSelect.vue'

import { METRIC_KEYS, useFileExporter, useGlobal, useTierlist } from '../store';
import  { currentDate } from '../utils/time';

import { types as pokemonTypes } from '../utils/pokemon/types';
import { growthRates as pokemonGrowthRates } from '../utils/pokemon/growth-rates';

defineProps<{
    visible: boolean
}>();

defineEmits<{
    close: []
}>();

const global = useGlobal();
const tierlist = useTierlist();
const fileexporter = useFileExporter();

// Calculate centered position for the window
const centeredPosition = computed(() => {
    const windowWidth = 400;
    const windowHeight = 500;
    
    const x = (window.innerWidth - windowWidth) / 2;
    const y = (window.innerHeight - windowHeight) / 2;
    
    return { x, y };
});

async function selectFolder() {
    const result = await fileexporter.selectFolder();
    console.log(result);
}

</script>


<template>
    <Window title="Edit Filter Option" :visible="visible" :width="400" :height="500" @close="$emit('close')" :resizable="true" :custom-position="centeredPosition">
        <table>
            <tbody>
            <tr>
                <td><label for="filter-exclude-entries">Exclude Entries</label></td>
                <td><DropdownSelect
                    id="filter-exclude-entries" 
                    :options="tierlist.activeAttempts.map(a => a.pkmnName)"
                    v-model="tierlist.excludePokemonList"
                    height="200px"
                    :hide-selected="global.obsPresent"
                />
                </td>
            </tr>

            <tr>
                <td><label for="filter-include-tags">Include Tags</label></td>
                <td><DropdownSelect 
                    id="filter-include-tags"
                    :options="tierlist.activeTagList"
                    v-model="tierlist.includeTagsList"
                    height="200px"
                />
                </td>
            </tr>

            <tr>
                <td><label for="filter-exclude-tags">Exclude Tags</label></td>
                <td><DropdownSelect 
                    id="filter-exclude-tags"
                    :options="tierlist.activeTagList"
                    v-model="tierlist.excludeTagsList"
                    height="200px"
                />
                </td>
            </tr>

            <tr>
                <td><label for="filter-release-date">Release Date</label></td>
                <td>
                    <input type="date" id="filter-release-date" v-model="tierlist.releaseDateTreshold" />
                    <button class="icon-button" @click="tierlist.releaseDateTreshold = currentDate()" title="Reset to Current Date">&#x21bb;</button>
                    <button class="icon-button" @click="tierlist.releaseDateTreshold = '2099-01-01'" title="Set to Max Date">&#x221e;</button>
                </td>
            </tr>

            <tr>
                <td><label for="filter-category">Category</label></td>
                <td><select id="filter-category" v-model="tierlist.activeCategory">
                    <option value="best">Best Attempt</option>
                    <option value="first">First Attempt</option>
                </select></td>
            </tr>

            <tr>
                <td><label for="filter-metric">Metric</label></td>
                <td><select id="filter-metric" v-model="tierlist.activeMetric">
                    <option v-for="key in METRIC_KEYS" :value="key">{{ key }}</option>
                </select></td>
            </tr>

            <tr>
                <td><label for="filter-total">Total</label></td>
                <td><select id="filter-total" v-model="tierlist.activeTotalIndex">
                    <option v-for="value, index in tierlist.activeTierlist.total" :value="index">{{ value }}</option>
                </select></td>
            </tr>

            <tr>
                <td><label for="filter-threshold">Threshold</label></td>
                <td><select id="filter-threshold" v-model="tierlist.activeThresholdIndex">
                    <option v-for="value, index in tierlist.activeThresholdList ?? []" :value="index">{{ value.label }}</option>
                </select></td>
            </tr>

            <tr>
                <td><label for="filter-type">Types</label></td>
                <td><DropdownSelect 
                    id="filter-type"
                    :options="pokemonTypes"
                    v-model="tierlist.includeTypeList"
                    height="200px"
                /></td>
            </tr>

            <tr>
                <td><label for="filter-growth-rate">Growth Rate</label></td>
                <td><DropdownSelect 
                    id="filter-growth-rate"
                    :options="pokemonGrowthRates"
                    v-model="tierlist.includeGrowthRateList"
                    height="200px"
                /></td>
            </tr>

            <tr>
                <td class="spacer">
                </td>
            </tr>

            <tr>
                <td><label for="filter-save-folder">Save Folder</label></td>
                <td>
                    <i v-if="!fileexporter.folderOpened">Not Selected</i>
                    <template v-else>
                        {{ fileexporter.folderOpened }}
                    </template>
                    <button class="icon-button" id="filter-save-folder" @click="selectFolder()" title="Open new folder">&#x21bb;</button>
                </td>
            </tr>

            <tr>
                <td><label for="filter-save-name">Save Prefix</label></td>
                <td><input id="filter-save-name" v-model="fileexporter.filePrefix" /></td>
            </tr>
            </tbody>
        </table>
    </Window>
</template>


<style scoped>
table {
    width: 100%;
}
tr td:nth-child(2) {
    padding-left: 20px;
    padding-block: 4px;
    text-align: center;
    display: flex;
    align-items: center;
    gap: 5px;
}
td.spacer {
    height: 20px;
}
input, select, button {
    padding: 5px 10px;
    height: 30px;
    width: 100%;
}
input:invalid {
    background-color: #f004;
}

.icon-button {
    width: 30px;
    margin-left: auto;
    padding: 0px;
    flex-shrink: 0;
}
</style>
