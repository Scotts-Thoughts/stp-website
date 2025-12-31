<script setup lang="ts">
import { computed } from 'vue'
import { METRIC, MetricKeys, useTierlist } from '../store';

const props = defineProps<{
    pokemon: string,
    openToTop: boolean,
}>();

const tierlist = useTierlist();

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

    <div :class="{
        'popout': true,
        'top': props.openToTop,
    }">
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

</template>


<style scoped>
.popout {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translate(-50%, 0);
    background: #333333e8;
    box-shadow: 0 10px 25px #000, 0 10px 25px -10px #000;
    border-radius: 10px;
    z-index: 100;
    padding: 20px;
    font-size: 24px;
}

.popout.top {
    top: auto;
    bottom: calc(100% + 16px);
}

.popout .body {
    display: grid;
    grid-template-columns: 175px 1fr;
    font-family: Consolas, monospace;
    gap: 5px;
}

.popout .body > :nth-child(odd) {
    justify-self: start;
}

.popout .body > :nth-child(even) {
    justify-self: end;
}

</style>
