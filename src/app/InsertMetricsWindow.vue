<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import Window from '../components/Window.vue'

import { pokemonNames, getBaseSpeciesName, appendAlternativeMoveType } from '../utils/pokemon'
import { useWorkspace, useGlobal, useReranking, useToast } from '../store';
import { currentDate, parseDate, parseTime } from '../utils/time';

// Regional form prefixes
const REGIONAL_PREFIXES = ['Alolan', 'Galarian', 'Hisuian', 'Paldean'];

// Define Pokemon forms mapping
const pokemonForms: Record<string, string[]> = {
    // Regular forms
    "Deoxys": ["Normal", "Attack", "Defense", "Speed"],
    "Giratina": ["Altered", "Origin"],
    "Shaymin": ["Land", "Sky"],
    "Rotom": ["Rotom", "Heat", "Wash", "Frost", "Fan", "Mow"],
    "Shellos": ["West", "East"],
    "Gastrodon": ["West", "East"],
    "Basculin": ["Red-Striped", "Blue-Striped", "White-Striped"],
    "Tornadus": ["Incarnate", "Therian"],
    "Thundurus": ["Incarnate", "Therian"],
    "Landorus": ["Incarnate", "Therian"],
    "Enamorus": ["Incarnate", "Therian"],
    "Kyurem": ["Kyurem", "White", "Black"],
    "Keldeo": ["Ordinary", "Resolute"],
    "Meloetta": ["Aria", "Pirouette"],
    "Zygarde": ["10%", "50%", "100%"],
    "Hoopa": ["Confined", "Unbound"],
    "Oricorio": ["Baile Style", "Pom-Pom Style", "Pa'u Style", "Sensu Style"],
    "Lycanroc": ["Midday", "Midnight", "Dusk"],
    "Wishiwashi": ["Solo", "School"],
    "Necrozma": ["Necrozma", "Dusk Mane", "Dawn Wings", "Ultra"],
    "Toxtricity": ["Amped", "Low Key"],
    "Sinistea": ["Sinistea", "Phony", "Antique"],
    "Polteageist": ["Polteageist", "Phony", "Antique"],
    "Ursaluna": ["Ursaluna", "Bloodmoon"],
    // Alolan Forms
    "Rattata": ["Alolan"],
    "Raticate": ["Alolan"],
    "Raichu": ["Alolan"],
    "Sandshrew": ["Alolan"],
    "Sandslash": ["Alolan"],
    "Vulpix": ["Alolan"],
    "Ninetales": ["Alolan"],
    "Diglett": ["Alolan"],
    "Dugtrio": ["Alolan"],
    "Meowth": ["Alolan", "Galarian"],
    "Persian": ["Alolan"],
    "Geodude": ["Alolan"],
    "Graveler": ["Alolan"],
    "Golem": ["Alolan"],
    "Grimer": ["Alolan"],
    "Muk": ["Alolan"],
    "Exeggutor": ["Alolan"],
    "Marowak": ["Alolan"],
    // Galarian Forms
    "Ponyta": ["Galarian"],
    "Rapidash": ["Galarian"],
    "Slowpoke": ["Galarian"],
    "Slowbro": ["Galarian"],
    "Farfetch'd": ["Galarian"],
    "Weezing": ["Galarian"],
    "Mr. Mime": ["Galarian"],
    "Articuno": ["Galarian"],
    "Zapdos": ["Galarian"],
    "Moltres": ["Galarian"],
    "Slowking": ["Galarian"],
    "Corsola": ["Galarian"],
    "Zigzagoon": ["Galarian"],
    "Linoone": ["Galarian"],
    "Darumaka": ["Galarian"],
    "Darmanitan": ["Standard Mode", "Zen Mode", "Galarian"],
    "Yamask": ["Galarian"],
    "Stunfisk": ["Galarian"],
    // Hisuian Forms
    "Growlithe": ["Hisuian"],
    "Arcanine": ["Hisuian"],
    "Voltorb": ["Hisuian"],
    "Electrode": ["Hisuian"],
    "Typhlosion": ["Hisuian"],
    "Qwilfish": ["Hisuian"],
    "Sneasel": ["Hisuian"],
    "Samurott": ["Hisuian"],
    "Lilligant": ["Hisuian"],
    "Zorua": ["Hisuian"],
    "Zoroark": ["Hisuian"],
    "Braviary": ["Hisuian"],
    "Sliggoo": ["Hisuian"],
    "Goodra": ["Hisuian"],
    "Avalugg": ["Hisuian"],
    "Decidueye": ["Hisuian"],
    // Paldean Forms
    "Tauros": ["Combat Breed", "Blaze Breed", "Aqua Breed"],
    "Wooper": ["Paldean"],
};


