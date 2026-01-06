<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { METRIC, MetricKeys, useTierlist } from '../store';

const props = defineProps<{
    pokemon: string,
    openToTop: boolean,
}>();

const tierlist = useTierlist();

// Position state for the teleported popout
const popoutStyle = ref({
    top: '0px',
    left: '0px',
    visibility: 'hidden' as 'hidden' | 'visible',
});

// Reference to a hidden anchor element to get parent position
const anchorRef = ref<HTMLElement | null>(null);
const popoutRef = ref<HTMLElement | null>(null);

function updatePosition() {
    if (!anchorRef.value) return;
    
    const parent = anchorRef.value.parentElement;
    if (!parent) return;
    
    const rect = parent.getBoundingClientRect();
    
    // Get actual popout dimensions if available
    const popoutRect = popoutRef.value?.getBoundingClientRect();
    const popoutHeight = popoutRect?.height ?? 200;
    
    // Center horizontally on the parent element
    let left = rect.left + rect.width / 2;
    
    let top: number;
    if (props.openToTop) {
        // Position above the element
        top = rect.top - popoutHeight - 16;
    } else {
        // Position below the element
        top = rect.bottom + 8;
    }
    
    popoutStyle.value = {
        top: `${top}px`,
        left: `${left}px`,
        visibility: 'visible',
    };
}

// Track previous parent position to detect changes
let previousParentRect: DOMRect | null = null;
let animationFrameId: number | null = null;
let isWatching = false;

function watchParentPosition() {
    if (!isWatching || !anchorRef.value) return;
    
    const parent = anchorRef.value.parentElement;
    if (!parent) {
        animationFrameId = requestAnimationFrame(watchParentPosition);
        return;
    }
    
    const currentRect = parent.getBoundingClientRect();
    if (previousParentRect) {
        // Check if position changed (accounting for floating point precision)
        if (Math.abs(currentRect.left - previousParentRect.left) > 0.1 ||
            Math.abs(currentRect.top - previousParentRect.top) > 0.1 ||
            Math.abs(currentRect.width - previousParentRect.width) > 0.1 ||
            Math.abs(currentRect.height - previousParentRect.height) > 0.1) {
            updatePosition();
        }
    }
    previousParentRect = currentRect;
    
    animationFrameId = requestAnimationFrame(watchParentPosition);
}

// Update position when mounted and when pokemon changes
onMounted(() => {
    nextTick(updatePosition);
    // Update again after a frame to get accurate popout dimensions
    requestAnimationFrame(() => {
        updatePosition();
    });
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    
    // Watch for viewport scale changes by checking parent position each frame
    // This catches CSS transform changes that don't trigger resize events
    isWatching = true;
    watchParentPosition();
});

onUnmounted(() => {
    window.removeEventListener('scroll', updatePosition, true);
    window.removeEventListener('resize', updatePosition);
    
    isWatching = false;
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    previousParentRect = null;
});

watch(() => props.pokemon, () => {
    nextTick(updatePosition);
});

const metrics = computed(() => {
    const metrics = tierlist.getMetrics(props.pokemon);
    const formattedMetrics: Record<string, string> = {};
    const METRIC_DISPLAY_ORDER = [
        //"finished", 
        "realtime",
        "resets",
        "blackouts",
        "faults",
        "level", 
        "gametime",
        // "realtime_0", 
        // "resets_0", 
        // "blackouts_0", 
        // "faults_0",
        // "level_0", 
        // "gametime_0", 
    ] as const;
    for (const key of METRIC_DISPLAY_ORDER) {
        const m = metrics[key as MetricKeys];
        const v = (typeof m === 'function') ? m() : m;
        if (v === undefined || v < 0) continue;
        formattedMetrics[key] = METRIC[key as MetricKeys]?.formatValue?.(v) ?? v.toString();
    }
    return formattedMetrics;
});

</script>


<template>
    <!-- Hidden anchor to track parent position -->
    <span ref="anchorRef" class="anchor"></span>
    
    <!-- Teleport popout to body to escape overflow clipping -->
    <Teleport to="body">
        <div 
            ref="popoutRef"
            class="metric-popout"
            :style="popoutStyle"
        >
            <div class="content">
                <div class="header">
                    <h3>{{ pokemon }}</h3>
                </div>
                <div class="body">
                    <template v-for="(value, key) in metrics" :key="key">
                        <div>{{ METRIC[key as MetricKeys]?.title }}: </div>
                        <div>{{ value }}</div>
                    </template>
                </div>
            </div>
        </div>
    </Teleport>
</template>


<style scoped>
.anchor {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
}
</style>

<!-- Non-scoped styles for teleported content -->
<style>
.metric-popout {
    position: fixed;
    transform: translateX(-50%);
    background: #333333e8;
    box-shadow: 0 10px 25px #000, 0 10px 25px -10px #000;
    border-radius: 10px;
    z-index: 10000;
    padding: 20px;
    font-size: 24px;
    pointer-events: none;
}

.metric-popout .header h3 {
    margin: 0;
    padding-bottom: 8px;
    font-family: Consolas, monospace;
    font-size: 24px;
    font-weight: bold;
    text-align: center;
    text-decoration: bold;
}

.metric-popout .body {
    display: grid;
    grid-template-columns: 175px 1fr;
    font-family: Consolas, monospace;
    gap: 5px;
}

.metric-popout .body > :nth-child(odd) {
    justify-self: start;
}

.metric-popout .body > :nth-child(even) {
    justify-self: end;
}
</style>
