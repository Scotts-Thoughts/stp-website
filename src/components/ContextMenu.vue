<script setup lang="ts">
import { computed, ref } from 'vue';
import { useElementSize, onClickOutside, onKeyStroke } from '@vueuse/core';

import { ContextMenuOption, isTypingTarget, useContextMenu, useShortcuts } from '../store';

const el = ref(null)
const { width, height } = useElementSize(el)

const contextMenu = useContextMenu();
const shortcuts = useShortcuts();

const position = computed(() => {
    let x = contextMenu.pos.x;
    let y = contextMenu.pos.y;

    // Use actual viewport dimensions with padding to keep menu away from edges
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 10; // pixels of padding from screen edges

    if (x + width.value > viewportWidth - padding) x -= width.value;
    if (y + height.value > viewportHeight - padding) y -= height.value;
    
    // Ensure menu doesn't go off the left or top edges either
    if (x < padding) x = padding;
    if (y < padding) y = padding;
    
    return { x, y };
});

onClickOutside(el, () => {
    contextMenu.hide();
})

onKeyStroke((e) => {
    if (e.target !== document.body) return;
    if (e.key === 'Escape') {
        contextMenu.hide();
    }
})

onKeyStroke((e) => {
    // Allow shortcuts when document body has focus OR when inside a popup overlay, or
    // Edit View, where a slider or button keeps the focus after it has been used.
    const target = e.target as Element;
    const isInPopup = target?.closest('.quick-calendar-overlay');
    const isInEditView = target?.closest('.edit-view-window') && !isTypingTarget(target);
    if (e.target !== document.body && !isInPopup && !isInEditView) return;
    if (!contextMenu.shortcutsActive) return;

    for (const option of contextMenu.options) {
        if (option.hidden || !option.id) continue;
        if (shortcuts.matches(option.id, e)) {
            const result = option.action();
            if (result === false) return;
            e.preventDefault();
            return;
        }
    }
})

function callAction(option: ContextMenuOption) {
    option.action();
    contextMenu.hide();
}

</script>


<template>
    <div class="context-menu" :style="{
        visibility: contextMenu.isVisible ? 'visible' : 'hidden',
        left: position.x + 'px',
        top: position.y + 'px',
    }" ref="el">
        <template v-for="option in contextMenu.options">
            <hr v-if="option.label === ''"/>
            <div v-else-if="!option.hidden && !option.keyOnly" @click="callAction(option)" :data-kbd="option.id ? shortcuts.bindingOf(option.id) : ''">{{ option.label }}</div>
        </template>
    </div>
</template>


<style scoped>
.context-menu {
    position: fixed;
    width: 280px;
    max-height: calc(100vh - 20px);
    overflow-y: auto;
    background-color: #333;
    color: #fff;
    border-radius: 10px;
    border: 2px solid #fff3;
    padding-block: 6px;
    z-index: 9999;
    font-family: Consolas, monospace;
    font-size: 16px;
    text-shadow: 0 0 1px #000;
    display: flex;
    flex-direction: column;
    box-shadow: 
        0 10px 25px #000,
        0 10px 25px -10px #000;
}
.context-menu > div {
    padding-inline: 20px;
    padding-block: 6px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.context-menu > div:hover {
    background-color: #fff2;
}
.context-menu > div::after {
    content: attr(data-kbd);
    color: #999;
    font-size: 16px;
    padding-left: 10px;
}

.context-menu > hr {
    border: 0;
    border-top: 1px solid #fff3;
    margin: 5px 0;
}
</style>
