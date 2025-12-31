<script setup lang="ts">
import { onClickOutside } from '@vueuse/core';
import { computed, ref } from 'vue';

const props = withDefaults(defineProps<{
    id?: string
    /** Options to select from */
    options: string[]
    /** Allow to add other options not presenet in the options list */
    allowOther?: boolean
    /** Height of the dropdown list */
    height?: string
    /** Hide selected options from being shown in the overview */
    hideSelected?: boolean
    /** Maximum number of items to show in the dropdown */
    maxItems?: number
}>(), {
    allowOther: false,
    height: '15rem',
    hideSelected: false,
    maxItems: 20
})


const rootElement = ref<HTMLDivElement>();
const searchElement = ref<HTMLInputElement>();
const dropdownWrapper = ref<HTMLDivElement>();

const selected = defineModel<string[]>({ required: true });
const search = ref('');
const focused = ref(false);
const dropdownPosition = ref({ top: 0, left: 0, width: 0 });

const allOptions = computed(() => {
    const options = props.options.filter(o => o.toLocaleLowerCase().startsWith(search.value));
    if (!props.allowOther) return options;
    return selected.value.difference(options).concat(options);
});

function startSearch() {
    focused.value = true;
    
    // Calculate position for the dropdown
    if (rootElement.value) {
        const rect = rootElement.value.getBoundingClientRect();
        dropdownPosition.value = {
            top: rect.bottom,
            left: rect.left,
            width: rect.width
        };
    }
    
    searchElement.value?.focus();
    search.value = '';
}

function exitSearch() {
    focused.value = false;
    search.value = '';
}

function insertOption(option: string) {
    if (!selected.value.includes(option)) {
        selected.value.push(option);
    }
}

function removeOption(option: string) {
    selected.value = selected.value.filter(o => o !== option);
}


function onCheckboxChange(event: Event, option: string) {
    const target = event.target as HTMLInputElement;
    if (target.checked) {
        insertOption(option);
    } else {
        removeOption(option);
    }

    searchElement.value?.focus()
}

function onSearchInputConfirm() {
    if (!props.allowOther) return;
    if (search.value === '') return;
    
    insertOption(search.value);
    search.value = '';
}


onClickOutside(rootElement, exitSearch);

</script>


<template>
    <div ref="rootElement" class="dropdown" :style="{width: '100%', minHeight: '30px'}" @click="startSearch()">
        <div v-if="focused" ref="dropdownWrapper" class="dropdown-list-wrapper" :style="{
            top: dropdownPosition.top + 'px',
            left: dropdownPosition.left + 'px',
            width: dropdownPosition.width + 'px'
        }">
            <input :id="id" ref="searchElement" class="dropdown-search" placeholder="search..." v-model="search" @keydown.enter="onSearchInputConfirm" />
            <div class="dropdown-list" :style="{ maxHeight: height }">
                <div v-for="value in allOptions.filter(o => o.toLocaleLowerCase().startsWith(search))">
                    <input
                        type="checkbox" 
                        :id="'list_' + value"
                        :checked="selected.includes(value)" 
                        @change="onCheckboxChange($event, value)" />
                    <label :for="'list_' + value">{{ value }}</label>
                </div>
            </div>
        </div>
        <template v-else-if="!hideSelected">
            <span v-for="value in selected" class="optext" @click.stop="removeOption(value)">
                {{ value }}
            </span>
        </template>
        <template v-else>
            <span class="optext">
                {{ selected.length }} selected
            </span>
        </template>
    </div>
</template>


<style scoped>
.dropdown {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    text-align: left;
    padding: 2px;
    border-radius: 2px;
    border: solid 1px light-dark(rgb(118, 118, 118), rgb(133, 133, 133));
    background-color: field;
    position: relative;
}

.optext {
    border-radius: inherit;
    display: inline;
    background-color: #222;
    padding: 1px 8px;
    cursor: pointer;
}
.optext:hover {
    text-decoration: line-through;
    outline: 1px solid #fff8;
}

.dropdown-list-wrapper {
    box-shadow: #0008 0 3px 8px;
    z-index: 1000;
    padding: 2px;
    border-radius: inherit;
    border: solid 1px #ced4da;
    position: fixed;
    background-color: field;
}

.dropdown-search {
    display: block;
    width: 100%;
    height: 30px;
    font: inherit;
    padding: 0 10px;
    margin-bottom: 5px;
    border: none;
    outline: none;
}

.dropdown-list {
    padding: 2px;
    overflow-y: auto;
    overflow-x: hidden;
}

.dropdown-list > div {
    padding: 0 5px;
    height: 22px;
    display: flex;
    gap: 8px;
    align-items: center;
}
.dropdown-list > div:hover {
    background-color: #444;
}
.dropdown-list > div input {
    height: 1.15em;
    width: 1.15em;
}
.dropdown-list > div label {
    flex: 1;
}
</style>