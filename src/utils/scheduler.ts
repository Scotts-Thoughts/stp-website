// Bridge to the YouTube Production Scheduler (a sibling Electron app) so a captured
// tierlist "state" can be auto-named after the episode being produced.
//
// The scheduler stores one project (episode) per real release date, and those dates
// are globally unique across every game — so a tierlist's current date-threshold maps
// cleanly onto a single episode title. Unscheduled backlog projects use releaseDate
// "null" and are ignored here.

import type { SchedulerProject } from './electron-fs';

let cache: SchedulerProject[] | null = null;

/**
 * Load (and memoize) the scheduler's project list. Only works in the Electron
 * desktop app; returns [] in the browser or if the file can't be read.
 */
export async function loadSchedulerProjects(): Promise<SchedulerProject[]> {
    if (cache) return cache;
    if (window.electronScheduler) {
        try {
            const projects = await window.electronScheduler.readProjects();
            cache = Array.isArray(projects) ? projects : [];
        } catch {
            cache = [];
        }
    } else {
        cache = [];
    }
    return cache;
}

/** Force the next load to re-read from disk (e.g. after the schedule changes). */
export function invalidateSchedulerCache(): void {
    cache = null;
}

function normalizeGame(game: string): string {
    return String(game).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isRealDate(d: unknown): d is string {
    return typeof d === 'string' && d !== '' && d !== 'null';
}

/**
 * Find the episode title for a graphic captured at `date` for `game`.
 * Prefers an exact same-game date match, then the most recent same-game episode
 * on or before that date, then any episode on that exact date. Returns null when
 * nothing sensible matches (caller falls back to a date-based name).
 */
export function suggestEpisodeName(
    projects: SchedulerProject[],
    game: string,
    date: string,
): string | null {
    if (!projects.length || !isRealDate(date)) return null;

    const ng = normalizeGame(game);
    const sameGame = projects.filter(p => isRealDate(p.releaseDate) && normalizeGame(p.game) === ng);

    // Exact same-game match (the usual case: threshold set to an episode's release date).
    const exact = sameGame.find(p => p.releaseDate === date);
    if (exact) return exact.title;

    // Nearest same-game episode on or before the date ("as of" this graphic).
    const before = sameGame
        .filter(p => p.releaseDate <= date)
        .sort((a, b) => (a.releaseDate < b.releaseDate ? 1 : -1));
    if (before.length) return before[0].title;

    // No same-game episode at/before this date — don't guess across games
    // (that would confidently mislabel). Caller falls back to a date-based name.
    return null;
}
