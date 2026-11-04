<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import Window from '../components/Window.vue'
import { isTypingTarget, useShortcuts, useTierlist, useWorkspace } from '../store';
import { useEventListener } from '@vueuse/core';
import { removeAlternativeMoveType } from '../utils/pokemon';
import { MARGIN_MIN, MARGIN_MAX } from '../utils/auto-margin';
import { autoMarginSelected, autoMarginWholeTierlist, resetAllStyleWholeTierlist, resetStyleWholeTierlist } from '../store/style-actions';


const VIEW_PROPERTY_MAP = {
    'scale': {
        label: 'Scale',
        min: 0.5,
        max: 1,
        step: 0.05,
        shiftStep: 0.01,
        incAction: 'scale-inc',
        decAction: 'scale-dec',
        format: (v: number) => "" + ((v * 100) | 0),
    },
    'offset': {
        label: 'Offset',
        min: 0,
        max: 50,
        step: 5,
        shiftStep: 1,
        incAction: 'offset-inc',
        decAction: 'offset-dec',
        format: (v: number) => (v | 0) + 'px',
    },
    'saturation': {
        label: 'Sat',
        min: 0.5,
        max: 2,
        step: 0.05,
        shiftStep: 0.01,
        incAction: 'saturation-inc',
        decAction: 'saturation-dec',
        format: (v: number) => v.toFixed(2),
    },
    'margin': {
        label: 'Margin',
        min: MARGIN_MIN,
        max: MARGIN_MAX,
        step: 1,
        shiftStep: 1,
        incAction: 'margin-inc',
        decAction: 'margin-dec',
        format: (v: number) => (v | 0) + 'px',
    },
    'flip': {
        label: 'Flip',
        min: 0,
        max: 1,
        step: 1,
        shiftStep: 1,
        incAction: 'flip-inc',
        decAction: 'flip-dec',
        format: (v: number) => v === 1 ? 'Yes' : 'No',
    },
};
type ViewPropertyKey = keyof typeof VIEW_PROPERTY_MAP;


const props = defineProps<{
    visible: boolean
}>();

defineEmits<{
    close: []
}>();

const workspace = useWorkspace();
const tierlist = useTierlist();
const shortcuts = useShortcuts();

function keyHint(property: { incAction: string, decAction: string }) {
    const keys = [property.incAction, property.decAction].map(shortcuts.bindingOf).filter(Boolean);
    return keys.length ? `(${keys.join('/')})` : '';
}

const customPosition = ref<{ x: number, y: number } | null>(null);

const viewSettings = computed(() => {
    const pkmn = tierlist.activePkmn;
    const prev = tierlist.activePrev;
    if (pkmn === '') return;
    // Use base Pokemon name (without alternative move type suffix) for settings lookup
    // so that "Blastoise" and "Blastoise-egg-moves" share the same settings
    const baseName = removeAlternativeMoveType(pkmn);
    const setting = workspace.pokemonSettings[baseName];
    return {
        name: pkmn,
        margin: setting?.margins[prev] ?? 0,
        scale: setting?.scale ?? 1,
        saturation: setting?.saturation ?? 0,
        offset: setting?.offset ?? 0,
        flip: (setting?.flip ?? false) ? 1 : 0,
    };
});

function updateViewSettings(key: ViewPropertyKey, updater: (oldValue: number) => number) {
    const pkmn = tierlist.activePkmn;
    const prev = tierlist.activePrev;
    if (pkmn === '') return;

    // Use base Pokemon name (without alternative move type suffix) for settings lookup
    // so that "Blastoise" and "Blastoise-egg-moves" share the same settings
    const baseName = removeAlternativeMoveType(pkmn);
    if (workspace.pokemonSettings[baseName] === undefined) {
        workspace.pokemonSettings[baseName] = {
            scale: 1,
            saturation: 1,
            offset: 0,
            flip: false,
            margins: {}
        };
    }
    const setting = workspace.pokemonSettings[baseName]!;

    let oldValue = (key === 'margin') ? (setting.margins[prev] ?? 0) : 
                   (key === 'flip') ? ((setting[key] as boolean) ? 1 : 0) : 
                   (setting[key] as number);
    let newValue = updater(oldValue);

    if (key === 'margin') {
        setting.margins[prev] = newValue;
    } else if (key === 'flip') {
        setting[key] = newValue === 1;
    } else {
        setting[key] = newValue;
    }

    const scale = setting.scale;
    const offset = setting.offset;
    const maxOffset = (87 * (1-scale));
    if (offset > maxOffset) {
        setting.offset = maxOffset;
    }
}


