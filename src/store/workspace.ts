import { computed, ref } from 'vue';
import stringify from '../utils/stringify';

import { Tierlist, METRIC_STATIC_KEYS, METRIC_TIME_KEYS, METRIC, Metrics, TierlistEntry, METRIC_NUMBER_KEYS, TIERLIST_REQUIRED_KEYS } from '.';

import FS from '../utils/fs'
import ElectronFS, { isElectron } from '../utils/electron-fs'
import Result from '../utils/result';
import { formatDate, parseDate, parseTime } from '../utils/time';
import { defineStore } from 'pinia';


export type Workspace = {
    pkmnSettings: PokemonSettings
    tierlists: Tierlist[]
}

export type PokemonSettings = {
    [K in string]?: {
        scale: number
        offset: number
        saturation: number
        flip: boolean
        margins: Record<string, number | undefined>
    }
}


export const useWorkspace = defineStore("workspace", () => {
    const filesystem = ref<FS>()
    const electronFilesystem = ref<ElectronFS>()
    const settings = ref<any>({})
    const pokemonSettings = ref<PokemonSettings>({})
    const tierlists = ref<Tierlist[]>([])

    const activeTierlistIndex = ref(-1);
    
    // Check if running in Electron
    const runningInElectron = isElectron();

    function setActiveTierlist(newIndex: number) {
        if (newIndex >= tierlists.value.length) {
            activeTierlistIndex.value = -1;
        } else {
            activeTierlistIndex.value = newIndex;
        }
    }

    const activeTierlist = computed<Tierlist>(() => {
        const tierlist = tierlists.value[activeTierlistIndex.value];
        if (!tierlist) {
            return {
                filename: "",
                game: "Yellow",
                name: "Undefined Tierlist",
                total: [0],
                thresholds_first: {},
                thresholds_best: {},
                entries: {}
            };
        }
        return tierlist;
    });

    async function createTierlist(name: string) {
        const fs = runningInElectron ? electronFilesystem.value : filesystem.value;
        if (!fs) {
            return Result.failure("Filesystem not ready.");
        }

        const tierlist = generateTierlist(name);
        const path = tierlist.filename;

        if (await fs.fileExists(path)) {
            return Result.failure("Tierlist already exists.");
        }

        await fs.write(path, stringify(tierlist));
        tierlists.value.push(tierlist);

        // return the index of the new tierlist
        return Result.success(tierlists.value.length - 1);
    }

    function insertActiveTierlistEntry(pokemon: string, attempt: Partial<Metrics>) {
        // convert metrics to correct types
        // and ensure all metrics are defined
        for (const key of METRIC_STATIC_KEYS) {
            attempt[key] = attempt[key] ?? -1;
        }
        // calculate derived metrics
        attempt.faults = () => addMetrics(attempt.resets!, attempt.blackouts!);
        attempt.faults_0 = () => addMetrics(attempt.resets_0!, attempt.blackouts_0!);
        // insert the attempt
        if (!activeTierlist.value.entries[pokemon]) {
            activeTierlist.value.entries[pokemon] = {
                numAttempts: 0,
                numFinishes: 0,
                tags: [],
                attempts: [attempt as Metrics]
            }
        } else {
            activeTierlist.value.entries[pokemon].attempts.push(attempt as Metrics);
        }
    }

    async function removeCachedHandle() {
        return FS.removeCachedHandle("tierlist-workspace-picker");
    }

    async function checkHandleCached() {
        return FS.checkHandleCached("tierlist-workspace-picker");
    }

    async function loadWorkspace() {
        // Use Electron FS if running in Electron, otherwise use browser FS
        if (runningInElectron) {
            if (!electronFilesystem.value) {
                electronFilesystem.value = new ElectronFS();
            }
            return loadWorkspaceWithFS(electronFilesystem.value);
        } else {
            if (!filesystem.value) {
                const result = await FS.create("tierlist-workspace-picker", true);
                if (!result.success) return result;
                filesystem.value = result.data;
            }
            return loadWorkspaceWithFS(filesystem.value);
        }
    }

    async function loadWorkspaceWithFS(fs: FS | ElectronFS) {
        // check if workspace is empty
        if (await fs.isDirEmpty("")) {
            alert("Workspace is empty. Creating a new workspace.");
            await fs.write("settings.json", "{}");
            await fs.write("pokemon.json", "{}");
        }

        // check if workspace is missing any files
        if (!await fs.fileExists("settings.json")) {
            return Result.failure(`Workspace is missing "settings.json". Select a valid workspace.`);
        }
        if (!await fs.fileExists("pokemon.json")) {
            return Result.failure(`Workspace is missing "pokemon.json". Select a valid workspace.`);
        }

        // load files
        settings.value = JSON.parse(await fs.read("settings.json"));
        pokemonSettings.value = JSON.parse(await fs.read("pokemon.json")) as PokemonSettings;

        // load tierlists
        tierlists.value = [];
        for (const entry of (await fs.getDirEntries("/"))) {
            if (entry.kind !== "file") {
                console.warn(`Skipping directory entry: ${entry.name}`);
                continue;
            }
            if (!entry.name.endsWith(".json")) {
                console.warn(`Skipping non-json file: ${entry.name}`);
                continue;
            }
            if (["settings.json", "pokemon.json"].includes(entry.name)) {
                // console.warn(`Skipping reserved file: ${entry.name}`);
                continue;
            }
            const data = await fs.read(entry.name);
            const tierlist = parseTierlist(data);
            if (!tierlist) {
                console.warn(`Failed to parse tierlist: ${entry.name}`);
                continue;
            }
            tierlist.filename = entry.name;
            tierlists.value.push(tierlist);
        }

        // sort tierlists by name
        tierlists.value.sort((a, b) => a.name.localeCompare(b.name));

        return Result.success(undefined);
    }

    async function saveWorkspace() {
        const fs = runningInElectron ? electronFilesystem.value : filesystem.value;
        if (!fs) return Result.failure("Filesystem not ready.");

        await Promise.all([
            fs.write("settings.json", stringify(settings.value, { maxLength: 150 })),
            fs.write("pokemon.json", stringify(pokemonSettings.value, { maxLength: 150 })),
            ...tierlists.value.map(tierlist =>
                fs.write(tierlist.filename, stringifyTierlist(tierlist))
            )
        ]);

        return Result.success(undefined);
    }

    return {
        filesystem,
        settings,
        pokemonSettings,
        tierlists,
        createTierlist,
        activeTierlist,
        setActiveTierlist,
        insertActiveTierlistEntry,
        removeCachedHandle,
        checkHandleCached,
        loadWorkspace,
        saveWorkspace,
        runningInElectron,
    }
})


