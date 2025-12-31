<script setup lang="ts">
import { computed, ref, watch, useTemplateRef } from 'vue'
import { useEventListener, useMouse } from '@vueuse/core';

const props = withDefaults(defineProps<{
    visible: boolean,
    title?: string,
    width?: number,
    height?: number,
    resizable?: boolean,
    keepPositionOnShow?: boolean,
    customPosition?: { x: number, y: number } | null
}>(), {
    title: '',
    resizable: true,
    width: 300,
    height: 0,
    keepPositionOnShow: false,
    customPosition: null
});

defineEmits<{
    close: []
}>();

const mouse = useMouse();

const windowHandle = useTemplateRef("windowHandle");
const moveHandle = useTemplateRef("moveHandle");
const resizeHandle = useTemplateRef("resizeHandle");

const state = ref({ 
    x: (1929 - props.width)/2, 
    y: (1080 - props.height)/2,
    width: props.width, 
    height: props.height 
});


defineExpose({
    state,
    windowRoot: windowHandle
})

// const isDragging = computed(() => !!pressedDelta.value);
const style = computed(() => ({
    left: state.value.x + "px",
    top: state.value.y + "px",
    width: state.value.width + "px",
    height: state.value.height == 0 ? "auto" : (state.value.height + "px"),
}));

const preventDefault = false;
const stopPropagation = false;
const capture = true;

const handleEvent = (e: Event) => {
    if (preventDefault)  e.preventDefault();
    if (stopPropagation) e.stopPropagation();
};

// handle moving the window
const movingStart = ref({ x: 0, y: 0 });
const isMoving = ref(false);

useEventListener(moveHandle, 'pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target !== moveHandle.value) return;

    isMoving.value = true;
    moveHandle.value?.setPointerCapture(e.pointerId);

    const targetRect = windowHandle.value!.getBoundingClientRect();
    movingStart.value.x = e.clientX - targetRect.left;
    movingStart.value.y = e.clientY - targetRect.top;
    handleEvent(e);
}, { capture });

useEventListener(moveHandle, 'pointermove', (e) => {
    if (!isMoving.value)
        return;

    state.value.x = e.clientX - movingStart.value.x;
    state.value.y = e.clientY - movingStart.value.y;

    handleEvent(e);
}, { capture });

useEventListener(moveHandle, 'pointerup', (e) => {
    moveHandle.value?.releasePointerCapture(e.pointerId);
    isMoving.value = false;
    handleEvent(e);
}, { capture });


// handle resizing the window
const isResizing = ref(false);

useEventListener(resizeHandle, 'pointerdown', (e) => {
    if (e.button !== 0)
        return;
    
    isResizing.value = true;
    resizeHandle.value?.setPointerCapture(e.pointerId);
    handleEvent(e);
}, { capture });

useEventListener(resizeHandle, 'pointermove', (e) => {
    if (!isResizing.value)
        return;

    let { x, y, width, height } = state.value;

    width = e.clientX - x;
    if (width < 200) width = 200;
    if (width > window.innerWidth) {
        width = window.innerWidth;
    }

    if (height != 0) {
        height = e.clientY - y;
        if (height < 200) height = 200;
    }
    if (height > window.innerHeight) {
        height = window.innerHeight;
    }

    state.value.width = width;
    state.value.height = height;
    handleEvent(e);
}, { capture });

useEventListener(resizeHandle, 'pointerup', (e) => {
    resizeHandle.value?.releasePointerCapture(e.pointerId);
    isResizing.value = false;
    handleEvent(e);
}, { capture });



watch(() => props.visible, (visible) => {
    if (visible && !props.keepPositionOnShow) {
        if (props.customPosition) {
            state.value.x = props.customPosition.x;
            state.value.y = props.customPosition.y;
        } else {
            state.value.x = mouse.x.value - state.value.width / 2;
            state.value.y = mouse.y.value - 16;
        }
    }
});

</script>


<template>
    <div :class="{
        'window': true,
        'hidden': !visible,
    }" :style="style" ref="windowHandle">
        <div class="title" ref="moveHandle">{{ title }}</div>
        <div class="close" @click="$emit('close')">
            &#x1F7A8;
        </div>
        <div class="content">
            <slot></slot>
        </div>
        <div v-show="resizable" class="resize" ref="resizeHandle"></div>
    </div>
</template>


<style scoped>
.window {
    position: fixed;
    width: 300px;
    z-index: 200;

    background-color: #333;
    color: #fff;
    border: 1px solid #222;
    border-radius: 10px;
    box-shadow: 
        0 10px 25px #000,
        0 10px 25px -10px #000;

    font-family: Consolas, monospace;
    font-size: 18px;
    text-shadow: 0 0 1px #000;

    display: grid;
    grid-template-columns: auto 32px;
    grid-template-rows: 32px auto;
    overflow: hidden;
}

.title {
    padding: 5px 10px;
    background-color: #222;
    cursor: move;
    overflow: hidden;
    white-space: nowrap;
}

.close {
    padding-inline: 5px;
    cursor: pointer;
    text-align: center;
    font-family: sans-serif;
    font-size: 24px;
    background-color: #a00;
    display: flex;
    align-items: center;
    justify-content: center;
}
.close:hover {
    background-color: #f00;
}

.resize {
    cursor: nwse-resize;
    position: absolute;
    right: 0;
    bottom: 0;
    border-left: 10px solid transparent;
    border-top: 10px solid transparent;
    border-right: 10px solid #222;
    border-bottom: 10px solid #222;
}

.content {
    padding: 10px 20px 20px 20px;
    grid-column: span 2;
    overflow: auto;
}

.window.hidden {
    visibility: hidden;
}
</style>
