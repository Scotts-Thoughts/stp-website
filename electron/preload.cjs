const { contextBridge, ipcRenderer } = require('electron')

// Expose file system API to the renderer process
contextBridge.exposeInMainWorld('electronFS', {
  readFile: (filename) => ipcRenderer.invoke('fs:readFile', filename),
  writeFile: (filename, content) => ipcRenderer.invoke('fs:writeFile', filename, content),
  fileExists: (filename) => ipcRenderer.invoke('fs:fileExists', filename),
  listFiles: () => ipcRenderer.invoke('fs:listFiles'),
  listTrash: () => ipcRenderer.invoke('fs:listTrash'),
  deleteFile: (filename) => ipcRenderer.invoke('fs:deleteFile', filename),
  getWorkspacePath: () => ipcRenderer.invoke('fs:getWorkspacePath'),
})

// Expose dialog and export API
contextBridge.exposeInMainWorld('electronDialog', {
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  saveFile: (folderPath, filename, dataUrl) => ipcRenderer.invoke('dialog:saveFile', folderPath, filename, dataUrl),
  listExportFolder: (folderPath) => ipcRenderer.invoke('dialog:listExportFolder', folderPath),
})

// Expose update API to the renderer process
contextBridge.exposeInMainWorld('electronUpdate', {
  getAvailableVersion: () => ipcRenderer.invoke('update:getAvailableVersion'),
  install: () => ipcRenderer.invoke('update:install'),
})

// Indicate that we're running in Electron
contextBridge.exposeInMainWorld('isElectron', true)