function inputHandler(e: Event, key: ViewPropertyKey) {
    const target = e.target as HTMLInputElement;
    let value = parseFloat(target.value);
    updateViewSettings(key, () => value);
}

function switchHandler(e: Event) {
    const target = e.target as HTMLInputElement;
    const value = target.checked ? 1 : 0;
    updateViewSettings('flip', () => value);
}

const WINDOW_HEIGHT = 420; // Estimated height

function calculateCenterPosition() {
    const windowWidth = 400;
    const windowHeight = WINDOW_HEIGHT;
    
    const x = (window.innerWidth - windowWidth) / 2;
    const y = (window.innerHeight - windowHeight) / 2;
    
    return { x, y };
}

function calculateSmartPosition() {
    const activePkmn = tierlist.activePkmn;
    
    // Check if there's exactly one Pokemon selected
    if (!activePkmn || tierlist.selectedPkmn.size !== 1) {
        // Center the window when no Pokemon is selected
        customPosition.value = calculateCenterPosition();
        return;
    }

    // Find the selected Pokemon element directly by data attribute
    const pkmnElement = document.querySelector(`[data-pokemon="${activePkmn}"]`) as HTMLElement;
    if (!pkmnElement) {
        customPosition.value = calculateCenterPosition();
        return;
    }

    // Find the tier row containing this Pokemon
    const tierRow = pkmnElement.closest('.entry-row') as HTMLElement;
    if (!tierRow) {
        customPosition.value = calculateCenterPosition();
        return;
    }

    // Get the Pokemon element bounds for horizontal alignment
    const pkmnRect = pkmnElement.getBoundingClientRect();
    const tierRect = tierRow.getBoundingClientRect();
    const windowWidth = 400; // EditViewWindow width
    const windowHeight = WINDOW_HEIGHT;
    const paddingBelow = 5; // Padding when window appears below Pokemon
    const paddingAbove = 25; // Account for dropshadow - more aggressive negative padding to bring window closer when above Pokemon

    // Calculate horizontal position - center the window horizontally on the Pokemon
    let x = pkmnRect.left + (pkmnRect.width - windowWidth) / 2;
    let y: number;

    // Check space above and below the tier row
    const spaceBelow = window.innerHeight - tierRect.bottom;
    const spaceAbove = tierRect.top;

    // Always prefer placing below the tier row first, then above
    if (spaceBelow >= windowHeight + Math.abs(paddingBelow)) {
        // Place directly below the tier row
        y = tierRect.bottom + paddingBelow;
    } else if (spaceAbove >= windowHeight + Math.abs(paddingAbove)) {
        // Place directly above the tier row
        y = tierRect.top - windowHeight + paddingAbove;
    } else {
        // Not enough space above or below, use center positioning
        customPosition.value = calculateCenterPosition();
        return;
    }

    // Ensure the window stays within viewport bounds
    x = Math.max(10, Math.min(x, window.innerWidth - windowWidth - 10));
    y = Math.max(10, Math.min(y, window.innerHeight - windowHeight - 10));

    customPosition.value = { x, y };
}

// Watch for when the window becomes visible to calculate position
watch(() => props.visible, async (visible) => {
    if (visible) {
        // Calculate position immediately when window is about to show
        calculateSmartPosition();
        
        // Also recalculate after DOM updates in case the first calculation missed something
        await nextTick();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                calculateSmartPosition();
            });
        });
    }
});

// Watch for changes in active Pokemon to recalculate position
watch(() => tierlist.activePkmn, async () => {
    // Always calculate position when Pokemon changes, regardless of window visibility
    // This ensures the position is ready when the window becomes visible
    calculateSmartPosition();
    
    if (props.visible) {
        await nextTick();
        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                calculateSmartPosition();
            });
        });
    }
});

// Watch for changes in selected Pokemon set to recalculate position
watch(() => Array.from(tierlist.selectedPkmn), async () => {
    // Always calculate position when selection changes, regardless of window visibility
    // This ensures the position is ready when the window becomes visible
    calculateSmartPosition();
    
    if (props.visible) {
        await nextTick();
        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                calculateSmartPosition();
            });
        });
    }
});