function addMetrics(a: number, b: number) {
    if (a === -1 && b === -1) return -1;
    if (a === -1) return b;
    if (b === -1) return a;
    return a + b;
}

function parseTierlist(data: string): Tierlist | undefined {
    const tierlistRaw = JSON.parse(data);

    for (const key of TIERLIST_REQUIRED_KEYS) {
        if (!tierlistRaw[key]) {
            return undefined;
        }
    }

    const tierlist = {} as Tierlist;

    tierlist.filename = "";
    tierlist.name = tierlistRaw.name;
    tierlist.game = tierlistRaw.game || "Yellow";
    tierlist.total = tierlistRaw.total;
    tierlist.thresholds_first = {};
    tierlist.thresholds_best = {};
    tierlist.imageSource = tierlistRaw.imageSource;
    tierlist.platform = tierlistRaw.platform;
    tierlist.cartridgeImage = tierlistRaw.cartridgeImage;
    tierlist.visible = tierlistRaw.visible !== undefined ? tierlistRaw.visible : true;

    // copy over any custom keys
    for (const key of Object.keys(tierlistRaw)) {
        if (TIERLIST_REQUIRED_KEYS.includes(key as any)) {
            continue;
        }
        (tierlist as any)[key] = tierlistRaw[key];
    }

    // process thresholds, ensure they are in the correct format
    for (const key of METRIC_TIME_KEYS) {
        const thresholds_first = tierlistRaw.thresholds_first[key];
        const thresholds_best = tierlistRaw.thresholds_best[key];

        if (thresholds_first) {
            tierlist.thresholds_first[key] = thresholds_first.map((x: any) => ({
                label: x.label,
                data: x.data.map(parseTime)
            }));
        }
        if (thresholds_best) {
            tierlist.thresholds_best[key] = thresholds_best.map((x: any) => ({
                label: x.label,
                data: x.data.map(parseTime)
            }));
        }
    }
    for (const key of METRIC_NUMBER_KEYS) {
        const thresholds_first = tierlistRaw.thresholds_first[key];
        const thresholds_best = tierlistRaw.thresholds_best[key];

        if (thresholds_first) {
            tierlist.thresholds_first[key] = thresholds_first.map((x: any) => ({
                label: x.label,
                data: [...x.data]
            }));
        }
        if (thresholds_best) {
            tierlist.thresholds_best[key] = thresholds_best.map((x: any) => ({
                label: x.label,
                data: [...x.data]
            }));
        }
    }


    tierlist.entries = {};
    for (const [pkmnName, entryRaw] of Object.entries<any>(tierlistRaw.entries)) {
        const entry = {} as TierlistEntry;
        tierlist.entries[pkmnName] = entry;

        entry.numAttempts = entryRaw.numAttempts ?? -1;
        entry.numFinishes = entryRaw.numFinishes ?? -1;
        entry.tags        = entryRaw.tags ?? [];

        entry.attempts = [];
        for (const attemptRaw of entryRaw.attempts) {
            const attempt = {} as Metrics;
            entry.attempts.push(attempt);

            // convert metrics to correct types and ensure all metrics are defined

            attempt.releasedate = parseDate(attemptRaw.releasedate);

            attempt.finished = attemptRaw.finished === true ? 1 : attemptRaw.finished === false ? 0 : -1;

            for (const key of METRIC_TIME_KEYS) {
                attempt[key] = parseTime(attemptRaw[key]);
            }

            for (const key of METRIC_NUMBER_KEYS) {
                attempt[key] = attemptRaw[key] ?? -1;
            }

            // calculate derived metrics
            attempt.faults   = () => addMetrics(attempt.resets!, attempt.blackouts!);
            attempt.faults_0 = () => addMetrics(attempt.resets_0!, attempt.blackouts_0!);
        }
    }

    return tierlist;
}

