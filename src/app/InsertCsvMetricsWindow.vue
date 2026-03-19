<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import Window from '../components/Window.vue'
import { useWorkspace, useGlobal, useReranking, useToast } from '../store';
import { parseTime, parseGameTime, parseDate, currentDate } from '../utils/time';
import { getBaseSpeciesName, appendAlternativeMoveType } from '../utils/pokemon';

// Regional form prefixes
const REGIONAL_PREFIXES = ['Alolan', 'Galarian', 'Hisuian', 'Paldean'];

// Define Pokemon forms mapping (same as InsertMetricsWindow)
const pokemonForms: Record<string, string[]> = {
    // Regular forms
    "Deoxys"     : ["Normal", "Attack", "Defense", "Speed"],
    "Giratina"   : ["Altered", "Origin"],
    "Shaymin"    : ["Land", "Sky"],
    "Rotom"      : ["Rotom", "Heat", "Wash", "Frost", "Fan", "Mow"],
    "Shellos"    : ["West", "East"],
    "Gastrodon"  : ["West", "East"],
    "Basculin"   : ["Red-Striped", "Blue-Striped", "White-Striped"],
    "Tornadus"   : ["Incarnate", "Therian"],
    "Thundurus"  : ["Incarnate", "Therian"],
    "Landorus"   : ["Incarnate", "Therian"],
    "Enamorus"   : ["Incarnate", "Therian"],
    "Kyurem"     : ["Kyurem", "White", "Black"],
    "Keldeo"     : ["Ordinary", "Resolute"],
    "Meloetta"   : ["Aria", "Pirouette"],
    "Zygarde"    : ["10%", "50%", "100%"],
    "Hoopa"      : ["Confined", "Unbound"],
    "Oricorio"   : ["Baile Style", "Pom-Pom Style", "Pa'u Style", "Sensu Style"],
    "Lycanroc"   : ["Midday", "Midnight", "Dusk"],
    "Wishiwashi" : ["Solo", "School"],
    "Necrozma"   : ["Necrozma", "Dusk Mane", "Dawn Wings", "Ultra"],
    "Toxtricity" : ["Amped", "Low Key"],
    "Sinistea"   : ["Sinistea", "Phony", "Antique"],
    "Polteageist": ["Polteageist", "Phony", "Antique"],
    "Ursaluna"   : ["Ursaluna", "Bloodmoon"],
    // Alolan Forms
    "Rattata"  : ["Alolan"],
    "Raticate" : ["Alolan"],
    "Raichu"   : ["Alolan"],
    "Sandshrew": ["Alolan"],
    "Sandslash": ["Alolan"],
    "Vulpix"   : ["Alolan"],
    "Ninetales": ["Alolan"],
    "Diglett"  : ["Alolan"],
    "Dugtrio"  : ["Alolan"],
    "Meowth"   : ["Alolan", "Galarian"],
    "Persian"  : ["Alolan"],
    "Geodude"  : ["Alolan"],
    "Graveler" : ["Alolan"],
    "Golem"    : ["Alolan"],
    "Grimer"   : ["Alolan"],
    "Muk"      : ["Alolan"],
    "Exeggutor": ["Alolan"],
    "Marowak"  : ["Alolan"],
      // Galarian Forms
    "Ponyta"    : ["Galarian"],
    "Rapidash"  : ["Galarian"],
    "Slowpoke"  : ["Galarian"],
    "Slowbro"   : ["Galarian"],
    "Farfetch'd": ["Galarian"],
    "Weezing"   : ["Galarian"],
    "Mr. Mime"  : ["Galarian"],
    "Articuno"  : ["Galarian"],
    "Zapdos"    : ["Galarian"],
    "Moltres"   : ["Galarian"],
    "Slowking"  : ["Galarian"],
    "Corsola"   : ["Galarian"],
    "Zigzagoon" : ["Galarian"],
    "Linoone"   : ["Galarian"],
    "Darumaka"  : ["Galarian"],
    "Darmanitan": ["Standard Mode", "Zen Mode", "Galarian"],
    "Yamask"    : ["Galarian"],
    "Stunfisk"  : ["Galarian"],
      // Hisuian Forms
    "Growlithe" : ["Hisuian"],
    "Arcanine"  : ["Hisuian"],
    "Voltorb"   : ["Hisuian"],
    "Electrode" : ["Hisuian"],
    "Typhlosion": ["Hisuian"],
    "Qwilfish"  : ["Hisuian"],
    "Sneasel"   : ["Hisuian"],
    "Samurott"  : ["Hisuian"],
    "Lilligant" : ["Hisuian"],
    "Zorua"     : ["Hisuian"],
    "Zoroark"   : ["Hisuian"],
    "Braviary"  : ["Hisuian"],
    "Sliggoo"   : ["Hisuian"],
    "Goodra"    : ["Hisuian"],
    "Avalugg"   : ["Hisuian"],
    "Decidueye" : ["Hisuian"],
    // Paldean Forms
    "Tauros": ["Combat Breed", "Blaze Breed", "Aqua Breed"],
    "Wooper": ["Paldean"],
};