// Capture phase: while this window is open its keys win over the same keys on the tier
// list (F is Margin Down here, Edit Filter there).
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (!props.visible || isTypingTarget(e.target)) return;

    for (const [key, property] of Object.entries(VIEW_PROPERTY_MAP)) {
        const dir = shortcuts.matches(property.incAction, e, { shiftIsFine: true }) ?  1 :
                    shortcuts.matches(property.decAction, e, { shiftIsFine: true }) ? -1 : 0;
        if (dir !== 0) {
            updateViewSettings(key as any, (value) => {
                value += dir * (e.shiftKey ? property.shiftStep : property.step);
                if (value < property.min) value = property.min;
                if (value > property.max) value = property.max;
                return value;
            })
            e.preventDefault();
            e.stopPropagation();
            return;
        }
    }
}, { capture: true });
</script>


<template>
    <Window class="edit-view-window" title="Edit View" :visible="visible" :width="400" :custom-position="customPosition" @close="$emit('close')">
        <div v-if="viewSettings === undefined" style="width: 100%; text-align: center; padding: 20px;">
            Select a Pokemon to edit view settings
        </div>
        <template v-else>
            <div style="text-align: center;">{{ viewSettings.name }}</div>
            <br>

            <div v-for="(property, key) in VIEW_PROPERTY_MAP" style="padding-bottom: 10px;">
                {{ (property.label + ":").padEnd(8).replace(/ /g, '&nbsp;') }}
                <template v-if="key === 'flip'">
                    <label class="switch">
                        <input type="checkbox" :checked="viewSettings[key] === 1" @change="switchHandler" />
                        <span class="slider"></span>
                    </label>&nbsp;&nbsp;
                    {{ property.format(viewSettings[key]) }} {{ keyHint(property) }}
                </template>
                <template v-else>
                    <input :value="viewSettings[key]" @input="e => inputHandler(e, key)" type="range" :min="property.min" :max="property.max" :step="property.shiftStep" />&nbsp;&nbsp;
                    {{ property.format(viewSettings[key]) }} {{ keyHint(property) }}
                    <button v-if="key === 'margin'" class="auto-btn" :disabled="!tierlist.activePrev"
                        title="Space from the art, like a newly added Pokemon" @click="autoMarginSelected">Auto</button>
                </template>
            </div>
        </template>

        <div class="whole-list">
            <div class="whole-list-title">Whole tier list</div>
            <button title="Replace every margin on this tier list with one worked out from the art" @click="autoMarginWholeTierlist">Auto Margins</button>
            <button @click="resetStyleWholeTierlist('scale')">Reset Scale</button>
            <button @click="resetStyleWholeTierlist('offset')">Reset Offset</button>
            <button @click="resetStyleWholeTierlist('saturation')">Reset Sat</button>
            <button @click="resetStyleWholeTierlist('flip')">Reset Flip</button>
            <button title="Reset scale, offset, saturation and flip, then apply auto margins" @click="resetAllStyleWholeTierlist">Reset All</button>
        </div>
    </Window>
</template>


<style scoped>
.auto-btn {
  margin-left: 6px;
  padding: 1px 8px;
  font-size: 0.85em;
  cursor: pointer;
}
.auto-btn:disabled {
  cursor: default;
  opacity: 0.4;
}

.whole-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid #fff3;
}
.whole-list-title {
  grid-column: 1 / -1;
  font-size: 0.85em;
  color: #bbb;
}
.whole-list button {
  padding: 3px 0;
  font-size: 0.8em;
  cursor: pointer;
}

/* Switch styles */
.switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: background-color 0.2s ease;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: transform 0.2s ease;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #2196F3;
}

input:focus + .slider {
  box-shadow: 0 0 1px #2196F3;
}

input:checked + .slider:before {
  transform: translateX(26px);
}

/* Ensure switch disappears immediately when parent window is hidden */
:global(.window.hidden) .switch {
  visibility: hidden;
}

:global(.window.hidden) .switch .slider {
  transition: none !important;
}

:global(.window.hidden) .switch .slider:before {
  transition: none !important;
}
</style>
