import { computed, nextTick, ref, watch } from "vue";
import { defineStore } from "pinia";

import { useWorkspace } from ".";
import { useGlobal } from "./global";
import { currentDate, formatTimeFull, formatTimeHM, formatTimeHMS, parseDate } from "../utils/time"

import { getPokemonData } from "../utils/pokemon/pokedex";

export type Tierlist = {
    filename: string
    name: string
    game: string
    total: number[]
    thresholds_first: Partial<Record<MetricKeys, { label: string, data: number[] }[]>>
    thresholds_best: Partial<Record<MetricKeys, { label: string, data: number[] }[]>>
    thresholds_recent?: Partial<Record<MetricKeys, { label: string, data: number[] }[]>>
    thresholdDefaults?: {
        first?: Record<string, string>
        best?: Record<string, string>
        recent?: Record<string, string>
    }
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
    states?: TierlistState[]
}

/**
 * A saved snapshot of the view settings that produced a tierlist graphic, so the
 * user can "go back in time" and recall the exact moment a graphic was made.
 * Stored inside the tierlist JSON (durable, travels with the tierlist).
 *
 * Recall is non-destructive: it restores the view controls and pins the set of
 * species that were displayed (`species`), so a Pokémon inserted later with an
 * earlier release date won't reappear in the recalled graphic.
 */