const props = defineProps<{
    visible: boolean
    initialFile?: File | null
    cachedDate?: string
}>();

const emit = defineEmits<{
    close: []
    imported: [date: string]
}>();

const selectedFile = ref<File | null>(null);
const fileContent = ref<string>("");
const parsedData = ref<any[]>([]);
const errorMessage = ref<string>("");
const runDate = ref<string>("");
const pokemonForm = ref<string>("");
const alternativeMoveType = ref<string>("");

// Editable metric values (populated from CSV, user can override)
const editRealtime = ref<string>("");
const editGametime = ref<string>("");
const editLevel = ref<string>("");
const editResets = ref<string>("");
const editBlackouts = ref<string>("");
const editPokemonSpecies = ref<string>("");

// Calculate centered position for the window
const centeredPosition = computed(() => {
    const windowWidth = 600;
    const windowHeight = 300; // Match Edit View height for consistent positioning
    
    const x = (window.innerWidth - windowWidth) / 2;
    const y = (window.innerHeight - windowHeight) / 2;
    
    return { x, y };
});

function reset() {
    selectedFile.value = null;
    fileContent.value = "";
    parsedData.value = [];
    errorMessage.value = "";
    runDate.value = (props.initialFile && props.cachedDate) ? props.cachedDate : currentDate();
    pokemonForm.value = "";
    alternativeMoveType.value = "";
    editRealtime.value = "";
    editGametime.value = "";
    editLevel.value = "";
    editResets.value = "";
    editBlackouts.value = "";
    editPokemonSpecies.value = "";
}

// Get the base Pokemon name from the editable species field
const basePokemonName = computed(() => {
    if (!editPokemonSpecies.value) {
        return "";
    }
    return getBaseSpeciesName(editPokemonSpecies.value);
});

// Get available forms for the parsed Pokemon
const availableForms = computed(() => {
    if (!basePokemonName.value) return [];
    return pokemonForms[basePokemonName.value] || [];
});

// Check if the parsed Pokemon has forms
const hasForms = computed(() => {
    return availableForms.value.length > 0;
});

// Get the final Pokemon name (with form if selected)
const finalPokemonName = computed(() => {
    let name = "";
    if (!basePokemonName.value) {
        name = editPokemonSpecies.value || "";
    } else if (pokemonForm.value && hasForms.value) {
        // Special case for Paldean Tauros breeds
        if (basePokemonName.value === "Tauros" && (pokemonForm.value === "Combat Breed" || pokemonForm.value === "Blaze Breed" || pokemonForm.value === "Aqua Breed")) {
            name = `Paldean ${basePokemonName.value} (${pokemonForm.value})`;
        } else {
            // Check if this is a regional form (starts with Alolan, Galarian, Hisuian, or Paldean)
            const isRegionalForm = REGIONAL_PREFIXES.some(prefix => pokemonForm.value.startsWith(prefix));
            if (isRegionalForm) {
                // Regional forms use space-separated format: "Alolan Marowak"
                name = `${pokemonForm.value} ${basePokemonName.value}`;
            } else {
                // Regular forms use dash-separated format: "Deoxys-Attack"
                name = `${basePokemonName.value}-${pokemonForm.value}`;
            }
        }
    } else {
        // If the species field already has a form in the name, use it; otherwise use base name
        const speciesValue = editPokemonSpecies.value || "";
        if (speciesValue.includes('-') || speciesValue.includes('(') || speciesValue.includes('Alolan') || speciesValue.includes('Galarian') || speciesValue.includes('Hisuian') || speciesValue.includes('Paldean')) {
            // Already has form notation, use it
            name = speciesValue;
        } else {
            name = basePokemonName.value;
        }
    }
    
    // Append alternative move type if selected
    const altMoveType = alternativeMoveType.value ? (alternativeMoveType.value as 'egg-moves' | 'event-pokemon' | 'cross-generation') : null;
    return appendAlternativeMoveType(name, altMoveType);
});

// Reset form when parsed data changes
watch(() => parsedData.value, () => {
    pokemonForm.value = "";
});

watch(() => props.visible, async (visible) => {
    if (visible) {
        reset();
        // If an initial file was provided (e.g. via drag-and-drop), load it automatically
        if (props.initialFile) {
            await loadFile(props.initialFile);
        }
    }
});

