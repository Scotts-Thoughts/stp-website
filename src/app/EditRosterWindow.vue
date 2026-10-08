<script setup lang="ts">
import { computed, ref } from 'vue';
import Window from '../components/Window.vue'

import { useTierlist } from '../store';
import { pokemonNames, getSpeciesRootName, hasAlternativeMoveType } from '../utils/pokemon';
import { generations, getNationalDexNumber, getSpeciesGeneration } from '../utils/pokemon/generations';

defineProps<{
    visible: boolean
}>();

defineEmits<{
    close: []
}>();

const tierlist = useTierlist();

const centeredPosition = computed(() => {
    const windowWidth = 900;
    const windowHeight = 800;
    return { x: (window.innerWidth - windowWidth) / 2, y: (window.innerHeight - windowHeight) / 2 };
});

/** What kind of entry a pokemonNames name is, for the "include forms / Megas" options. */
function nameKind(name: string): 'species' | 'form' | 'mega' {
    if (/^(?:Mega|Primal) /.test(name)) return 'mega';
    return getSpeciesRootName(name) === name ? 'species' : 'form';
}

/** Dex order, a species before its forms, forms alphabetically. */
function compareNames(a: string, b: string) {
    const da = getNationalDexNumber(a) ?? Infinity;
    const db = getNationalDexNumber(b) ?? Infinity;
    if (da !== db) return da - db;
    const ka = nameKind(a) === 'species' ? 0 : 1;
    const kb = nameKind(b) === 'species' ? 0 : 1;
    return ka - kb || a.localeCompare(b);
}

const roster = computed(() => tierlist.activeTierlist.roster ?? []);
const rosterSet = computed(() => new Set(roster.value));
const rosterSpeciesCount = computed(() => new Set(roster.value.map(getSpeciesRootName)).size);

/** Writes the roster back in dex order; an empty roster is removed so the hand-entered totals apply again. */
function setRoster(names: Iterable<string>) {
    const list = [...new Set(names)].sort(compareNames);
    tierlist.activeTierlist.roster = list.length ? list : undefined;
}

function addNames(names: string[]) {
    setRoster([...roster.value, ...names]);
}

function removeNames(names: string[]) {
    const drop = new Set(names);
    setRoster(roster.value.filter(n => !drop.has(n)));
}

function toggleName(name: string) {
    if (rosterSet.value.has(name)) removeNames([name]);
    else addNames([name]);
}

/// GENERATION RANGE ///

const genFrom = ref(1);
const genTo = ref(1);
const includeForms = ref(false);
const includeMegas = ref(false);

const rangeNames = computed(() => {
    const lo = Math.min(genFrom.value, genTo.value);
    const hi = Math.max(genFrom.value, genTo.value);
    const wanted = new Set(generations.slice(lo - 1, hi));
    return pokemonNames.filter(name => {
        const gen = getSpeciesGeneration(name);
        if (!gen || !wanted.has(gen)) return false;
        const kind = nameKind(name);
        return kind === 'species' || (kind === 'form' && includeForms.value) || (kind === 'mega' && includeMegas.value);
    });
});

const rangeLabel = computed(() => {
    const lo = Math.min(genFrom.value, genTo.value);
    const hi = Math.max(genFrom.value, genTo.value);
    return lo === hi ? `Gen ${lo}` : `Gen ${lo}-${hi}`;
});

/// INDIVIDUAL SEARCH ///

const search = ref('');
const SEARCH_LIMIT = 60;

const searchResults = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return [];
    return pokemonNames
        .filter(name => name.toLowerCase().includes(q))
        // names that start with the query first ("Mew" before "Mega Mewtwo X")
        .sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)) || compareNames(a, b))
        .slice(0, SEARCH_LIMIT);
});

function addFirstResult() {
    const first = searchResults.value[0];
    if (first && !rosterSet.value.has(first)) addNames([first]);
}

/// ASSIGNED LIST ///

const groupedRoster = computed(() => {
    const groups = new Map<string, string[]>();
    for (const name of roster.value) {
        const gen = getSpeciesGeneration(name) ?? 'Unknown';
        if (!groups.has(gen)) groups.set(gen, []);
        groups.get(gen)!.push(name);
    }
    return [...groups].map(([gen, names]) => ({ gen, names }));
});

/** Tierlist entries whose species isn't assigned yet; they still show, but don't count toward "Ranked". */
const unassignedEntries = computed(() => {
    const assigned = tierlist.rosterSpecies;
    if (!assigned) return [];
    return Object.keys(tierlist.activeTierlist.entries)
        .filter(name => !hasAlternativeMoveType(name) && !assigned.has(getSpeciesRootName(name)));
});
</script>


