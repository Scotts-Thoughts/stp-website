import type { MetricKeys, ThresholdSchedule, ThresholdScheduleEntry, ThresholdView, Tierlist } from '../store/tierlist';

export const THRESHOLD_VIEWS: ThresholdView[] = ['first', 'best', 'recent'];

/** Start date given to entries converted from the legacy undated thresholdDefaults. */
export const LEGACY_SCHEDULE_DATE = '1970-01-01';

/** Sorts entries by start date ascending (dates are YYYY-MM-DD, so string order is date order). */
function sortedEntries(entries: ThresholdScheduleEntry[] | undefined): ThresholdScheduleEntry[] {
    return [...(entries ?? [])].sort((a, b) => a.from.localeCompare(b.from));
}

/** Converts legacy thresholdDefaults into a schedule with one entry per view. */
function scheduleFromDefaults(defaults: Tierlist['thresholdDefaults']): ThresholdSchedule {
    const schedule: ThresholdSchedule = {};
    if (!defaults) return schedule;
    for (const view of THRESHOLD_VIEWS) {
        const sets = defaults[view];
        if (sets && Object.keys(sets).length > 0) {
            schedule[view] = [{ from: LEGACY_SCHEDULE_DATE, sets: { ...sets } as ThresholdScheduleEntry['sets'] }];
        }
    }
    return schedule;
}

/**
 * The schedule in effect for a tierlist. Tierlists that still only have the legacy
 * thresholdDefaults are read as if converted, without modifying the tierlist.
 */
export function getThresholdSchedule(tl: Tierlist): ThresholdSchedule {
    return tl.thresholdSchedule ?? scheduleFromDefaults(tl.thresholdDefaults);
}

/**
 * Returns the tierlist's schedule for editing, converting legacy thresholdDefaults
 * into thresholdSchedule (and dropping them) the first time.
 */
export function ensureThresholdSchedule(tl: Tierlist): ThresholdSchedule {
    if (!tl.thresholdSchedule) {
        tl.thresholdSchedule = scheduleFromDefaults(tl.thresholdDefaults);
        delete tl.thresholdDefaults;
    }
    return tl.thresholdSchedule;
}

/**
 * Index (into the date-sorted entries) of the entry in effect on `date`: the latest entry
 * starting on or before it, or the earliest entry when `date` precedes all of them.
 * Returns -1 when the view has no entries.
 */
export function activeScheduleEntryIndex(entries: ThresholdScheduleEntry[] | undefined, date: string): number {
    const sorted = sortedEntries(entries);
    if (sorted.length === 0) return -1;
    let idx = 0;
    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].from <= date) idx = i;
    }
    return idx;
}

/**
 * Resolves the threshold group label for a view + metric on a given display date.
 * Walks back from the entry in effect until one names the metric; if none on or before
 * the date does, the earliest entry naming it applies.
 */
export function resolveScheduledLabel(tl: Tierlist, view: ThresholdView, metric: MetricKeys, date: string): string | undefined {
    const sorted = sortedEntries(getThresholdSchedule(tl)[view]);
    const start = activeScheduleEntryIndex(sorted, date);
    if (start < 0) return undefined;
    for (let i = start; i >= 0; i--) {
        const label = sorted[i].sets[metric];
        if (label) return label;
    }
    for (let i = start + 1; i < sorted.length; i++) {
        const label = sorted[i].sets[metric];
        if (label) return label;
    }
    return undefined;
}
