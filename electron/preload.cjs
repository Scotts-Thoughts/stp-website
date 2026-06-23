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

// Expose workspace management API to the renderer process
contextBridge.exposeInMainWorld('electronWorkspace', {
  changeDirectory: () => ipcRenderer.invoke('workspace:changeDirectory'),
  resetDirectory: () => ipcRenderer.invoke('workspace:resetDirectory'),
  isCustomDirectory: () => ipcRenderer.invoke('workspace:isCustomDirectory'),
})

// Expose update API to the renderer process
contextBridge.exposeInMainWorld('electronUpdate', {
  getAvailableVersion: () => ipcRenderer.invoke('update:getAvailableVersion'),
  install: () => ipcRenderer.invoke('update:install'),
})

// External-change watcher: lets the renderer subscribe to file-change notifications
// the main process emits when the window gains focus and a tracked file's mtime
// has advanced (e.g. the scheduler app wrote to a tierlist while we were unfocused).
contextBridge.exposeInMainWorld('electronWatch', {
  onExternalChange: (callback) => {
    const listener = (_event, filenames) => callback(filenames)
    ipcRenderer.on('workspace:externalChange', listener)
    return () => ipcRenderer.removeListener('workspace:externalChange', listener)
  },
  acknowledgeChange: (filename) => ipcRenderer.invoke('watch:acknowledgeChange', filename),
  checkNow: () => ipcRenderer.invoke('watch:checkNow'),
})

// Expose video export API
contextBridge.exposeInMainWorld('electronVideo', {
  createTempDir: () => ipcRenderer.invoke('video:createTempDir'),
  saveFrame: (tmpDir, frameIndex, dataUrl) => ipcRenderer.invoke('video:saveFrame', tmpDir, frameIndex, dataUrl),
  encode: (tmpDir, outputPath, fps, lossless) => ipcRenderer.invoke('video:encode', tmpDir, outputPath, fps, lossless),
  cleanup: (tmpDir) => ipcRenderer.invoke('video:cleanup', tmpDir),
  saveFileDialog: (defaultName) => ipcRenderer.invoke('dialog:saveFileDialog', defaultName),
})

// Indicate that we're running in Electron
contextBridge.exposeInMainWorld('isElectron', true)

