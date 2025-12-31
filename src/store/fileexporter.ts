import { computed, readonly, ref } from 'vue';
import * as htmlToImage from 'html-to-image';

import FS from '../utils/fs'
import { defineStore } from 'pinia';
import { useTierlist } from '.';
import Result from '../utils/result';
import { isElectron } from '../utils/electron-fs';


export const useFileExporter = defineStore("file-exporter", () => {
    const filesystem = ref<FS>();
    const electronExportPath = ref<string>("");
    const filePrefix = ref<string>("");
    const exportInProgress = ref<boolean>(false);

    const folderOpened = computed(() => {
        if (isElectron() && electronExportPath.value) {
            return electronExportPath.value.split(/[/\\]/).pop() || 'Export Folder';
        }
        return filesystem.value !== undefined ? filesystem.value.rootName : undefined;
    });

    async function figureNextFileIndex(prefix: string) {
        if (prefix === "") return -1;
        
        let entries: Array<{ name: string; kind: string }> = [];
        
        if (isElectron() && electronExportPath.value && window.electronDialog) {
            entries = await window.electronDialog.listExportFolder(electronExportPath.value);
        } else if (filesystem.value) {
            entries = await filesystem.value.getDirEntries("");
        } else {
            return -1;
        }

        const files = [];
        // find all files with the given prefix
        for (const entry of entries) {
            if (entry.kind === "directory") continue;
            if (entry.name.startsWith(prefix) && entry.name.endsWith(".png")) {
                files.push(entry.name);
            }
        }
        // if no files found, return 0
        if (files.length === 0) {
            return 0;
        }
        // extract the number from the filenames
        const nums = files
            .map(file => parseInt(file.slice(prefix.length + 1, -4)))
            .filter(num => !isNaN(num));
        // find the highest number and add 1 and return it
        return Math.max(...nums) + 1;
    }
    
    function generateFilePrefix(): string {
        const tierlist = useTierlist();
        const name = tierlist.activeTierlist.name;
        const game = tierlist.activeTierlist.game;
        const category = tierlist.activeCategory === "first" ? "first" : "followup";
        
        // Extract generation from tierlist name (e.g., "Gen 1 - Yellow" -> "gen1")
        // or from the game name pattern
        let generation = "";
        const genMatch = name.match(/gen\s*(\d+)/i);
        if (genMatch) {
            generation = `gen${genMatch[1]}`;
        } else {
            // Fallback: try to infer from game name
            const gameToGen: Record<string, string> = {
                "red": "gen1", "blue": "gen1", "yellow": "gen1", "green": "gen1",
                "gold": "gen2", "silver": "gen2", "crystal": "gen2",
                "ruby": "gen3", "sapphire": "gen3", "emerald": "gen3", "firered": "gen3", "leafgreen": "gen3",
                "diamond": "gen4", "pearl": "gen4", "platinum": "gen4", "heartgold": "gen4", "soulsilver": "gen4",
                "black": "gen5", "white": "gen5", "black2": "gen5", "white2": "gen5",
            };
            generation = gameToGen[game.toLowerCase()] || "gen0";
        }
        
        // Format: gen1-yellow-first or gen1-yellow-followup
        return `${generation}-${game.toLowerCase()}-${category}`;
    }

    function unloadFolder() {
        filesystem.value = undefined;
        electronExportPath.value = "";
        filePrefix.value = "";
    }

    async function selectFolder() {
        // if export is in progress, do nothing
        if (exportInProgress.value) {
            return Result.failure("Export currently in progress");
        }

        const tierlist = useTierlist();

        // Use Electron dialog if available
        if (isElectron() && window.electronDialog) {
            const folderPath = await window.electronDialog.selectFolder();
            if (!folderPath) {
                return Result.failure("User cancelled folder selection");
            }
            electronExportPath.value = folderPath;
        } else {
            // request the user to select a folder (browser mode)
            filesystem.value = undefined;
            // max 32 characters
            const result = await FS.create(tierlist.activeTierlist.name.toLocaleLowerCase().replace(/( )/gi, "").substring(0, 32-7) + "_picker");
            if (!result.success) return result;
            filesystem.value = result.data;
        }
        
        return Result.success(undefined);
    }

    function selectFilePrefix(prefix: string) {
        filePrefix.value = prefix;
    }

    async function exportElement(root: HTMLElement, scale: number = 1, cb?: (message: string, state: "start" | "success" | "error") => void) {
        if (exportInProgress.value) {
            cb?.("Export already in progress", "error");
            return;
        }
        
        const needsFolderSelection = isElectron() 
            ? !electronExportPath.value 
            : !filesystem.value;
            
        if (needsFolderSelection) {
            const result = await selectFolder();
            if (!result.success) {
                exportInProgress.value = false;
                cb?.(result.message, "error");
                return;
            }
        }
        exportInProgress.value = true;
        
        // Generate filename based on current tierlist: gen1-yellow-first-001.png
        const currentPrefix = generateFilePrefix();
        const index = await figureNextFileIndex(currentPrefix);
        if (index === -1) {
            cb?.("Failed to determine next file index", "error");
            exportInProgress.value = false;
            return;
        }
        const filename = `${currentPrefix}-${index.toString().padStart(3, '0')}.png`;

        cb?.(`Exporting...`, "start");

        const timeStart = performance.now();
        setTimeout(async () => {
            try {
                // Wait for all fonts to be loaded before exporting
                await document.fonts.ready;
                
                // Export options - let the element define its own dimensions (1920x1080 wrapper)
                // Don't override width/height as this can break CSS grid layouts
                const exportOptions = {
                    backgroundColor: "transparent",
                    cacheBust: true,
                    pixelRatio: scale,
                    // Ensure fonts are properly embedded in export
                    skipFonts: false,
                    preferredFontFormat: 'woff2',
                };
                
                if (isElectron() && window.electronDialog && electronExportPath.value) {
                    // Use Electron's file system
                    const dataUrl = await htmlToImage.toPng(root, exportOptions);
                    
                    const result = await window.electronDialog.saveFile(electronExportPath.value, filename, dataUrl);
                    if (!result.success) {
                        cb?.("Failed to write file: " + result.error, "error");
                        exportInProgress.value = false;
                        return;
                    }
                } else {
                    // Use browser file system
                    const fs = filesystem.value!;
                    const blob = await htmlToImage.toBlob(root, exportOptions);
        
                    if (blob) {
                        await fs.write(filename, blob);
                    } else {
                        cb?.("Failed to export", "error");
                        exportInProgress.value = false;
                        return;
                    }
                }
    
                const timeEnd = performance.now();
                const time = timeEnd - timeStart;
    
                cb?.(`Exported [${index}] successfully in ${(time/1000).toFixed(3)}s`, "success");
            } catch (e) {
                cb?.("Failed to write file: " + e, "error");
            }
    
            exportInProgress.value = false;
        }, 100);
    }


    return {
        selectFolder,
        selectFilePrefix,
        unloadFolder,
        exportElement,
        folderOpened,
        filePrefix,
        exportInProgress: readonly(exportInProgress)
    }
})
