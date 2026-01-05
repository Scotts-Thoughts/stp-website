import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";

import { useWorkspace } from ".";
import { currentDate, formatTimeFull, formatTimeHM, formatTimeHMS, parseDate } from "../utils/time"

import { getPokemonData } from "../utils/pokemon/pokedex";

export type Tierlist = {
    filename: string
    name: string
    game: string
    total: number[]
    thresholds_first: Partial<Record<MetricKeys, { label: string, data: number[] }[]>>
    thresholds_best: Partial<Record<MetricKeys, { label: string, data: number[] }[]>>
    entries: Record<string, TierlistEntry>
    imageSource?: string
    platform?: string
    finalTierLabel?: string
    surgeTierLabel?: string
    surgeTierImage?: string
    brunoTierLabel?: string
    brunoTierImage?: string
    cartridgeImage?: string
    visible?: boolean
    sTierLabel?: string
    aTierLabel?: string
    bTierLabel?: string
    cTierLabel?: string
    dTierLabel?: string
    eTierLabel?: string
    fTierLabel?: string
}

export type TierlistEntry = {
    numAttempts: number
    numFinishes: number
    tags: string[]
    attempts: Metrics[]
}

const enum TierlistTierIndex {
    S = 0,
    A = 1,
    B = 2,
    C = 3,
    D = 4,
    E = 5,
    F = 6,
    Surge = 7,
    Bruno = 8,
    Impossible = 9,
}

