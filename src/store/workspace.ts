import { computed, ref } from 'vue';
import stringify from '../utils/stringify';

import { Tierlist, METRIC_STATIC_KEYS, METRIC_TIME_KEYS, METRIC, Metrics, TierlistEntry, METRIC_NUMBER_KEYS, TIERLIST_REQUIRED_KEYS } from '.';

import FS from '../utils/fs'
import ElectronFS, { isElectron } from '../utils/electron-fs'
import Result from '../utils/result';
import { getGameConfig, getGameOrder, TIERLIST_GAMES } from '../constants/games';
import { formatDate, parseDate, parseTime } from '../utils/time';
import { defineStore } from 'pinia';

/** Parse JSON, allowing trailing commas (which are invalid in strict JSON). */
function parseJsonLenient(jsonStr: string): unknown {
    try {
        return JSON.parse(jsonStr);
    } catch {
        // Remove trailing commas before ] or } (repeat to handle nested structures)
        let cleaned = jsonStr;
        let prev: string;
        do {
            prev = cleaned;
            cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');
        } while (prev !== cleaned);
        return JSON.parse(cleaned);
    }
}

/** Sort tierlists by TIERLIST_GAMES order (same as create dropdown), then by name within same game. */
function sortTierlistsByGameOrder(a: Tierlist, b: Tierlist): number {
    const orderA = getGameOrder(a.game);
    const orderB = getGameOrder(b.game);
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
}

/** Filename for a tierlist (e.g. "Black 2" -> "black_2.json"). */
function defaultTierlistFilename(gameName: string): string {
    return `${gameName.toLowerCase().replace(/[^a-z0-9]/gi, '_')}.json`;
}

