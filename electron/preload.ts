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

// Expose update API to the renderer process
contextBridge.exposeInMainWorld('electronUpdate', {
  getAvailableVersion: (): Promise<string | null> =>
    ipcRenderer.invoke('update:getAvailableVersion'),
  install: (): Promise<void> =>
    ipcRenderer.invoke('update:install'),
})

// Indicate that we're running in Electron
contextBridge.exposeInMainWorld('isElectron', true)