function stringifyTierlist(tierlist: Tierlist): string {
    const tierlistRaw = {} as any;

    tierlistRaw.name = tierlist.name;
    tierlistRaw.game = tierlist.game;
    tierlistRaw.total = tierlist.total;
    tierlistRaw.thresholds_first = {};
    tierlistRaw.thresholds_best = {};
    if (tierlist.platform) tierlistRaw.platform = tierlist.platform;
    if (tierlist.cartridgeImage) tierlistRaw.cartridgeImage = tierlist.cartridgeImage;
    if (tierlist.visible !== undefined) tierlistRaw.visible = tierlist.visible;

    // copy over any custom keys
    for (const key of Object.keys(tierlist)) {
        if (TIERLIST_REQUIRED_KEYS.includes(key as any)) {
            continue;
        }
        if (key === "filename") {
            continue;
        }
        tierlistRaw[key] = (tierlist as any)[key];
    }

    tierlistRaw.entries = {};
    for (const key of METRIC_TIME_KEYS) {
        const thresholds_first = tierlist.thresholds_first[key];
        const thresholds_best = tierlist.thresholds_best[key];
        const formatter = METRIC[key].formatValue!;

        if (thresholds_first) {
            tierlistRaw.thresholds_first[key] = thresholds_first.map(x => ({
                label: x.label,
                data: x.data.map(formatter)
            }));
        }
        if (thresholds_best) {
            tierlistRaw.thresholds_best[key] = thresholds_best.map(x => ({
                label: x.label,
                data: x.data.map(formatter)
            }));
        }
    }
    for (const key of METRIC_NUMBER_KEYS) {
        const thresholds_first = tierlist.thresholds_first[key];
        const thresholds_best = tierlist.thresholds_best[key];

        if (thresholds_first) {
            tierlistRaw.thresholds_first[key] = thresholds_first.map(x => ({
                label: x.label,
                data: [...x.data]
            }));
        }
        if (thresholds_best) {
            tierlistRaw.thresholds_best[key] = thresholds_best.map(x => ({
                label: x.label,
                data: [...x.data]
            }));
        }
    }

    for (const [pkmnName, entry] of Object.entries(tierlist.entries)) {
        const entryRaw = {} as any;
        tierlistRaw.entries[pkmnName] = entryRaw;

        entryRaw.numAttempts = entry.numAttempts;
        entryRaw.numFinishes = entry.numFinishes;
        if (entry.tags.length > 0) {
            entryRaw.tags = entry.tags;
        }

        entryRaw.attempts = [];
        for (const attempt of entry.attempts) {
            const attemptRaw = {} as any;
            entryRaw.attempts.push(attemptRaw);

            attemptRaw.finished = attempt.finished == 1;
            attemptRaw.releasedate = formatDate(attempt.releasedate);

            for (const key of METRIC_TIME_KEYS) {
                if (attempt[key] === -1) {
                    continue
                }
                attemptRaw[key] = METRIC[key].formatValue!(attempt[key]);
            }

            for (const key of METRIC_NUMBER_KEYS) {
                if (attempt[key] === -1) {
                    continue;
                }
                attemptRaw[key] = attempt[key];
            }
        }
    }

    return stringify(tierlistRaw, { maxLength: 150 });
}

function generateTierlist(name: string) {
    const filename = `${name.toLowerCase().replace(/[^a-z0-9]/gi, "_")}.json`;
    return{
        filename,
        name,
        game: "Yellow",
        total: [0],
        thresholds_first: {},
        thresholds_best: {},
        entries: {}
    } as Tierlist;
}
