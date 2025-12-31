// Type definitions for the Electron file system API exposed via preload
declare global {
  interface Window {
    electronFS?: {
      readFile: (filename: string) => Promise<string>
      writeFile: (filename: string, content: string) => Promise<boolean>
      fileExists: (filename: string) => Promise<boolean>
      listFiles: () => Promise<Array<{ name: string; kind: 'file' | 'directory' }>>
      deleteFile: (filename: string) => Promise<boolean>
      getWorkspacePath: () => Promise<string>
    }
    electronDialog?: {
      selectFolder: () => Promise<string | null>
      saveFile: (folderPath: string, filename: string, dataUrl: string) => Promise<{ success: boolean; path?: string; error?: string }>
      listExportFolder: (folderPath: string) => Promise<Array<{ name: string; kind: 'file' | 'directory' }>>
    }
    isElectron?: boolean
  }
}

/**
 * Check if we're running in Electron
 */
export function isElectron(): boolean {
  return window.isElectron === true && window.electronFS !== undefined
}

/**
 * Electron-based file system class that mirrors the browser FS API
 */
class ElectronFS {
  async read(filename: string): Promise<string> {
    if (!window.electronFS) {
      throw new Error('Electron FS not available')
    }
    return window.electronFS.readFile(filename)
  }

  async write(filename: string, content: string): Promise<void> {
    if (!window.electronFS) {
      throw new Error('Electron FS not available')
    }
    await window.electronFS.writeFile(filename, content)
  }

  async fileExists(filename: string): Promise<boolean> {
    if (!window.electronFS) {
      throw new Error('Electron FS not available')
    }
    return window.electronFS.fileExists(filename)
  }

  async getDirEntries(_path: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
    if (!window.electronFS) {
      throw new Error('Electron FS not available')
    }
    return window.electronFS.listFiles()
  }

  async isDirEmpty(_path: string): Promise<boolean> {
    const entries = await this.getDirEntries(_path)
    return entries.length === 0
  }

  async deleteFile(filename: string): Promise<void> {
    if (!window.electronFS) {
      throw new Error('Electron FS not available')
    }
    await window.electronFS.deleteFile(filename)
  }

  get rootName(): string {
    return 'workspace'
  }
}

export default ElectronFS