const props = defineProps<{
    visible: boolean
}>();

defineEmits<{
    close: []
}>();

const GAMETIME_PATTERN = "(-1)|(([1-9]\\d*|0)(:\\d\\d){1,2})";
const REALTIME_PATTERN = "([1-9]\\d*|0)(:\\d\\d){1,2}(\\.\\d\\d)?";

// Calculate centered position for the window
const centeredPosition = computed(() => {
    const windowWidth = 400;
    const windowHeight = 500; // Use consistent height for centering
    
    const x = (window.innerWidth - windowWidth) / 2;
    const y = (window.innerHeight - windowHeight) / 2;
    
    return { x, y };
});

const pokemon = ref<string>("");
const pokemonSearch = ref<string>("");
const showPokemonDropdown = ref(false);
const pokemonForm = ref<string>("");
const alternativeMoveType = ref<string>("");
const releasedate = ref("1970-01-01");
const finished = ref<boolean>(true);
const gametime = ref<string>("0:00:00");
const realtime = ref<string>("0:00:00.00");
const level = ref<string>("-1");
const resets = ref<string>("-1");
const blackouts = ref<string>("-1");

// Get base Pokemon names (without forms) for the dropdown
const basePokemonNames = computed(() => {
    return pokemonNames.filter(name => {
        // Filter out forms that are already in the list
        const baseName = getBaseSpeciesName(name);
        // Only include if it's the base name or if it's not in our forms mapping
        return name === baseName || !pokemonForms[baseName];
    });
});

// Filtered Pokemon names based on search input
const filteredPokemonNames = computed(() => {
    const search = pokemonSearch.value.toLowerCase();
    if (!search) return basePokemonNames.value;
    return basePokemonNames.value.filter(name => name.toLowerCase().includes(search));
});

function selectPokemon(name: string) {
    pokemon.value = name;
    pokemonSearch.value = name;
    showPokemonDropdown.value = false;
}

function onPokemonSearchFocus() {
    showPokemonDropdown.value = true;
    pokemonSearch.value = "";
}

function onPokemonSearchBlur() {
    // Delay to allow click on dropdown item
    setTimeout(() => {
        showPokemonDropdown.value = false;
        if (!pokemon.value) {
            pokemonSearch.value = "";
        } else {
            pokemonSearch.value = pokemon.value;
        }
    }, 200);
}

function onPokemonSearchInput() {
    showPokemonDropdown.value = true;
    // Clear selection if user is typing something different
    if (pokemonSearch.value !== pokemon.value) {
        pokemon.value = "";
    }
}

// Get available forms for the selected Pokemon
const availableForms = computed(() => {
    if (!pokemon.value) return [];
    return pokemonForms[pokemon.value] || [];
});

// Check if the selected Pokemon has forms
const hasForms = computed(() => {
    return availableForms.value.length > 0;
});

