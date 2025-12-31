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

    async function figureFilePrefix() {
        let entries: Array<{ name: string; kind: string }> = [];
        
        if (isElectron() && electronExportPath.value && window.electronDialog) {
            entries = await window.electronDialog.listExportFolder(electronExportPath.value);
        } else if (filesystem.value) {
            entries = await filesystem.value.getDirEntries("");
        } else {
            return "";
        }

        // find all files that end with "-\d+.png"
        const files = [];
        for (const entry of entries) {
            if (entry.kind === "directory") continue;
            const match = entry.name.match(/\-\d+\.png$/);
            if (match) {
                files.push({
                    name: entry.name,
                    num: parseInt(match[0].slice(1, -4), 10)
                });
            }
        }
        // if no files found, the user has to provide a prefix
        if (files.length === 0) {
            return "";
        }
        // sort the files by the number in the filename
        files.sort((a, b) => a.num - b.num);
        // return the prefix of the file with the highest number
        const last = files[files.length - 1];
        return last.name.match(/^(.*)\-\d+\.png$/)?.[1] ?? "";
    }

    async function figureNextFileIndex() {
        if (filePrefix.value === "") return -1;
        
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
            if (entry.name.startsWith(filePrefix.value) && entry.name.endsWith(".png")) {
                files.push(entry.name);
            }
        }
        // if no files found, return 0
        if (files.length === 0) {
            return 0;
        }
        // extract the number from the filenames
        const nums = files
            .map(file => parseInt(file.slice(filePrefix.value.length + 1, -4)))
            .filter(num => !isNaN(num));
        // find the highest number and add 1 and return it
        return Math.max(...nums) + 1;
    }

    function unloadFolder() {
        filesystem.value = undefined;
        electronExportPath.value = "";
        filePrefix.value = "";
    }

    async function selectFolder(askForPrefix: boolean = false) {
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
        
        if (!askForPrefix) return Result.success(undefined);
        
        // Auto-generate prefix from existing files or tierlist name
        let prefix = await figureFilePrefix();
        if (prefix === "") {
            // Generate prefix from tierlist name: "Gen 1 - Yellow Tierlist" -> "gen_1_-_yellow_tierlist"
            prefix = tierlist.activeTierlist.name.toLocaleLowerCase().replace(/\s+/g, "_");
        }
        filePrefix.value = prefix;

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
            const result = await selectFolder(true);
            if (!result.success) {
                exportInProgress.value = false;
                cb?.(result.message, "error");
                return;
            }
        }
        exportInProgress.value = true;
        
        const index = await figureNextFileIndex();
        if (filePrefix.value === "") {
            cb?.("No file prefix set", "error");
            exportInProgress.value = false;
            return;
        }
        if (index === -1) {
            cb?.("Failed to determine next file index", "error");
            exportInProgress.value = false;
            return;
        }
        const filename = `${filePrefix.value}-${index.toString().padStart(3, '0')}.png`;

        cb?.(`Exporting...`, "start");

        const timeStart = performance.now();
        setTimeout(async () => {
            try {
                // Fixed export dimensions for consistent 1920x1080 output
                const exportOptions = {
                    backgroundColor: "transparent",
                    cacheBust: true,
                    pixelRatio: scale,
                    width: 1920,
                    height: 1080,
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
