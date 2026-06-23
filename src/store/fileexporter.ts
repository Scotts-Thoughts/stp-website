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

    async function figureNextFileIndex(timestampPrefix: string, game: string) {
        if (timestampPrefix === "" || game === "") return -1;
        
        let entries: Array<{ name: string; kind: string }> = [];
        
        if (isElectron() && electronExportPath.value && window.electronDialog) {
            entries = await window.electronDialog.listExportFolder(electronExportPath.value);
        } else if (filesystem.value) {
            entries = await filesystem.value.getDirEntries("");
        } else {
            return -1;
        }

        const files = [];
        // find all files matching the pattern: YYYYMMDDHHMMSS-tierlist-${game}-*.png
        const pattern = new RegExp(`^${timestampPrefix}-tierlist-${game.toLowerCase()}-(\\d+)\\.png$`);
        for (const entry of entries) {
            if (entry.kind === "directory") continue;
            if (pattern.test(entry.name)) {
                files.push(entry.name);
            }
        }
        // if no files found, return 1
        if (files.length === 0) {
            return 1;
        }
        // extract the number from the filenames
        const nums = files
            .map(file => {
                const match = file.match(pattern);
                return match ? parseInt(match[1]) : 0;
            })
            .filter(num => !isNaN(num) && num > 0);
        // find the highest number and add 1 and return it
        return nums.length > 0 ? Math.max(...nums) + 1 : 1;
    }
    
    function generateTimestamp(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `${year}${month}${day}${hours}${minutes}${seconds}`;
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
        
        // Generate filename based on new format: YYYYMMDDHHMMSS-tierlist-${version}-${exportNumber}.png
        const tierlist = useTierlist();
        const game = tierlist.activeTierlist.game.toLowerCase();
        const timestamp = generateTimestamp();
        const exportNumber = await figureNextFileIndex(timestamp, game);
        if (exportNumber === -1) {
            cb?.("Failed to determine next file index", "error");
            exportInProgress.value = false;
            return;
        }
        const filename = `${timestamp}-tierlist-${game}-${exportNumber}.png`;

        cb?.(`Exporting...`, "start");

        const timeStart = performance.now();
        setTimeout(async () => {
            try {
                // Wait for all fonts to be loaded before exporting
                await document.fonts.ready;
                
                // Wait for export state to be applied (exporting class on root)
                await new Promise(resolve => requestAnimationFrame(resolve));
                await new Promise(resolve => requestAnimationFrame(resolve));
                
                // Wait a bit more to ensure all computed properties (like tier labels) are stable
                // Force Vue to finish any pending updates
                await new Promise(resolve => setTimeout(resolve, 100));
                await new Promise(resolve => requestAnimationFrame(resolve));
                
                // Find teleported elements that need to be included in export
                const appElement = document.getElementById('app');
                const tableWindows = Array.from(appElement?.querySelectorAll('.tierlist-table-window:not(.hidden)') || []) as HTMLElement[];
                const popovers = Array.from(document.body.querySelectorAll('.metric-popout') || []) as HTMLElement[];
                
                // Filter popovers that are actually visible
                const visiblePopovers = popovers.filter(p => {
                    const style = window.getComputedStyle(p);
                    return style.visibility !== 'hidden' && style.display !== 'none';
                });
                
                // Get root element's bounding rect BEFORE cloning (while it's in its final export state)
                const rootRect = root.getBoundingClientRect();
                
                // Store original states for restoration
                const elementRestoreData: Array<{
                    element: HTMLElement;
                    originalParent: Node | null;
                    originalNextSibling: Node | null;
                    originalStyle: string;
                }> = [];
                
                // Create a wrapper container that will hold everything for export
                const exportWrapper = document.createElement('div');
                exportWrapper.style.position = 'relative';
                exportWrapper.style.width = '1920px';
                exportWrapper.style.height = '1080px';
                exportWrapper.style.overflow = 'hidden';
                exportWrapper.style.backgroundColor = 'transparent';
                exportWrapper.style.fontFamily = "'Teko', sans-serif";
                
                // Clone the root element NOW - capture the current state of labels
                // Use cloneNode with deep=true to preserve all text content including labels
                const rootClone = root.cloneNode(true) as HTMLElement;
                // Ensure exporting class is applied
                rootClone.classList.add('exporting');
                exportWrapper.appendChild(rootClone);
                
                // Append wrapper to body temporarily so we can measure positions
                exportWrapper.style.position = 'fixed';
                exportWrapper.style.left = '0';
                exportWrapper.style.top = '0';
                exportWrapper.style.zIndex = '999999';
                document.body.appendChild(exportWrapper);
                
                // Wait for the cloned root to layout
                await new Promise(resolve => requestAnimationFrame(resolve));

                // Preserve each tier's current horizontal scroll position. cloneNode() resets a
                // scroll container's scrollLeft to 0, and html-to-image ignores scrollLeft anyway,
                // so we replicate the scroll by shifting the row's first flex child with a negative
                // margin (same technique the scroll-video recorder uses). We also add the left
                // edge-fade overlay for scrolled tiers (the `.exporting` CSS hides the real one),
                // so a scrolled export looks the same as on screen / in the scroll video.
                {
                    const liveRows = root.querySelectorAll('.entry-row');
                    const cloneRows = rootClone.querySelectorAll('.entry-row');
                    const count = Math.min(liveRows.length, cloneRows.length);
                    for (let i = 0; i < count; i++) {
                        const scrollLeft = (liveRows[i] as HTMLElement).scrollLeft;
                        if (scrollLeft <= 0) continue;
                        const firstChild = cloneRows[i].firstElementChild as HTMLElement | null;
                        if (firstChild) {
                            const baseMargin = parseFloat(getComputedStyle(firstChild).marginLeft) || 0;
                            firstChild.style.marginLeft = (baseMargin - scrollLeft) + 'px';
                        }
                        // Left edge-fade (inline styles mirror `.fade-left` in TierList.vue; the
                        // scoped CSS won't apply to a manually-created element). Fades in over 60px.
                        const wrapper = cloneRows[i].parentElement;
                        if (wrapper) {
                            const fade = document.createElement('div');
                            fade.style.cssText = [
                                'position: absolute',
                                'top: 0',
                                'bottom: 0',
                                'left: 0',
                                'width: 60px',
                                'pointer-events: none',
                                'z-index: 5',
                                'border-radius: 11px 0 0 11px',
                                'background: linear-gradient(to right, rgba(28, 28, 28, 1) 0%, rgba(28, 28, 28, 0) 100%)',
                                'opacity: ' + String(Math.min(scrollLeft / 60, 1)),
                            ].join('; ');
                            wrapper.appendChild(fade);
                        }
                    }
                }

                // Clone and position teleported elements
                [...tableWindows, ...visiblePopovers].forEach((element) => {
                    const clone = element.cloneNode(true) as HTMLElement;
                    const computedStyle = window.getComputedStyle(element);
                    
                    // Store original inline style for restoration
                    elementRestoreData.push({
                        element,
                        originalParent: element.parentNode,
                        originalNextSibling: element.nextSibling,
                        originalStyle: element.style.cssText,
                    });
                    
                    // For popovers, find the corresponding Pokemon element and calculate position
                    if (element.classList.contains('metric-popout')) {
                        // Find the Pokemon name from the popover content
                        const pokemonNameElement = element.querySelector('.header h3');
                        const pokemonName = pokemonNameElement?.textContent?.trim();
                        
                        if (pokemonName) {
                            // Find the Pokemon element in the original DOM to get relative position
                            const originalPkmnElement = root.querySelector(`[data-pokemon="${pokemonName}"]`) as HTMLElement;
                            if (originalPkmnElement) {
                                const originalPkmnRect = originalPkmnElement.getBoundingClientRect();
                                const popoverRect = element.getBoundingClientRect();
                                
                                // Calculate position relative to root (which will be at 0,0 in exportWrapper)
                                // The root is 1920x1080, so positions are relative to its top-left
                                const pkmnCenterX = originalPkmnRect.left - rootRect.left + originalPkmnRect.width / 2;
                                const popoverHeight = popoverRect.height;
                                
                                // Check if popover opens to top
                                const openToTop = popoverRect.top < originalPkmnRect.top;
                                
                                clone.style.position = 'absolute';
                                clone.style.left = `${pkmnCenterX}px`;
                                
                                if (openToTop) {
                                    clone.style.top = `${originalPkmnRect.top - rootRect.top - popoverHeight - 16}px`;
                                } else {
                                    clone.style.top = `${originalPkmnRect.bottom - rootRect.top + 8}px`;
                                }
                                
                                clone.style.transform = 'translateX(-50%)';
                                clone.style.zIndex = computedStyle.zIndex || '10000';
                                clone.style.margin = '0';
                                clone.style.visibility = 'visible';
                                
                                exportWrapper.appendChild(clone);
                                return;
                            }
                        }
                    }
                    
                    // For table windows and popovers that couldn't find their Pokemon, use viewport coordinates
                    const rect = element.getBoundingClientRect();
                    clone.style.position = 'absolute';
                    clone.style.left = `${rect.left - rootRect.left}px`;
                    clone.style.top = `${rect.top - rootRect.top}px`;
                    clone.style.transform = computedStyle.transform || '';
                    clone.style.zIndex = computedStyle.zIndex || '200';
                    clone.style.margin = '0';
                    clone.style.visibility = 'visible';
                    clone.classList.remove('hidden');
                    
                    exportWrapper.appendChild(clone);
                });
                
                // Wait for layout to settle and ensure everything is rendered
                await new Promise(resolve => requestAnimationFrame(resolve));
                await new Promise(resolve => requestAnimationFrame(resolve));
                
                // Ensure all fonts are loaded
                await document.fonts.ready;
                
                // Copy computed font styles to inline styles for all text elements in the clone
                // This ensures fonts are preserved during export
                const allClonedElements = exportWrapper.querySelectorAll('*');
                allClonedElements.forEach((el) => {
                    const htmlEl = el as HTMLElement;
                    const computedStyle = window.getComputedStyle(htmlEl);

                    // Copy font-related styles to ensure they're preserved
                    htmlEl.style.fontFamily = computedStyle.fontFamily;
                    htmlEl.style.fontSize = computedStyle.fontSize;
                    htmlEl.style.fontWeight = computedStyle.fontWeight;
                    htmlEl.style.fontStyle = computedStyle.fontStyle;
                    htmlEl.style.fontVariant = computedStyle.fontVariant;
                    htmlEl.style.letterSpacing = computedStyle.letterSpacing;
                    htmlEl.style.textRendering = computedStyle.textRendering;
                    // lineHeight intentionally NOT copied — converting relative values
                    // (1.05em, 1, normal) to absolute pixels shifts text vertically
                });
                
                // Wait for layout to settle after style changes
                await new Promise(resolve => requestAnimationFrame(resolve));
                await new Promise(resolve => setTimeout(resolve, 50));
                
                // Export options - ensure fonts are included
                // Build font CSS with embedded base64 fonts for reliable export
                let fontEmbedCSS = '';
                try {
                    const base = import.meta.env.BASE_URL || '/';
                    const fontFiles = [
                        { family: 'Teko', url: `${base}fonts/Teko-Bold.ttf` },
                        { family: 'play', url: `${base}fonts/Play-Bold.ttf` },
                        { family: 'oseb', url: `${base}fonts/OpenSans-ExtraBold.ttf` },
                        { family: 'osb', url: `${base}fonts/Play-Bold.ttf` },
                        { family: 'titan', url: `${base}fonts/TitanOne-Regular.ttf` },
                    ];
                    const fontPromises = fontFiles.map(async ({ family, url }) => {
                        const response = await fetch(url);
                        const blob = await response.blob();
                        const dataUrl = await new Promise<string>((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.readAsDataURL(blob);
                        });
                        return `@font-face { font-family: '${family}'; src: url(${dataUrl}) format('truetype'); }`;
                    });
                    fontEmbedCSS = (await Promise.all(fontPromises)).join('\n');
                } catch (e) {
                    // Fall back to letting html-to-image handle fonts
                }

                const exportOptions = {
                    backgroundColor: "transparent",
                    cacheBust: true,
                    pixelRatio: scale,
                    skipFonts: true, // We handle fonts ourselves via fontEmbedCSS
                    ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: false, preferredFontFormat: 'truetype' as const }),
                };
                
                if (isElectron() && window.electronDialog && electronExportPath.value) {
                    // Use Electron's file system
                    const dataUrl = await htmlToImage.toPng(exportWrapper, exportOptions);
                    
                    const result = await window.electronDialog.saveFile(electronExportPath.value, filename, dataUrl);
                    if (!result.success) {
                        cb?.("Failed to write file: " + result.error, "error");
                        exportInProgress.value = false;
                        return;
                    }
                } else {
                    // Use browser file system
                    const fs = filesystem.value!;
                    const blob = await htmlToImage.toBlob(exportWrapper, exportOptions);
        
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
    
                cb?.(`Exported [${exportNumber}] successfully in ${(time/1000).toFixed(3)}s`, "success");
            } catch (e) {
                cb?.("Failed to write file: " + e, "error");
            } finally {
                // Clean up: remove the export wrapper
                const wrapper = document.body.querySelector('div[style*="z-index: 999999"]');
                if (wrapper && wrapper.parentElement) {
                    wrapper.parentElement.removeChild(wrapper);
                }
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