async function loadFile(file: File) {
    // Check if filename contains "simple"
    if (!file.name.toLowerCase().includes('simple')) {
        errorMessage.value = "File must contain 'simple' in its name";
        return;
    }

    selectedFile.value = file;
    errorMessage.value = "";

    // Read file content
    const content = await file.text();
    fileContent.value = content;

    // Parse CSV
    parseCsvData(content);
}

async function selectFile() {
    try {
        const fileHandle = await window.showOpenFilePicker({
            types: [{
                description: 'CSV files',
                accept: {
                    'text/csv': ['.csv']
                }
            }]
        });

        const file = await fileHandle[0].getFile();
        await loadFile(file);

    } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
            errorMessage.value = "Error selecting file: " + error.message;
        }
    }
}

function parseCsvData(content: string) {
    try {
        const lines = content.trim().split('\n');
        if (lines.length < 2) {
            errorMessage.value = "CSV file must have at least a header and one data row";
            return;
        }
        
        const headers = lines[0].split(',').map(h => h.trim()).filter(h => h !== ''); // Remove empty headers from trailing commas
        
        // Find the last non-empty data row
        let lastDataRow = null;
        for (let i = lines.length - 1; i >= 1; i--) {
            const line = lines[i].trim();
            if (line) {
                lastDataRow = line;
                break;
            }
        }
        
        if (!lastDataRow) {
            errorMessage.value = "No data rows found in CSV file";
            return;
        }
        
        const values = lastDataRow.split(',').map(v => v.trim()).filter(v => v !== ''); // Remove empty values from trailing commas
        
        // Check if we have enough columns for the required fields
        if (values.length < headers.length) {
            console.warn(`Last row has ${values.length} columns, header has ${headers.length} columns. This is common with trailing commas.`);
        }
        
        const row: any = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || ''; // Use empty string if value doesn't exist
        });
        
        parsedData.value = [row]; // Only store the last row
        errorMessage.value = "";

        // Populate editable fields from parsed data
        editPokemonSpecies.value = row.pokemon || "";
        editRealtime.value = row.real_time_hmmss || "";
        editGametime.value = row.game_time || "";
        editLevel.value = row.level || "";
        editResets.value = row.resets || "";
        editBlackouts.value = row.blackouts || "";

        // Debug: log the parsed data to help troubleshoot
        console.log("Parsed CSV data:", row);
        console.log("Available columns:", Object.keys(row));
        
    } catch (error) {
        errorMessage.value = "Error parsing CSV: " + (error instanceof Error ? error.message : String(error));
    }
}

async function importMetrics() {
    if (parsedData.value.length === 0) {
        errorMessage.value = "No data to import";
        return;
    }
    
    const workspace = useWorkspace();
    const row = parsedData.value[0]; // Only one row (the last row)
    
    try {
        // Validate required fields using editable values
        const missingFields = [];
        if (!editPokemonSpecies.value && !finalPokemonName.value) missingFields.push("pokemon");
        if (!editRealtime.value) missingFields.push("real_time_hmmss");
        if (!editGametime.value) missingFields.push("game_time");

        if (missingFields.length > 0) {
            errorMessage.value = `Missing required fields: ${missingFields.join(", ")}`;
            return;
        }

        if (!runDate.value) {
            errorMessage.value = "Please select a run date";
            return;
        }

        // Use the editable values (user may have corrected them)
        const pokemon = finalPokemonName.value;
        const realtime = editRealtime.value;
        const gametime = editGametime.value;
        const level = parseInt(editLevel.value) || -1;
        const resets = parseInt(editResets.value) || -1;
        const blackouts = parseInt(editBlackouts.value) || -1;

        const attempt = {
            releasedate: parseDate(runDate.value),
            finished: 1, // Assume all imported metrics are finished
            gametime: parseGameTime(gametime),
            realtime: parseTime(realtime),
            level: level,
            resets: resets,
            blackouts: blackouts,
        };

        // If animate reranking is enabled, buffer instead of applying immediately
        const global = useGlobal();
        const rerankStore = useReranking();
        if (global.animateReranking && !rerankStore.isAnimating && !rerankStore.committing) {
            rerankStore.addPendingInsertion(pokemon, attempt);
            const toastStore = useToast();
            toastStore.addToast(`Buffered ${pokemon} — press Ctrl+F1 to animate`, 'warning', { timeout: 4000 });
        } else {
            workspace.insertActiveTierlistEntry(pokemon, attempt);
        }

        // Notify parent of the import (with the date for caching)
        emit('imported', runDate.value);

        // If opened via drag-and-drop, auto-close after import
        if (props.initialFile) {
            emit('close');
            return;
        }

        errorMessage.value = global.animateReranking
            ? `Buffered ${pokemon} — press Ctrl+F1 to animate`
            : `Successfully imported metrics for ${pokemon} (${runDate.value})`;

    } catch (error) {
        console.error("Error importing metrics:", row, error);
        errorMessage.value = `Failed to import metrics: ${error instanceof Error ? error.message : String(error)}`;
    }
}