export const useTierlist = defineStore("tierlist", () => {
    const workspace = useWorkspace();

    const activePkmn = ref<string>('');
    const activePrev = ref<string>('');
    const activeCategory = ref<'first' | 'best'>('best');
    const activeMetric = ref<MetricKeys>('realtime');
    const activeThresholdIndex = ref<number>(0);
    const activeTotalIndex = ref<number>(0);
    const selectedPkmn = ref<Set<string>>(new Set());

    const excludePokemonList = ref<string[]>([]);
    const includeTagsList = ref<string[]>([]);
    const excludeTagsList = ref<string[]>(["backports", "backport"]);
    const includeTypeList = ref<string[]>([]);
    const includeGrowthRateList = ref<string[]>([]);
    const releaseDateTreshold = ref<string>(currentDate());

    const activeTierlist = computed(() => workspace.activeTierlist);

    watch(() => workspace.activeTierlist, () => {
        activeThresholdIndex.value = 0;
        activeTotalIndex.value = 0;
    });

    watch(() => activeCategory.value, () => {
        activeThresholdIndex.value = 0;
    });

    watch(() => activeMetric.value, () => {
        activeThresholdIndex.value = 0;
    });


    const filterByType = (pokemonName: string) => {
        if (includeTypeList.value.length === 0) return true;
        const pokemonData = getPokemonData(activeTierlist.value.game, pokemonName);
        if (!pokemonData) return false;
        return includeTypeList.value.includes(pokemonData.type_1) ||
               includeTypeList.value.includes(pokemonData.type_2);
    };

    const filterByGrowthRate = (pokemonName: string) => {
        if (includeGrowthRateList.value.length === 0) return true;
        const pokemonData = getPokemonData(activeTierlist.value.game, pokemonName);
        if (!pokemonData) return false;
        return includeGrowthRateList.value.includes(pokemonData.growth_rate);
    }

    const firstThresholds = computed(() => activeTierlist.value.thresholds_first);
    const firstAttempts = computed(() => {
        const releaseDateTresh = parseDate(releaseDateTreshold.value);
        const list = [];
        for (const [pkmnName, entry] of Object.entries(activeTierlist.value.entries)) {
            const attempt = entry.attempts[0];
            // only include attempts that are before the release date treshold
            if (attempt.releasedate > releaseDateTresh) {
                continue;
            }
            // filter by type and growth rate
            if (!filterByType(pkmnName)) {
                continue;
            }
            if (!filterByGrowthRate(pkmnName)) {
                continue;
            }
            list.push({ pkmnName, attempt });
        }
        return list;
    });

    const bestTresholds = computed(() => activeTierlist.value.thresholds_best);
    const bestAttempts = computed(() => {
        const releaseDateTresh = parseDate(releaseDateTreshold.value);
        const list = [];
        for (const [pkmnName, entry] of Object.entries(activeTierlist.value.entries)) {
            // ignore entries with only first attempts
            if (entry.attempts.length <= 1) {
                continue;
            }
            // only include attempts that are before the release date treshold
            const attempts = entry.attempts.filter(attempt => attempt.releasedate <= releaseDateTresh);
            // if none of the attempts are before the release date treshold, skip this entry
            if (attempts.length === 0) {
                continue;
            }
            // if only the first attempt is before the release date treshold, skip this entry
            if (attempts.length === 1 && attempts[0] === entry.attempts[0]) {
                continue;
            }
            // filter by type and growth rate
            if (!filterByType(pkmnName)) {
                continue;
            }
            if (!filterByGrowthRate(pkmnName)) {
                continue;
            }
            // find the attempt with the lowest time
            const minTime = attempts.map(e => e.realtime).min();
            const attempt = attempts.find(e => e.realtime == minTime)!;
            list.push({ pkmnName, attempt });
        }
        return list;
    });

    const activeThresholdList = computed(() =>
        activeCategory.value === "first" ?
            firstThresholds.value[activeMetric.value] :
            bestTresholds.value[activeMetric.value]
    );
    const activeAttempts = computed(() =>
        activeCategory.value === "first" ?
            firstAttempts.value :
            bestAttempts.value
    );
    const activeFilteredAttempts = computed(() => {
        const filteredAttempts = [];
        for (const { pkmnName, attempt } of activeAttempts.value) {
            if (excludePokemonList.value.includes(pkmnName)) {
                continue;
            }
            const tags = activeTierlist.value.entries[pkmnName].tags;
            if (excludeTagsList.value.some(tag => tags.includes(tag))) {
                continue;
            }
            // Only apply includeTagsList if it's not empty
            if (includeTagsList.value.length !== 0 && includeTagsList.value.every(tag => !tags.includes(tag))) {
                continue;
            }
            filteredAttempts.push({ pkmnName, attempt, tags });
        }
        return filteredAttempts;
    });

    const activeTagList = computed(() => {
        const tags = new Set<string>();
        for (const key in activeTierlist.value.entries) {
            const entry = activeTierlist.value.entries[key];
            for (const tag of entry.tags) {
                tags.add(tag);
            }
        }
        return Array.from(tags);
    });

    // Auto-fallback logic: if current category has no results, switch to the other category
    watch(() => activeFilteredAttempts.value, (newAttempts) => {
        // Only auto-fallback if we're in "best" category and have no results
        if (activeCategory.value === "best" && newAttempts.length === 0) {
            // Check if "first" category has results by checking the entries directly
            const hasFirstAttempts = Object.values(activeTierlist.value.entries).some(entry => 
                entry.attempts.some(attempt => attempt.finished)
            );
            if (hasFirstAttempts) {
                activeCategory.value = "first";
            }
        }
    }, { immediate: true });

    const groupedEntries = computed(() => {
        const metricKey = activeMetric.value;
        const attempts = activeFilteredAttempts.value;
        const thresholds = activeThresholdList.value;

        const groups: {
            metrics: Metrics
            pkmnName: string
            value: string
            prev: string
        }[][] = [];

        for (let i = 0; i < 10; i++) {
            groups.push([]);
        }

        const threshold = thresholds?.[activeThresholdIndex.value]?.data;
        if (threshold === undefined) return groups;

        const formatter = METRIC[metricKey].formatValue ?? ((x: number) => x.toString());

        const filteredEntries = [];
        for (const entry of attempts) {
            let metric = entry.attempt[metricKey];
            if (metric === undefined) {
                continue;
            }
            if (typeof metric === "function") {
                metric = metric();
            }
            if (metric >= 0) {
                filteredEntries.push({metric, ...entry});
            }
        }
        filteredEntries.sort((a, b) => a.metric - b.metric);

        for (const { pkmnName, metric, attempt } of filteredEntries) {
            const groupEntry = {
                pkmnName,
                metrics: attempt,
                value: formatter(metric),
                prev: "",
            };
            if (!attempt.finished) {
                groups[TierlistTierIndex.Impossible].push(groupEntry);
            } else {
                let tierIndex = threshold.findIndex(t => metric < t);
                if (tierIndex < 0) tierIndex = TierlistTierIndex.Bruno;
                groups[tierIndex].push(groupEntry);
            }
        }

        // add neighboring pokemon name to each entry
        for (let i = 0; i < 10; i++) {
            for (let j = 0; j < groups[i].length; j++) {
                groups[i][j].prev = groups[i][j - 1]?.pkmnName ?? "";
            }
        }

        return groups;
    });

    const labels = computed(() => {
        const metricKey = activeMetric.value;
        const thresholds = activeThresholdList.value;

        const labels = [] as string[];

        const threshold = thresholds?.[activeThresholdIndex.value]?.data;
        if (threshold === undefined) return labels;

        const formatter = METRIC[metricKey].formatLabel ?? ((x: number) => x.toString());

        for (let i = 0; i < TierlistTierIndex.Bruno; i++) {
            labels[i] = "<" + formatter(threshold[i]);
        }
        labels[TierlistTierIndex.Bruno] = ">" + formatter(threshold[TierlistTierIndex.Surge]);
        labels[TierlistTierIndex.Impossible] = "Can't Finish";

        return labels;
    });

    function getMetrics(pkmnName: string) {
        return activeAttempts.value.find((entry) => entry.pkmnName === pkmnName)?.attempt ?? {} as Metrics;
    }

    return {
        activeTierlist,
        activePkmn,
        activePrev,
        activeCategory,
        activeMetric,
        activeThresholdIndex,
        activeTotalIndex,
        activeThresholdList,
        activeAttempts,
        activeFilteredAttempts,
        activeTagList,
        releaseDateTreshold,
        selectedPkmn,
        excludePokemonList,
        includeTagsList,
        excludeTagsList,
        includeTypeList,
        includeGrowthRateList,
        groupedEntries,
        getMetrics,
        labels,
    }

});