// Get the final Pokemon name (with form if selected)
const finalPokemonName = computed(() => {
    if (!pokemon.value) return "";
    let name = "";
    if (pokemonForm.value && hasForms.value) {
        // Some species list themselves as one of their own forms (Kyurem, Rotom,
        // Necrozma, Sinistea, ...). That option means "the base form", so it must
        // resolve to the plain species name rather than "Kyurem-Kyurem".
        if (pokemonForm.value === pokemon.value) {
            name = pokemon.value;
        }
        // Special case for Paldean Tauros breeds
        else if (pokemon.value === "Tauros" && (pokemonForm.value === "Combat Breed" || pokemonForm.value === "Blaze Breed" || pokemonForm.value === "Aqua Breed")) {
            name = `Paldean ${pokemon.value} (${pokemonForm.value})`;
        } else {
            // Check if this is a regional form (starts with Alolan, Galarian, Hisuian, or Paldean)
            const isRegionalForm = REGIONAL_PREFIXES.some(prefix => pokemonForm.value.startsWith(prefix));
            if (isRegionalForm) {
                // Regional forms use space-separated format: "Alolan Marowak"
                name = `${pokemonForm.value} ${pokemon.value}`;
            } else {
                // Regular forms use dash-separated format: "Deoxys-Attack"
                name = `${pokemon.value}-${pokemonForm.value}`;
            }
        }
    } else {
        name = pokemon.value;
    }
    
    // Append alternative move type if selected
    const altMoveType = alternativeMoveType.value ? (alternativeMoveType.value as 'egg-moves' | 'event-pokemon' | 'cross-generation') : null;
    return appendAlternativeMoveType(name, altMoveType);
});

function reset() {
    pokemon.value = "";
    pokemonSearch.value = "";
    pokemonForm.value = "";
    alternativeMoveType.value = "";
    releasedate.value = currentDate();
    finished.value = true;
    gametime.value = "0:00:00";
    realtime.value = "0:00:00.00";
    level.value = "-1";
    resets.value = "-1";
    blackouts.value = "-1";
}

// Reset form when Pokemon changes
watch(() => pokemon.value, () => {
    pokemonForm.value = "";
});

watch(() => props.visible, (visible) => {
    if (visible) reset();
});

function insertMetric() {
    const workspace = useWorkspace();
    const gametimeRegex = new RegExp("^" + GAMETIME_PATTERN + "$");
    const realtimeRegex = new RegExp("^" + REALTIME_PATTERN + "$");

    if (pokemon.value === "") {
        alert("Please select a Pokemon");
        return;
    }

    if (!gametimeRegex.test(gametime.value)) {
        alert("Invalid game time format");
        return;
    }
    if (!realtimeRegex.test(realtime.value)) {
        alert("Invalid real time format");
        return;
    }

    const finalName = finalPokemonName.value;
    console.log("Inserting metric", finalName, finished.value, gametime.value, realtime.value, level.value, resets.value, blackouts.value);

    const attempt = {
        releasedate: parseDate(releasedate.value),
        finished: finished.value ? 1 : 0,
        gametime: parseTime(gametime.value),
        realtime: parseTime(realtime.value),
        level: parseInt(level.value, 10),
        resets: parseInt(resets.value, 10),
        blackouts: parseInt(blackouts.value, 10),
    };

    // If animate reranking is enabled, buffer instead of applying immediately
    const global = useGlobal();
    const rerankStore = useReranking();
    if (global.animateReranking && !rerankStore.isAnimating && !rerankStore.committing) {
        rerankStore.addPendingInsertion(finalName, attempt);
        const toastStore = useToast();
        toastStore.addToast(`Buffered ${finalName} — press Ctrl+F1 to animate`, 'warning', { timeout: 4000 });
    } else {
        workspace.insertActiveTierlistEntry(finalName, attempt);
    }
    reset();
}

function onTextareaChange(content: string) {
    const test = content.trim().split(",");
    pokemon.value = test[1];
    finished.value = true;
    gametime.value = test[7];
    realtime.value = test[3];
    level.value = test[6];
    resets.value = test[4];
    blackouts.value = test[5];
}

</script>


