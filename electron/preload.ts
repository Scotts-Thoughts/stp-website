import { contextBridge, ipcRenderer } from 'electron'

// Expose file system API to the renderer process
contextBridge.exposeInMainWorld('electronFS', {
  readFile: (filename: string): Promise<string> => 
    ipcRenderer.invoke('fs:readFile', filename),
  
  writeFile: (filename: string, content: string): Promise<boolean> => 
    ipcRenderer.invoke('fs:writeFile', filename, content),
  
  fileExists: (filename: string): Promise<boolean> => 
    ipcRenderer.invoke('fs:fileExists', filename),
  
  listFiles: (): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> => 
    ipcRenderer.invoke('fs:listFiles'),

  listTrash: (): Promise<string[]> =>
    ipcRenderer.invoke('fs:listTrash'),

  deleteFile: (filename: string): Promise<boolean> => 
    ipcRenderer.invoke('fs:deleteFile', filename),
  
  getWorkspacePath: (): Promise<string> => 
    ipcRenderer.invoke('fs:getWorkspacePath'),
})

// Expose workspace management API to the renderer process
contextBridge.exposeInMainWorld('electronWorkspace', {
  changeDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('workspace:changeDirectory'),
  resetDirectory: (): Promise<string> =>
    ipcRenderer.invoke('workspace:resetDirectory'),
  isCustomDirectory: (): Promise<boolean> =>
    ipcRenderer.invoke('workspace:isCustomDirectory'),
})

// Expose update API to the renderer process
contextBridge.exposeInMainWorld('electronUpdate', {
  getAvailableVersion: (): Promise<string | null> =>
    ipcRenderer.invoke('update:getAvailableVersion'),
  install: (): Promise<void> =>
    ipcRenderer.invoke('update:install'),
})

// External-change watcher: lets the renderer subscribe to file-change notifications
// the main process emits when the window gains focus and a tracked file's mtime
// has advanced (e.g. the scheduler app wrote to a tierlist while we were unfocused).
contextBridge.exposeInMainWorld('electronWatch', {
  onExternalChange: (callback: (filenames: string[]) => void): (() => void) => {
    const listener = (_event: unknown, filenames: string[]) => callback(filenames)
    ipcRenderer.on('workspace:externalChange', listener)
    return () => ipcRenderer.removeListener('workspace:externalChange', listener)
  },
  acknowledgeChange: (filename: string): Promise<void> =>
    ipcRenderer.invoke('watch:acknowledgeChange', filename),
  checkNow: (): Promise<string[]> =>
    ipcRenderer.invoke('watch:checkNow'),
})

// Indicate that we're running in Electron
contextBridge.exposeInMainWorld('isElectron', true)




