<script setup lang="ts">
import { ref, watch } from 'vue';

import { useTierlist } from '../store';
import { debounced } from '../utils/debounced';

const tierlist = useTierlist();

const props = defineProps<{
    visible: boolean
}>();

defineEmits<{
    close: []
}>();

const pokemon = ref<string>("");
const inputRef = ref<HTMLInputElement | null>(null);

watch(() => props.visible, (visible) => {
    if (!visible) return;
    setTimeout(() => {
        if (!inputRef.value) return;
        inputRef.value.focus();
        inputRef.value.value = "";
    }, 0);
});

const onInput = debounced(() => {
    tierlist.activePkmn = "";
    tierlist.selectedPkmn.clear();

    const compValue = pokemon.value.toLocaleLowerCase().trim();
    if (compValue === "") {
        return;
    }

    for (const { pkmnName } of tierlist.activeFilteredAttempts) {
        if (pkmnName.toLocaleLowerCase().startsWith(compValue)) {
            tierlist.selectedPkmn.add(pkmnName);
        }
    }
}, 300);

</script>


<template>
    <div :class="'window ' + (visible ? '' : 'hidden')">
        <input
            type="text" ref="inputRef" placeholder="Pokemon" 
            v-model="pokemon"
            @input="onInput"
            @keyup.enter="$emit('close')"
            @keyup.esc="$emit('close')"
            @blur.stop="$emit('close')"
        />
    </div>
</template>


<style scoped>
.window {
    position: fixed;
    width: 400px;
    left: calc((1920px - 400px) / 2);
    top: calc((1080px - 30px) / 2);
    z-index: 200;

    overflow: hidden;

    background-color: #333a;
    border-radius: 10px;
    box-shadow: 0 10px 25px #000, 0 10px 25px -10px #000;
    text-shadow: 0 0 1px #000;
    backdrop-filter: blur(5px);
}

.window.hidden {
    visibility: hidden;
}

.window input {
    width: 100%;
    font-size: 24px;
    padding: 10px 20px;
    font-family: Consolas, monospace;
    font-size: 24px;
    border: none;
    outline: none;
    background-color: transparent;
    color: #fff;
}
</style>