export type TierlistState = {
    id: string
    name: string
    createdAt: string
    // view controls
    category: 'first' | 'best' | 'recent'
    metric: MetricKeys
    thresholdIndex: number
    thresholdLabel?: string
    thresholdValues?: number[]
    totalIndex: number
    date: string
    // filters
    excludePokemon: string[]
    includeTags: string[]
    excludeTags: string[]
    includeTypes: string[]
    includeGrowthRates: string[]
    includeYears: string[]
    // display toggles
    popoutActive: boolean
    showBoxArt: boolean
    creditMode: number
    hidden: boolean
    // frozen set of species shown in the graphic
    species: string[]
    // metadata (for display in the States list)
    game?: string
    episodeTitle?: string
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
    const global = useGlobal();

    const activePkmn = ref<string>('');
    const activePrev = ref<string>('');
    const activeCategory = ref<'first' | 'best' | 'recent'>('best');
    const activeMetric = ref<MetricKeys>('realtime');
    const activeThresholdIndex = ref<number>(0);
    const activeTotalIndex = ref<number>(0);
    const selectedPkmn = ref<Set<string>>(new Set());

    // When a saved State is being viewed, the graphic is restricted to exactly the
    // species that were displayed when it was captured (so later-inserted, earlier-dated
    // Pokémon don't reappear). null = live view (no restriction).
    const restrictSpecies = ref<Set<string> | null>(null);
    // Id of the State currently being viewed, or '' when viewing live.
    const activeStateId = ref<string>('');
    // True only while recallState() is applying a snapshot, so the "manual change
    // exits the state view" watcher below doesn't fire on our own mutations.
    const recalling = ref(false);

    const excludePokemonList = ref<string[]>([]);
    const includeTagsList = ref<string[]>([]);
    const excludeTagsList = ref<string[]>(["backports", "backport"]);
    const includeTypeList = ref<string[]>([]);
    const includeGrowthRateList = ref<string[]>([]);
    const includeYearList = ref<string[]>([]);
    const releaseDateTreshold = ref<string>(currentDate());

    const activeTierlist = computed(() => workspace.activeTierlist);

    // Remember the last-used display category per tierlist (keyed by filename),
    // so reopening a tierlist restores the view it was closed in.
    const CATEGORY_STORAGE_KEY = "tierlist-display-categories";
    function loadSavedCategories(): Record<string, 'first' | 'best' | 'recent'> {
        try {
            return JSON.parse(localStorage.getItem(CATEGORY_STORAGE_KEY) ?? "{}");
        } catch {
            return {};
        }
    }
    const savedCategories = loadSavedCategories();

    // immediate: the store may be created after the tierlist was already activated,
    // in which case the watcher would otherwise miss the first open.
    watch(() => workspace.activeTierlist.filename, (filename) => {
        if (!filename) return;
        const saved = savedCategories[filename];
        if (saved) {
            activeCategory.value = saved;
        }
    }, { immediate: true });

    watch(() => activeCategory.value, (category) => {
        const filename = workspace.activeTierlist.filename;
        if (!filename) return;
        savedCategories[filename] = category;
        localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(savedCategories));
    });

    function resolveDefaultThresholdIndex() {
        const tl = workspace.activeTierlist;
        const defaults = tl.thresholdDefaults;
        if (!defaults) { activeThresholdIndex.value = 0; return; }
        const viewKey = activeCategory.value === 'first' ? 'first' : activeCategory.value === 'recent' ? 'recent' : 'best';
        const label = defaults[viewKey]?.[activeMetric.value];
        if (!label) { activeThresholdIndex.value = 0; return; }
        const list = activeThresholdList.value;
        if (!list) { activeThresholdIndex.value = 0; return; }
        const idx = list.findIndex(t => t.label === label);
        activeThresholdIndex.value = idx >= 0 ? idx : 0;
    }

    watch(() => workspace.activeTierlist, () => {
        activeTotalIndex.value = 0;
        resolveDefaultThresholdIndex();
    });

    watch(() => activeCategory.value, () => {
        resolveDefaultThresholdIndex();
    });

    watch(() => activeMetric.value, () => {
        resolveDefaultThresholdIndex();
    });

    // Re-resolve the active threshold whenever the per-view defaults change
    // (e.g. the Thresholds dialog assigns a group to a view) so the live view updates immediately.
    watch(() => workspace.activeTierlist.thresholdDefaults, () => {
        resolveDefaultThresholdIndex();
    }, { deep: true });

    // Manually changing the date or display view exits the saved-State view and
    // returns to the live tierlist (removes the frozen-species restriction).
    watch([() => releaseDateTreshold.value, () => activeCategory.value], () => {
        if (recalling.value) return;
        if (activeStateId.value || restrictSpecies.value) {
            activeStateId.value = '';
            restrictSpecies.value = null;
        }
    });

    // Switching to a different tierlist always drops any active State view.
    watch(() => workspace.activeTierlist.filename, () => {
        activeStateId.value = '';
        restrictSpecies.value = null;
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

    const filterByYear = (releasedate: number) => {
        if (includeYearList.value.length === 0) return true;
        const year = new Date(releasedate).getFullYear().toString();
        return includeYearList.value.includes(year);
    }

    // Get all unique years from attempts in the active tierlist
    const activeYearList = computed(() => {
        const years = new Set<string>();
        for (const entry of Object.values(activeTierlist.value.entries)) {
            for (const attempt of entry.attempts) {
                if (attempt.releasedate > 0) {
                    const year = new Date(attempt.releasedate).getFullYear().toString();
                    // Exclude placeholder years like 1970
                    if (year !== "1970") {
                        years.add(year);
                    }
                }
            }
        }
        return Array.from(years).sort((a, b) => b.localeCompare(a)); // Most recent first
    });

    const firstThresholds = computed(() => activeTierlist.value.thresholds_first);
    const firstAttempts = computed(() => {
        const releaseDateTresh = parseDate(releaseDateTreshold.value);
        const list = [];
        for (const [pkmnName, entry] of Object.entries(activeTierlist.value.entries)) {
            // Skip entries with no attempts
            if (entry.attempts.length === 0) {
                continue;
            }
            const attempt = entry.attempts[0];
            // only include attempts that are before the release date treshold
            if (attempt.releasedate > releaseDateTresh) {
                continue;
            }
            // filter by year
            if (!filterByYear(attempt.releasedate)) {
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
            // only include attempts that are before the release date treshold
            let attempts = entry.attempts.filter(attempt => attempt.releasedate <= releaseDateTresh);
            // followup view requires at least 2 visible attempts to compare
            if (attempts.length < 2) {
                continue;
            }
            // filter by year (when year filter is active, consider all attempts within selected years)
            if (includeYearList.value.length > 0) {
                attempts = attempts.filter(attempt => filterByYear(attempt.releasedate));
                if (attempts.length < 2) {
                    continue;
                }
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

    const recentAttempts = computed(() => {
        const releaseDateTresh = parseDate(releaseDateTreshold.value);
        const list = [];
        for (const [pkmnName, entry] of Object.entries(activeTierlist.value.entries)) {
            // Skip entries with no attempts
            if (entry.attempts.length === 0) {
                continue;
            }
            // only include attempts that are before the release date treshold
            let attempts = entry.attempts.filter(attempt => attempt.releasedate <= releaseDateTresh);
            // if none of the attempts are before the release date treshold, skip this entry
            if (attempts.length === 0) {
                continue;
            }
            // filter by year (when year filter is active, consider only attempts within selected years)
            if (includeYearList.value.length > 0) {
                attempts = attempts.filter(attempt => filterByYear(attempt.releasedate));
                if (attempts.length === 0) {
                    continue;
                }
            }
            // filter by type and growth rate
            if (!filterByType(pkmnName)) {
                continue;
            }
            if (!filterByGrowthRate(pkmnName)) {
                continue;
            }
            // get the most recent attempt by release date (sort descending and take first)
            // When dates are equal, use array index as tiebreaker (higher index = more recent)
            const indexedAttempts = attempts.map((attempt, index) => ({ attempt, index }));
            indexedAttempts.sort((a, b) => {
                if (b.attempt.releasedate !== a.attempt.releasedate) {
                    return b.attempt.releasedate - a.attempt.releasedate;
                }
                return b.index - a.index;
            });
            const attempt = indexedAttempts[0].attempt;
            list.push({ pkmnName, attempt });
        }
        return list;
    });

    const recentThresholds = computed(() => activeTierlist.value.thresholds_recent ?? {});
    const activeThresholdList = computed(() => {
        if (activeCategory.value === "first") {
            return firstThresholds.value[activeMetric.value];
        } else if (activeCategory.value === "recent") {
            // Use thresholds_recent if available, fall back to thresholds_best
            return recentThresholds.value[activeMetric.value] ?? bestTresholds.value[activeMetric.value];
        } else {
            return bestTresholds.value[activeMetric.value];
        }
    });
    const activeAttempts = computed(() => {
        if (activeCategory.value === "first") {
            return firstAttempts.value;
        } else if (activeCategory.value === "recent") {
            return recentAttempts.value;
        } else {
            return bestAttempts.value;
        }
    });
    const activeFilteredAttempts = computed(() => {
        const filteredAttempts = [];
        for (const { pkmnName, attempt } of activeAttempts.value) {
            // When viewing a saved State, only show the species it captured.
            if (restrictSpecies.value && !restrictSpecies.value.has(pkmnName)) {
                continue;
            }
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
        // Auto-fallback if we're in "best" or "recent" category and have no results
        if ((activeCategory.value === "best" || activeCategory.value === "recent") && newAttempts.length === 0) {
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

    /// STATES ///

    // Saved snapshots for the active tierlist (newest first).
    const states = computed<TierlistState[]>(() => activeTierlist.value.states ?? []);

    // Every species currently rendered in the graphic (across all tiers).
    function currentDisplayedSpecies(): string[] {
        const names = new Set<string>();
        for (const group of groupedEntries.value) {
            for (const entry of group) names.add(entry.pkmnName);
        }
        return [...names];
    }

    /** Capture the current view as a new State on the active tierlist. */
    function captureState(name: string, episodeTitle?: string): TierlistState {
        const tl = activeTierlist.value;
        const activeGroup = activeThresholdList.value?.[activeThresholdIndex.value];
        const state: TierlistState = {
            id: (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2)),
            name,
            createdAt: new Date().toISOString(),
            category: activeCategory.value,
            metric: activeMetric.value,
            thresholdIndex: activeThresholdIndex.value,
            thresholdLabel: activeGroup?.label,
            thresholdValues: activeGroup?.data ? [...activeGroup.data] : undefined,
            totalIndex: activeTotalIndex.value,
            date: releaseDateTreshold.value,
            excludePokemon: [...excludePokemonList.value],
            includeTags: [...includeTagsList.value],
            excludeTags: [...excludeTagsList.value],
            includeTypes: [...includeTypeList.value],
            includeGrowthRates: [...includeGrowthRateList.value],
            includeYears: [...includeYearList.value],
            popoutActive: global.popoutActive,
            showBoxArt: global.showBoxArt,
            creditMode: global.creditMode,
            hidden: global.hidden,
            species: currentDisplayedSpecies(),
            game: tl.game,
            episodeTitle,
        };
        if (!tl.states) tl.states = [];
        tl.states.unshift(state);
        return state;
    }

    /** Restore a saved State non-destructively and pin its species set. */
    async function recallState(id: string): Promise<boolean> {
        const state = activeTierlist.value.states?.find(s => s.id === id);
        if (!state) return false;

        recalling.value = true;
        // Clear any existing restriction so the captured category isn't computed as empty.
        restrictSpecies.value = null;

        activeCategory.value = state.category;
        activeMetric.value = state.metric;
        releaseDateTreshold.value = state.date;
        excludePokemonList.value = [...state.excludePokemon];
        includeTagsList.value = [...state.includeTags];
        excludeTagsList.value = [...state.excludeTags];
        includeTypeList.value = [...state.includeTypes];
        includeGrowthRateList.value = [...state.includeGrowthRates];
        includeYearList.value = [...state.includeYears];
        global.popoutActive = state.popoutActive;
        global.showBoxArt = state.showBoxArt;
        global.creditMode = state.creditMode;
        global.hidden = state.hidden;

        // Let the category/metric watchers (which reset the threshold index) flush first,
        // then apply the saved threshold selection on top.
        await nextTick();

        const list = activeThresholdList.value;
        let idx = state.thresholdIndex;
        if (state.thresholdLabel && list) {
            const found = list.findIndex(t => t.label === state.thresholdLabel);
            if (found >= 0) idx = found;
        }
        activeThresholdIndex.value = idx;
        activeTotalIndex.value = state.totalIndex;

        activeStateId.value = id;
        restrictSpecies.value = new Set(state.species);

        // Release the guard after another flush so the date/category watcher doesn't
        // treat our own mutations as a manual change.
        await nextTick();
        recalling.value = false;
        return true;
    }

    function deleteState(id: string) {
        const tl = activeTierlist.value;
        if (!tl.states) return;
        tl.states = tl.states.filter(s => s.id !== id);
        if (activeStateId.value === id) returnToLive();
    }

    function renameState(id: string, name: string) {
        const state = activeTierlist.value.states?.find(s => s.id === id);
        if (state && name.trim()) state.name = name.trim();
    }

    /** Exit the saved-State view and return to the live tierlist. */
    function returnToLive() {
        activeStateId.value = '';
        restrictSpecies.value = null;
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
        activeYearList,
        releaseDateTreshold,
        selectedPkmn,
        excludePokemonList,
        includeTagsList,
        excludeTagsList,
        includeTypeList,
        includeGrowthRateList,
        includeYearList,
        groupedEntries,
        getMetrics,
        labels,
        // states
        states,
        activeStateId,
        restrictSpecies,
        captureState,
        recallState,
        deleteState,
        renameState,
        returnToLive,
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