</script>

<template>
    <Window title="Import Metrics from CSV" :visible="visible" :width="600" @close="$emit('close')" :custom-position="centeredPosition">
        <div style="display: flex; flex-direction: column; gap: 16px;">
            <div>
                <button @click="selectFile" style="margin-bottom: 8px;">
                    {{ selectedFile ? 'Select Different File' : 'Select CSV File' }}
                </button>
                <div v-if="selectedFile" style="font-size: 14px; color: #666; margin-bottom: 16px;">
                    Selected: {{ selectedFile.name }}
                </div>
            </div>
            
            <div v-if="selectedFile">
                <label for="run-date" style="display: block; margin-bottom: 4px; font-weight: bold;">Run Date:</label>
                <input 
                    id="run-date" 
                    type="date" 
                    v-model="runDate" 
                    style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; width: 100%;"
                />
            </div>
            
            <div v-if="hasForms && parsedData.length > 0">
                <label for="pokemon-form" style="display: block; margin-bottom: 4px; font-weight: bold;">Form:</label>
                <select 
                    id="pokemon-form" 
                    v-model="pokemonForm"
                    style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; width: 100%;"
                >
                    <option value="">-- Select Form --</option>
                    <option v-for="form in availableForms" :key="form" :value="form">{{ form }}</option>
                </select>
            </div>
            
            <div v-if="parsedData.length > 0">
                <label for="alternative-move-type" style="display: block; margin-bottom: 4px; font-weight: bold;">Alternative Move Type:</label>
                <select 
                    id="alternative-move-type" 
                    v-model="alternativeMoveType"
                    style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; width: 100%;"
                >
                    <option value="">-- None --</option>
                    <option value="egg-moves">Egg moves</option>
                    <option value="event-pokemon">Event Pokemon</option>
                    <option value="cross-generation">Cross Generation</option>
                </select>
            </div>
            
            <div v-if="errorMessage" style="color: #ff6b6b; font-size: 14px; padding: 8px; background: #ffe0e0; border-radius: 4px;">
                {{ errorMessage }}
            </div>
            
            <div v-if="parsedData.length > 0">
                <h3>Final Row Data:</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div style="grid-column: 1 / -1;">
                        <label class="field-label">Pokemon{{ hasForms && pokemonForm ? ` (→ ${finalPokemonName})` : '' }}</label>
                        <input class="field-input" v-model="editPokemonSpecies" placeholder="Pokemon name" />
                    </div>
                    <div>
                        <label class="field-label">Real Time</label>
                        <input class="field-input" v-model="editRealtime" placeholder="H:MM:SS.xx" />
                    </div>
                    <div>
                        <label class="field-label">Game Time</label>
                        <input class="field-input" v-model="editGametime" placeholder="H:MM:SS" />
                    </div>
                    <div>
                        <label class="field-label">Level</label>
                        <input class="field-input" v-model="editLevel" type="number" placeholder="0" />
                    </div>
                    <div>
                        <label class="field-label">Resets</label>
                        <input class="field-input" v-model="editResets" type="number" placeholder="0" />
                    </div>
                    <div>
                        <label class="field-label">Blackouts</label>
                        <input class="field-input" v-model="editBlackouts" type="number" placeholder="0" />
                    </div>
                </div>
            </div>
            
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button @click="$emit('close')">Cancel</button>
                <button 
                    @click="importMetrics" 
                    :disabled="parsedData.length === 0"
                    style="background: #4CAF50; color: white; border: none; padding: 8px 16px; border-radius: 4px;"
                >
                    Import Final Row
                </button>
            </div>
        </div>
    </Window>
</template>

<style scoped>
button {
    padding: 8px 16px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    color: black;
    cursor: pointer;
}

button:hover {
    background: #f5f5f5;
    color: black;
}

button:disabled {
    background: #f0f0f0;
    color: #999;
    cursor: not-allowed;
}

.field-label {
    display: block;
    margin-bottom: 2px;
    font-size: 12px;
    color: #999;
}

.field-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #555;
    border-radius: 4px;
    background: #2a2a2a;
    color: #fff;
    font-size: 14px;
    font-family: Consolas, monospace;
    box-sizing: border-box;
}

.field-input:focus {
    outline: none;
    border-color: #4CAF50;
}
</style>
