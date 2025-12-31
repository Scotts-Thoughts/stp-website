<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGlobal, useWorkspace, useTierlist } from '../store';
import { getPokemonPokedexId } from '../utils/pokemon/pokedex';
import { getBaseSpeciesName, getFormNameForFile, getAlternativeMoveType, removeAlternativeMoveType } from '../utils/pokemon';

const props = withDefaults(defineProps<{
    pokemon: string,
    neighbor?: string,
    active?: boolean,
    noHover?: boolean,
    outline?: 1 | 1.5 | 2,
    height?: number,
}>(), {
    noHover: false,
    neighbor: '<none>',
    active: false,
    outline: 2,
    height: 87,
});

const global = useGlobal();
const tierlist = useTierlist();

const selected = computed(() => tierlist.selectedPkmn.has(props.pokemon))

const settings = computed(() => {
    const workspace = useWorkspace();
    // Use base Pokemon name (without alternative move type suffix) for settings lookup
    // so that "Blastoise" and "Blastoise-egg-moves" share the same settings
    const baseName = removeAlternativeMoveType(props.pokemon);
    return workspace.pokemonSettings[baseName] ?? {
        scale: 1,
        saturation: 1,
        offset: 0,
        flip: false,
        margins: {}
    };
});

const imageError = ref(false);

const imagePath = computed(() => {
    const imageSource = tierlist.activeTierlist.imageSource;
    // Remove alternative move type suffix before processing image path
    let pokemonName = removeAlternativeMoveType(imageError.value ? getBaseSpeciesName(props.pokemon) : props.pokemon);
    
    // Handle regional forms (space-separated, e.g., "Alolan Marowak" -> "Alolan-Marowak")
    const regionalPrefixes = ['Alolan', 'Galarian', 'Hisuian', 'Paldean'];
    const isRegionalForm = regionalPrefixes.some(prefix => pokemonName.startsWith(prefix + ' '));
    
    if (isRegionalForm) {
        // Convert all spaces to dashes for file naming: "Alolan Marowak" -> "Alolan-Marowak"
        // Also handles "Paldean Tauros (Combat Breed)" -> "Paldean-Tauros-(Combat-Breed)"
        pokemonName = pokemonName.replace(/\s+/g, '-');
    } else {
        // Handle regular dash-separated forms (e.g., "Deoxys-Attack")
        // But exclude alternative move type suffixes which we already removed
        const dashIndex = pokemonName.indexOf('-');
        if (dashIndex !== -1) {
            const baseName = pokemonName.substring(0, dashIndex);
            const formName = pokemonName.substring(dashIndex + 1);
            const formNameForFile = getFormNameForFile(formName);
            pokemonName = `${baseName}-${formNameForFile}`;
        }
    }
    
    if (imageSource) {
        if (imageSource === 'yellow-sprites') {
            const pokedexId = getPokemonPokedexId(tierlist.activeTierlist.game, pokemonName);
            if (pokedexId) {
                return `./images/${imageSource}/${pokedexId}.png`;
            }
            // Fallback to pokemon name if Pokedex ID not found
            return `./images/${imageSource}/${pokemonName}.png`;
        }
        return `./images/${imageSource}/${pokemonName}.png`;
    }
    return `./images/pokemon_thumbnail/${pokemonName}.png`;
});

function onImageError() {
    // If form-specific image fails, try base species name
    if (!imageError.value && props.pokemon !== getBaseSpeciesName(props.pokemon)) {
        imageError.value = true;
    }
}

// Reset error state when pokemon changes
watch(() => props.pokemon, () => {
    imageError.value = false;
});

const isYellowSprites = computed(() => {
    return tierlist.activeTierlist.imageSource === 'yellow-sprites';
});

const alternativeMoveType = computed(() => {
    return getAlternativeMoveType(props.pokemon);
});

const alternativeMoveIcon = computed(() => {
    if (!alternativeMoveType.value) return null;
    switch (alternativeMoveType.value) {
        case 'egg-moves':
            return './images/Egg.png';
        case 'event-pokemon':
            return './images/Disc.png';
        case 'cross-generation':
            return './images/LinkCable.png';
        default:
            return null;
    }
});

</script>


<template>
    <div :class="{
        'parent': true,
        'active': props.active && selected,
        'no-hover': props.noHover,
    }"
        :data-pokemon="props.pokemon"
        :style="{
            '--max-height': props.height + 'px',
            '--scale': settings.scale,
            '--saturation': settings.saturation,
            '--offset': settings.offset + 'px',
            '--margin': (settings.margins[neighbor] ?? 0) + 'px',
            '--flip': settings.flip ? 'scaleX(-1)' : 'scaleX(1)'
        }"
    >
        <div class="wrapper">
            <img v-if="!global.hidden" 
                :src="imagePath"
                @error="onImageError"
                :class="{
                    'pkmn-image': true,
                    [`outline${props.outline*10}`]: !isYellowSprites,
                }"
            />
            <div v-else
                class="pkmn-image"
            ></div>
            <img 
                v-if="alternativeMoveIcon" 
                :src="alternativeMoveIcon"
                class="alternative-move-icon"
            />
        </div>

        <slot></slot>
    </div>
</template>


<style scoped>
.parent {
    position: relative;
    --height: calc(var(--max-height) * var(--scale, 1));
    height: var(--height);
    transition: filter 0.2s;
    margin-bottom: var(--offset);
    margin-left: var(--margin);
}

.wrapper {
    position: relative;
}
.parent:not(.no-hover):hover .wrapper {
    filter: drop-shadow(0 0 6px rgba(0, 255, 255, 0.7));
    z-index: 100;
}
.parent:not(.no-hover):hover .pkmn-image {
    cursor: pointer;
}

.parent.active .wrapper {
    filter: drop-shadow(0 0 15px rgba(255, 255, 100, 0.7)) drop-shadow(0 0 10px rgba(255, 150, 115.2, 1)) !important;
    z-index: 101;
}

.pkmn-image.outline10 { filter: url(#outline10) saturate(var(--saturation)); }
.pkmn-image.outline15 { filter: url(#outline15) saturate(var(--saturation)); }
.pkmn-image.outline20 { filter: url(#outline20) saturate(var(--saturation)); }

.pkmn-image {
    height: var(--height);
    user-select: none;
    -webkit-user-drag: none;
    transform: var(--flip);
}

div.pkmn-image {
    background: #181818;
    border-radius: 10px;
    width: 80px;
}

.alternative-move-icon {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 40px;
    height: 40px;
    z-index: 10;
    image-rendering: pixelated;
}
</style>