/** JSON shape for a blank "Default Tierlist" per game (used when creating a new workspace). */
function blankDefaultTierlistJson(game: { name: string; platform: string; cartridgeImage?: string }) {
    return {
        name: 'Default Tierlist',
        game: game.name,
        total: [0],
        thresholds_first: {},
        thresholds_best: {},
        entries: {},
        platform: game.platform,
        ...(game.cartridgeImage && { cartridgeImage: game.cartridgeImage }),
        visible: true,
    };
}

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
    
    // Backup storage for tierlist entries (keyed by filename)
    // Used to restore deleted runs if tierlist is closed without saving
    const tierlistBackups = ref<Map<string, string>>(new Map());

    
    // Check if running in Electron
    const runningInElectron = isElectron();

    function setActiveTierlist(newIndex: number) {
        // When closing a tierlist (newIndex === -1), restore from backup if it exists
        // This ensures unsaved deletions are reverted when closing
        if (newIndex === -1 && activeTierlistIndex.value >= 0 && activeTierlistIndex.value < tierlists.value.length) {
            const currentTierlist = tierlists.value[activeTierlistIndex.value];
            restoreTierlistEntries(currentTierlist.filename, currentTierlist);
        }
        
        if (newIndex >= tierlists.value.length) {
            activeTierlistIndex.value = -1;
        } else {
            activeTierlistIndex.value = newIndex;
            // When opening a tierlist, also restore from backup as a safeguard
            if (newIndex >= 0) {
                const tierlist = tierlists.value[newIndex];
                restoreTierlistEntries(tierlist.filename, tierlist);
            }
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

    function setTierlistVisible(index: number, visible: boolean) {
        if (index >= 0 && index < tierlists.value.length) {
            tierlists.value[index].visible = visible;
        }
    }

    const TRASH_DIR = 'trash';

    /** Move tierlist to trash (recoverable). */
    async function moveTierlistToTrash(index: number) {
        if (index < 0 || index >= tierlists.value.length) {
            return Result.failure("Invalid tierlist index.");
        }
        const fs = runningInElectron ? electronFilesystem.value : filesystem.value;
        if (!fs) {
            return Result.failure("Filesystem not ready.");
        }
        const tierlist = tierlists.value[index];
        const filename = tierlist.filename;
        try {
            if (!runningInElectron && filesystem.value && !(await filesystem.value.dirExists(TRASH_DIR))) {
                await filesystem.value.createDir(TRASH_DIR);
            }
            const content = stringify(tierlist);
            await fs.write(`${TRASH_DIR}/${filename}`, content);
            if (await fs.fileExists(filename)) {
                await fs.deleteFile(filename);
            }
        } catch (e) {
            return Result.failure(`Failed to move to trash: ${e instanceof Error ? e.message : String(e)}`);
        }
        tierlistBackups.value.delete(filename);
        tierlists.value.splice(index, 1);
        if (activeTierlistIndex.value === index) {
            activeTierlistIndex.value = -1;
        } else if (activeTierlistIndex.value > index) {
            activeTierlistIndex.value--;
        }
        return Result.success(undefined);
    }

    /** Permanently delete a tierlist (no trash). */
    async function deleteTierlist(index: number) {
        if (index < 0 || index >= tierlists.value.length) {
            return Result.failure("Invalid tierlist index.");
        }
        const fs = runningInElectron ? electronFilesystem.value : filesystem.value;
        if (!fs) {
            return Result.failure("Filesystem not ready.");
        }
        const tierlist = tierlists.value[index];
        const filename = tierlist.filename;
        try {
            if (await fs.fileExists(filename)) {
                await fs.deleteFile(filename);
            }
        } catch (e) {
            return Result.failure(`Failed to delete file: ${e instanceof Error ? e.message : String(e)}`);
        }
        tierlistBackups.value.delete(filename);
        tierlists.value.splice(index, 1);
        if (activeTierlistIndex.value === index) {
            activeTierlistIndex.value = -1;
        } else if (activeTierlistIndex.value > index) {
            activeTierlistIndex.value--;
        }
        return Result.success(undefined);
    }

    /** List tierlists in trash (filename + display name). */
    async function getTrashContents(): Promise<{ filename: string; name: string }[]> {
        const fs = runningInElectron ? electronFilesystem.value : filesystem.value;
        if (!fs) return [];
        let filenames: string[];
        if (runningInElectron) {
            filenames = await (fs as ElectronFS).listTrash();
        } else {
            const brFs = fs as FS;
            if (!(await brFs.dirExists(TRASH_DIR))) return [];
            const entries = await fs.getDirEntries(TRASH_DIR);
            filenames = entries.filter(e => e.kind === 'file' && e.name.endsWith('.json')).map(e => e.name);
        }
        const result: { filename: string; name: string }[] = [];
        for (const fn of filenames) {
            try {
                const data = await fs.read(`${TRASH_DIR}/${fn}`);
                const parsed = parseTierlist(data);
                result.push({ filename: fn, name: parsed?.name ?? fn });
            } catch (_) {
                result.push({ filename: fn, name: fn });
            }
        }
        return result;
    }

    /** Restore a tierlist from trash. */
    async function restoreFromTrash(filename: string) {
        const fs = runningInElectron ? electronFilesystem.value : filesystem.value;
        if (!fs) return Result.failure("Filesystem not ready.");
        const trashPath = `${TRASH_DIR}/${filename}`;
        try {
            const data = await fs.read(trashPath);
            const tierlist = parseTierlist(data);
            if (!tierlist) return Result.failure("Invalid tierlist in trash.");
            tierlist.filename = filename;
            if (await fs.fileExists(filename)) {
                return Result.failure("A tierlist with that name already exists.");
            }
            await fs.write(filename, stringify(tierlist));
            await fs.deleteFile(trashPath);
            tierlists.value.push(tierlist);
            tierlists.value.sort(sortTierlistsByGameOrder);
            backupTierlistEntries(filename, tierlist);
            return Result.success(undefined);
        } catch (e) {
            return Result.failure(`Failed to restore: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /** Permanently remove all tierlists in trash. */
    async function emptyTrash() {
        const fs = runningInElectron ? electronFilesystem.value : filesystem.value;
        if (!fs) return Result.failure("Filesystem not ready.");
        let filenames: string[];
        if (runningInElectron) {
            filenames = await (fs as ElectronFS).listTrash();
        } else {
            const brFs = fs as FS;
            if (!(await brFs.dirExists(TRASH_DIR))) return Result.success(undefined);
            const entries = await fs.getDirEntries(TRASH_DIR);
            filenames = entries.filter(e => e.kind === 'file' && e.name.endsWith('.json')).map(e => e.name);
        }
        try {
            for (const fn of filenames) {
                await fs.deleteFile(`${TRASH_DIR}/${fn}`);
            }
            return Result.success(undefined);
        } catch (e) {
            return Result.failure(`Failed to empty trash: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    async function createTierlist(name: string, game?: string) {
        const fs = runningInElectron ? electronFilesystem.value : filesystem.value;
        if (!fs) {
            return Result.failure("Filesystem not ready.");
        }

        const tierlist = generateTierlist(name, game);
        const path = tierlist.filename;

        if (await fs.fileExists(path)) {
            return Result.failure("Tierlist already exists.");
        }

        await fs.write(path, stringify(tierlist));
        tierlists.value.push(tierlist);
        tierlists.value.sort(sortTierlistsByGameOrder);

        // return the index of the new tierlist
        const newIndex = tierlists.value.findIndex(t => t.filename === tierlist.filename);
        return Result.success(newIndex >= 0 ? newIndex : tierlists.value.length - 1);
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
        // If workspace is empty, create a new workspace with required files and default tierlists
        const dirEmpty = await fs.isDirEmpty("");
        if (dirEmpty) {
            await fs.write("settings.json", "{}");
            await fs.write("pokemon.json", "{}");
            for (const game of TIERLIST_GAMES) {
                const filename = defaultTierlistFilename(game.name);
                const content = JSON.stringify(blankDefaultTierlistJson(game), null, 2);
                await fs.write(filename, content);
            }
        } else {
            // Workspace has files but may be missing required files (e.g. old install) – create them if missing
            if (!(await fs.fileExists("settings.json"))) {
                await fs.write("settings.json", "{}");
            }
            if (!(await fs.fileExists("pokemon.json"))) {
                await fs.write("pokemon.json", "{}");
            }
            // If there are no non-Scott tierlist files yet (none or only scott-*.json), add default tierlists
            const entries = await fs.getDirEntries("/");
            const hasNonScottTierlists = entries.some(
                (e) =>
                    e.kind === "file" &&
                    e.name.endsWith(".json") &&
                    !["settings.json", "pokemon.json"].includes(e.name) &&
                    !e.name.startsWith("scott-")
            );
            if (!hasNonScottTierlists) {
                for (const game of TIERLIST_GAMES) {
                    const filename = defaultTierlistFilename(game.name);
                    const content = JSON.stringify(blankDefaultTierlistJson(game), null, 2);
                    await fs.write(filename, content);
                }
            }
        }

        // Load files (required files now exist)
        try {
            settings.value = parseJsonLenient(await fs.read("settings.json")) as any;
        } catch (e) {
            return Result.failure(`Invalid JSON in settings.json: ${e instanceof Error ? e.message : String(e)}`);
        }
        try {
            pokemonSettings.value = parseJsonLenient(await fs.read("pokemon.json")) as PokemonSettings;
        } catch (e) {
            return Result.failure(`Invalid JSON in pokemon.json: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Clear existing backups since we're reloading from disk
        tierlistBackups.value.clear();

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
            let tierlist: Tierlist | undefined;
            try {
                tierlist = parseTierlist(data);
            } catch (e) {
                console.warn(`Invalid JSON in ${entry.name}:`, e);
                continue;
            }
            if (!tierlist) {
                console.warn(`Failed to parse tierlist: ${entry.name}`);
                continue;
            }
            tierlist.filename = entry.name;
            tierlists.value.push(tierlist);
            // Store the raw file content as backup (before any edits)
            tierlistBackups.value.set(entry.name, data);
        }

        // sort tierlists by game order (same as "Create new tierlist" dropdown), then by name within same game
        tierlists.value.sort(sortTierlistsByGameOrder);

        return Result.success(undefined);
    }

    async function saveWorkspace() {
        const fs = runningInElectron ? electronFilesystem.value : filesystem.value;
        if (!fs) return Result.failure("Filesystem not ready.");

        await Promise.all([
            fs.write("settings.json", stringify(settings.value, { maxLength: 150 })),
            fs.write("pokemon.json", stringify(pokemonSettings.value, { maxLength: 150 })),
            ...tierlists.value.map(tierlist => {
                // Update backup after saving
                backupTierlistEntries(tierlist.filename, tierlist);
                return fs.write(tierlist.filename, stringifyTierlist(tierlist));
            })
        ]);

        return Result.success(undefined);
    }

    function backupTierlistEntries(filename: string, tierlist: Tierlist) {
        tierlistBackups.value.set(filename, stringifyTierlist(tierlist));
    }

    function restoreTierlistEntries(filename: string, tierlist: Tierlist) {
        const backupContent = tierlistBackups.value.get(filename);
        if (!backupContent) return;

        const restored = parseTierlist(backupContent);
        if (!restored) return;

        tierlist.thresholds_first = restored.thresholds_first;
        tierlist.thresholds_best = restored.thresholds_best;
        tierlist.entries = restored.entries;
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
        setTierlistVisible,
        moveTierlistToTrash,
        deleteTierlist,
        getTrashContents,
        restoreFromTrash,
        emptyTrash,
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
    const tierlistRaw = parseJsonLenient(data) as any;

    for (const key of TIERLIST_REQUIRED_KEYS) {
        if (!tierlistRaw[key]) {
            return undefined;
        }
    }

    const tierlist = {} as Tierlist;

    tierlist.filename = "";
    tierlist.name = tierlistRaw.name;
    let gameName = tierlistRaw.game || "Yellow";
    if (gameName === "Black2") gameName = "Black 2";
    if (gameName === "White2") gameName = "White 2";
    tierlist.game = gameName;
    tierlist.total = tierlistRaw.total;
    tierlist.thresholds_first = {};
    tierlist.thresholds_best = {};
    tierlist.imageSource = tierlistRaw.imageSource;
    // Ensure platform and cartridgeImage from config so tierlists appear in correct row (e.g. Red, Yellow, Crystal)
    const gameConfig = getGameConfig(tierlist.game);
    tierlist.platform = gameConfig?.platform ?? tierlistRaw.platform;
    tierlist.cartridgeImage = gameConfig?.cartridgeImage ?? tierlistRaw.cartridgeImage;
    tierlist.visible = tierlistRaw.visible !== undefined ? tierlistRaw.visible : true;
    tierlist.finalTierLabel = tierlistRaw.finalTierLabel;
    tierlist.surgeTierLabel = tierlistRaw.surgeTierLabel;
    tierlist.surgeTierImage = tierlistRaw.surgeTierImage;
    tierlist.brunoTierLabel = tierlistRaw.brunoTierLabel;
    tierlist.brunoTierImage = tierlistRaw.brunoTierImage;
    tierlist.sTierLabel = tierlistRaw.sTierLabel;
    tierlist.aTierLabel = tierlistRaw.aTierLabel;
    tierlist.bTierLabel = tierlistRaw.bTierLabel;
    tierlist.cTierLabel = tierlistRaw.cTierLabel;
    tierlist.dTierLabel = tierlistRaw.dTierLabel;
    tierlist.eTierLabel = tierlistRaw.eTierLabel;
    tierlist.fTierLabel = tierlistRaw.fTierLabel;

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
    if (tierlist.finalTierLabel) tierlistRaw.finalTierLabel = tierlist.finalTierLabel;
    if (tierlist.surgeTierLabel) tierlistRaw.surgeTierLabel = tierlist.surgeTierLabel;
    if (tierlist.surgeTierImage) tierlistRaw.surgeTierImage = tierlist.surgeTierImage;
    if (tierlist.brunoTierLabel) tierlistRaw.brunoTierLabel = tierlist.brunoTierLabel;
    if (tierlist.brunoTierImage) tierlistRaw.brunoTierImage = tierlist.brunoTierImage;
    if (tierlist.sTierLabel) tierlistRaw.sTierLabel = tierlist.sTierLabel;
    if (tierlist.aTierLabel) tierlistRaw.aTierLabel = tierlist.aTierLabel;
    if (tierlist.bTierLabel) tierlistRaw.bTierLabel = tierlist.bTierLabel;
    if (tierlist.cTierLabel) tierlistRaw.cTierLabel = tierlist.cTierLabel;
    if (tierlist.dTierLabel) tierlistRaw.dTierLabel = tierlist.dTierLabel;
    if (tierlist.eTierLabel) tierlistRaw.eTierLabel = tierlist.eTierLabel;
    if (tierlist.fTierLabel) tierlistRaw.fTierLabel = tierlist.fTierLabel;

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

function generateTierlist(name: string, game?: string): Tierlist {
    const gameName = game ?? "Yellow";
    const config = getGameConfig(gameName);
    const filename = `${name.toLowerCase().replace(/[^a-z0-9]/gi, "_")}.json`;
    return {
        filename,
        name,
        game: gameName,
        total: [0],
        thresholds_first: {},
        thresholds_best: {},
        entries: {},
        platform: config?.platform,
        cartridgeImage: config?.cartridgeImage,
        visible: true,
    } as Tierlist;
}