/// HELPERS ///

export const TIERLIST_REQUIRED_KEYS = [
    "name", "total", "thresholds_first", "thresholds_best", "entries"
] as const;

export const METRIC_STATIC_KEYS = [
    "finished", "releasedate",
    // final split metrics
    "gametime", "realtime", "level", "resets", "blackouts",
    // optional mid split metrics
    "gametime_0", "realtime_0", "level_0", "resets_0", "blackouts_0",
] as const;

export const METRIC_CALC_KEYS = [
    "faults", "faults_0"
] as const;

export const METRIC_KEYS = [
    ...METRIC_STATIC_KEYS,
    ...METRIC_CALC_KEYS
] as const;

export const METRIC_TIME_KEYS = [
    "realtime", "gametime", "realtime_0", "gametime_0"
] as const;

export const METRIC_NUMBER_KEYS = [
    "level", "resets", "blackouts",
    "level_0", "resets_0", "blackouts_0",
] as const;

export const METRIC: Record<MetricKeys, {
    title: string
    formatLabel?: (x: number) => string
    formatValue?: (x: number) => string
}> = {
    finished: { title: "Finished" },
    releasedate: { title: "Release Date" },
    gametime: { title: "Game Time", formatLabel: (x) => formatTimeHM(x), formatValue: (x) => formatTimeHMS(x, false) },
    realtime: { title: "Real Time", formatLabel: (x) => formatTimeHMS(x, false), formatValue: (x) => formatTimeFull(x, false) },
    level: { title: "Level", formatLabel: (x) => "Lv:" + x },
    resets: { title: "Resets" },
    blackouts: { title: "Blackouts" },
    faults: { title: "Faults" },
    gametime_0: { title: "Game Time (Mid)", formatLabel: (x) => formatTimeHM(x), formatValue: (x) => formatTimeHMS(x, false) },
    realtime_0: { title: "Real Time (Mid)", formatLabel: (x) => formatTimeHMS(x, false), formatValue: (x) => formatTimeFull(x, false) },
    level_0: { title: "Level (Mid)", formatLabel: (x) => "Lv:" + x },
    resets_0: { title: "Resets (Mid)" },
    blackouts_0: { title: "Blackouts (Mid)" },
    faults_0: { title: "Faults (Mid)" },
};

export type MetricKeys = typeof METRIC_KEYS[number];

export type Metrics =
    Record<typeof METRIC_STATIC_KEYS[number], number> &
    Record<typeof METRIC_CALC_KEYS[number], () => number>;