<template>
    <Window title="Insert Metrics" :visible="visible" :width="400" @close="$emit('close')" :custom-position="centeredPosition">
        <table>
            <tbody>
            <tr>
                <td>Pokemon</td>
                <td>
                    <div class="pokemon-search-container">
                        <input
                            type="text"
                            v-model="pokemonSearch"
                            placeholder="Search Pokemon..."
                            @focus="onPokemonSearchFocus"
                            @blur="onPokemonSearchBlur"
                            @input="onPokemonSearchInput"
                            autocomplete="off"
                        />
                        <div v-if="showPokemonDropdown" class="pokemon-dropdown">
                            <div
                                v-for="name in filteredPokemonNames"
                                :key="name"
                                class="pokemon-dropdown-item"
                                @mousedown.prevent="selectPokemon(name)"
                            >{{ name }}</div>
                            <div v-if="filteredPokemonNames.length === 0" class="pokemon-dropdown-item no-results">
                                No results
                            </div>
                        </div>
                    </div>
                </td>
            </tr>

            <tr v-if="hasForms">
                <td>Form</td>
                <td><select v-model="pokemonForm">
                    <option value="">-- Select Form --</option>
                    <option v-for="form in availableForms" :value="form">{{ form }}</option>
                </select></td>
            </tr>

            <tr>
                <td>Alternative Move Type</td>
                <td><select v-model="alternativeMoveType">
                    <option value="">-- None --</option>
                    <option value="egg-moves">Egg moves</option>
                    <option value="event-pokemon">Event Pokemon</option>
                    <option value="cross-generation">Cross Generation</option>
                </select></td>
            </tr>

            <tr><td colspan="2" height="14px"></td></tr>

            <tr>
                <td><label for="edit_metric_x0">Release Date</label></td>
                <td><input id="edit_metric_x0" type="date" v-model="releasedate"/></td>
            </tr>
            <tr>
                <td><label for="a">Finished</label></td>
                <td><input id="a" type="checkbox" v-model="finished"/></td>
            </tr>
            <tr>
                <td><label for="b">Game Time</label></td>
                <td><input id="b" type="text" v-model="gametime" :pattern="GAMETIME_PATTERN"/></td>
            </tr>
            <tr>
                <td><label for="c">Real Time</label></td>
                <td><input id="c" type="text" v-model="realtime" :pattern="REALTIME_PATTERN"/></td>
            </tr>
            <tr>
                <td><label for="d">Level</label></td>
                <td><input id="d" type="number" v-model="level" min="-1" max="100"/></td>
            </tr>
            <tr>
                <td><label for="e">Resets</label></td>
                <td><input id="e" type="number" v-model="resets" min="-1"/></td>
            </tr>
            <tr>
                <td><label for="g">Blackouts</label></td>
                <td><input id="g" type="number" v-model="blackouts" min="-1"/></td>
            </tr>

            <tr><td colspan="2" height="14px"></td></tr>

            <tr>
                <td></td>
                <td><button @click="insertMetric()">Insert</button></td>
            </tr>

            <tr><td colspan="2" height="24px"></td></tr>
            <tr><td colspan="2">Paste row from CSV:</td></tr>
            <tr><td colspan="2">
                <textarea
                    style="width: 100%; height: 80px;"
                    @input="(e) => onTextareaChange((e.target as any)?.value)"
                ></textarea>
            </td></tr>
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
}
input, select, button {
    padding: 5px 10px;
    height: 30px;
    width: 100%;
}
input:invalid {
    background-color: #f004;
}
.pokemon-search-container {
    position: relative;
}
.pokemon-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 200px;
    overflow-y: auto;
    background: field;
    color: fieldtext;
    border: 1px solid #666;
    z-index: 100;
}
.pokemon-dropdown-item {
    padding: 4px 10px;
    cursor: pointer;
    text-align: left;
}
.pokemon-dropdown-item:hover {
    background: highlight;
    color: highlighttext;
}
.pokemon-dropdown-item.no-results {
    cursor: default;
    color: #999;
    font-style: italic;
}
.pokemon-dropdown-item.no-results:hover {
    background: field;
    color: #999;
}
</style>
