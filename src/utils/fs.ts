import { get, update, del } from 'idb-keyval';
import Result from "./result";

class FS {
    static async removeCachedHandle(id: string) {
        const key = 'fs-api-handles__' + id;
        del(key);
    }

    static async checkHandleCached(id: string) {
        const key = 'fs-api-handles__' + id;
        const cachedRootHandle = await get<FileSystemDirectoryHandle>(key);

        if (!cachedRootHandle) return false;
        
        const option = { mode: 'readwrite' } as const;
        if ((await cachedRootHandle.queryPermission(option)) !== 'granted') return false;
        if ((await cachedRootHandle.requestPermission(option)) !== 'granted') return false;
        
        return true;
    }

    /**
     * Prompts the user to select a root directory.
     */
    static async create(id: string, cacheHandle = false) {
        try {
            // Check if File System Access API is available
            if (typeof window === 'undefined' || !window.showDirectoryPicker) {
                return Result.failure(
                    "File System Access API is not available. " +
                    "Please use a supported browser (Chrome, Edge) or enable the API in Brave browser settings."
                );
            }

            const key = 'fs-api-handles__' + id;

            if (cacheHandle && await this.checkHandleCached(id)) {
                const cachedRootHandle = await get<FileSystemDirectoryHandle>(key);
                return Result.success(new FS(cachedRootHandle!));
            }

            // Ensure we're calling from a user gesture context
            // This is important for Brave browser compatibility
            const rootHandle = await window.showDirectoryPicker({
                id, 
                mode: "readwrite"
            });

            if (cacheHandle) {
                await update(key, () => rootHandle);
            }

            return Result.success(new FS(rootHandle));
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            const errorMessage = error.message || String(e);
            
            // Provide more specific error messages for common issues
            if (errorMessage.includes('AbortError') || errorMessage.includes('cancel')) {
                return Result.failure("Directory picker was cancelled.");
            } else if (errorMessage.includes('NotAllowedError') || errorMessage.includes('permission')) {
                return Result.failure(
                    "Permission denied. Brave browser may have blocked the folder picker. " +
                    "Please check your browser settings and allow file system access, or try clicking the button again."
                );
            } else if (errorMessage.includes('user activation') || errorMessage.includes('gesture')) {
                return Result.failure(
                    "User interaction required. Please click the button again. " +
                    "Brave browser requires direct user interaction to open the folder picker."
                );
            } else {
                return Result.failure(`Failed to open directory picker: ${errorMessage}`);
            }
        }
    }


    private rootHandle: FileSystemDirectoryHandle;
    private dirCache = new Map<string, FileSystemDirectoryHandle>();
    private fileCache = new Map<string, FileSystemFileHandle>();

    private constructor(rootHandle: FileSystemDirectoryHandle) {
        this.rootHandle = rootHandle;
    }

    private async getDirHandle(path: string, create = true) {
        if (path === "") {
            return this.rootHandle;
        }
        if (this.dirCache.has(path)) {
            return this.dirCache.get(path)!;
        }
        let handle = this.rootHandle;
        const path_parts = path.split("/");
        let complete_path = "";
        for (const part of path_parts) {
            if (part === "") continue;
            complete_path += part + "/";
            handle = await handle.getDirectoryHandle(part, { create });
            this.dirCache.set(complete_path, handle);
        }
        return handle;
    }

    private async getFileHandle(path: string, create = true) {
        if (this.fileCache.has(path)) {
            return this.fileCache.get(path)!;
        }
        const [f1, d, f2] = path.split(/(.*)\//);
        if (f1 !== "") {
            const dirHandle = this.rootHandle;
            const handle = await dirHandle.getFileHandle(f1, { create });
            this.fileCache.set(path, handle);
            return handle;
        } else {
            const dirHandle = await this.getDirHandle(d, create);
            const handle = await dirHandle.getFileHandle(f2, { create });
            this.fileCache.set(path, handle);
            return handle;
        }
    }

    private async getWritable(path: string) {
        const handle = await this.getFileHandle(path);
        return handle.createWritable();
    }

    private async getFile(path: string) {
        const handle = await this.getFileHandle(path, false)
        return handle.getFile()
    }

    get rootName() {
        return this.rootHandle.name;
    }

    /**
     * Creates a directory at the given path.
     **/
    async createDir(path: string) {
        await this.getDirHandle(path);
    }

    /**
     * Returns true if the given directory exists.
     **/
    async dirExists(path: string) {
        try {
            await this.getDirHandle(path, false);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Returns an array of directories and files for the given path.
     */
    async getDirEntries(path: string) {
        try {
            const entries = [];
            const handle = await this.getDirHandle(path, false);
            for await (const entry of handle.values()) {
                entries.push({ name: entry.name, kind: entry.kind });
            }
            return entries;
        } catch (e) {
            return [];
        }
    }

    /**
     * Returns true if the given path is empty.
     */
    async isDirEmpty(path: string) {
        const entries = await this.getDirEntries(path);
        return entries.length === 0;
    }

    /**
     * Returns true if the given file exists.
     **/
    async fileExists(path: string) {
        try {
            await this.getFileHandle(path, false);
            return true;
        } catch (e) {
            return false;
        }
    }
    /**
     * Writes the given data to the given path.
     **/
    async write(path: string, data: FileSystemWriteChunkType) {
        const writable = await this.getWritable(path);
        await writable.write(data);
        return writable.close();
    }

    /**
     * Reads the contents of the given path.
     **/
    async read(path: string) {
        const file = await this.getFile(path);
        return file.text();
    }

    async lastModified(path: string) {
        const file = await this.getFile(path);
        return file.lastModified
    }
}

export default FS;