<template>
    <Window title="Assign Species" :visible="visible" :width="900" :height="800" @close="$emit('close')" :resizable="true" :custom-position="centeredPosition">
        <div class="roster-window">
            <div class="summary">
                <template v-if="roster.length">
                    <span><b>{{ rosterSpeciesCount }}</b> species assigned<template v-if="roster.length !== rosterSpeciesCount"> ({{ roster.length }} entries incl. forms)</template></span>
                    <button class="btn danger" @click="setRoster([])">Clear all</button>
                </template>
                <span v-else class="muted">No species assigned — the Ranked total uses the hand-entered totals.</span>
            </div>

            <div class="section-title">Generations</div>
            <div class="gen-row">
                <label>From
                    <select v-model.number="genFrom">
                        <option v-for="(g, i) in generations" :key="g" :value="i + 1">{{ g }}</option>
                    </select>
                </label>
                <label>to
                    <select v-model.number="genTo">
                        <option v-for="(g, i) in generations" :key="g" :value="i + 1">{{ g }}</option>
                    </select>
                </label>
                <label class="check"><input type="checkbox" v-model="includeForms" /> Regional &amp; alternate forms</label>
                <label class="check"><input type="checkbox" v-model="includeMegas" /> Megas &amp; Primals</label>
            </div>
            <div class="gen-row">
                <button class="btn add" @click="addNames(rangeNames)">Add {{ rangeLabel }}</button>
                <button class="btn" @click="setRoster(rangeNames)">Replace with {{ rangeLabel }}</button>
                <button class="btn danger" @click="removeNames(rangeNames)">Remove {{ rangeLabel }}</button>
                <span class="muted">{{ rangeNames.length }} entries</span>
            </div>

            <div class="section-title">Individual Pokémon, forms &amp; Megas</div>
            <input
                v-model="search"
                class="search"
                placeholder="Search, e.g. Rotom, Alolan, Mega… (Enter adds the first match)"
                @keydown.enter="addFirstResult"
            />
            <div v-if="searchResults.length" class="results">
                <button
                    v-for="name in searchResults" :key="name"
                    class="chip" :class="{ on: rosterSet.has(name) }"
                    :title="rosterSet.has(name) ? 'Click to remove' : 'Click to add'"
                    @click="toggleName(name)"
                >
                    <span class="mark">{{ rosterSet.has(name) ? '✓' : '+' }}</span>
                    {{ name }}
                    <span class="gen-tag">{{ getSpeciesGeneration(name)?.replace('Gen ', 'G') }}</span>
                </button>
            </div>

            <div v-if="unassignedEntries.length" class="warning">
                {{ unassignedEntries.length }} tierlist {{ unassignedEntries.length === 1 ? 'entry isn\'t' : 'entries aren\'t' }}
                assigned, so {{ unassignedEntries.length === 1 ? 'it doesn\'t' : 'they don\'t' }} count toward Ranked:
                <span class="muted">{{ unassignedEntries.slice(0, 8).join(', ') }}{{ unassignedEntries.length > 8 ? '…' : '' }}</span>
                <button class="btn add" @click="addNames(unassignedEntries)">Assign them</button>
            </div>

            <div class="section-title">Assigned</div>
            <div class="assigned">
                <div v-if="!roster.length" class="empty">Nothing assigned yet.</div>
                <div v-for="group in groupedRoster" :key="group.gen" class="group">
                    <div class="group-head">
                        <span>{{ group.gen }}</span>
                        <span class="muted">{{ group.names.length }}</span>
                        <button class="btn small danger" @click="removeNames(group.names)">Remove</button>
                    </div>
                    <div class="chips">
                        <span v-for="name in group.names" :key="name" class="chip on static">
                            {{ name }}
                            <button class="x" title="Remove" @click="removeNames([name])">&times;</button>
                        </span>
                    </div>
                </div>
            </div>

            <div class="hint">The Ranked total counts assigned species that match the Type / Growth Rate / Generation filters. Ctrl+S to save.</div>
        </div>
    </Window>
</template>


<style scoped>
.roster-window { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }

.summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 16px; }
.section-title { margin-top: 6px; color: #aaa; font-size: 16px; border-bottom: 1px solid #444; padding-bottom: 4px; }
.muted { color: #888; font-size: 14px; }

.gen-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.gen-row label { display: flex; align-items: center; gap: 6px; color: #ccc; font-size: 14px; }
.gen-row select {
    padding: 6px 8px; background: #222; border: 1px solid #444; border-radius: 4px; color: white; font-size: 14px;
}
.gen-row .check { cursor: pointer; }

.btn {
    padding: 6px 12px; background: #333; border: 1px solid #444; border-radius: 4px;
    color: #ccc; cursor: pointer; font-size: 14px; white-space: nowrap;
}
.btn:hover { background: #444; color: white; }
.btn.add { background: #2a5a2a; border-color: #3a7a3a; }
.btn.add:hover { background: #3a7a3a; }
.btn.danger { color: #d77; }
.btn.danger:hover { color: #f99; }
.btn.small { padding: 2px 8px; font-size: 12px; }

.search {
    padding: 8px 10px; background: #222; border: 1px solid #444; border-radius: 4px; color: white; font-size: 15px;
}

.results, .chips { display: flex; flex-wrap: wrap; gap: 4px; }
.results { max-height: 150px; overflow-y: auto; }

.chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 8px; background: #2a2a2a; border: 1px solid #444; border-radius: 12px;
    color: #bbb; font-size: 13px; cursor: pointer;
}
.chip:hover { border-color: #666; color: white; }
.chip.on { background: #1a3a1a; border-color: #3a7a3a; color: #cfc; }
.chip.static { cursor: default; }
.chip .mark { width: 10px; text-align: center; }
.chip .gen-tag { color: #777; font-size: 11px; }
.chip .x {
    background: none; border: none; color: #888; cursor: pointer; font-size: 14px; padding: 0 0 0 2px; line-height: 1;
}
.chip .x:hover { color: #f66; }

.warning {
    display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
    padding: 6px 10px; border: 1px solid #7a6a2a; background: rgba(122, 106, 42, 0.15); border-radius: 4px;
    color: #ddc; font-size: 14px;
}

.assigned { flex: 1; min-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.group-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; color: #ddd; font-size: 15px; }

.empty { color: #888; font-style: italic; text-align: center; padding: 20px 0; }
.hint { font-size: 11px; color: #999; text-align: center; }
</style>
