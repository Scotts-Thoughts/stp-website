import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs, { Dirent } from 'fs'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
  if (require('electron-squirrel-startup')) {
    app.quit()
  }
} catch {
  // electron-squirrel-startup not available in dev mode
}

// Get the user data path for storing tierlists
function getUserDataPath(): string {
  return path.join(app.getPath('userData'), 'workspace')
}

// Initialize workspace with bundled data if it doesn't exist
async function initializeWorkspace(): Promise<void> {
  const workspacePath = getUserDataPath()
  
  // Create workspace directory if it doesn't exist
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true })
    
    // Copy bundled workspace data
    const bundledDataPath = app.isPackaged
      ? path.join(process.resourcesPath, 'workspace')
      : path.join(__dirname, '..', 'bundled-workspace')
    
    if (fs.existsSync(bundledDataPath)) {
      const files = fs.readdirSync(bundledDataPath)
      for (const file of files) {
        const srcPath = path.join(bundledDataPath, file)
        const destPath = path.join(workspacePath, file)
        fs.copyFileSync(srcPath, destPath)
      }
      console.log('Initialized workspace with bundled data')
    }
  }
}

function createWindow(): void {
  // Preload script path differs between dev and production
  const preloadPath = app.isPackaged
    ? path.join(__dirname, 'preload.cjs')
    : path.join(__dirname, '..', 'electron', 'preload.cjs')
  
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#1a1a1a',
    show: false,
    autoHideMenuBar: true, // Hide menu bar by default (Alt to show)
  })

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// IPC Handlers for file system operations
function setupIpcHandlers(): void {
  const workspacePath = getUserDataPath()

  ipcMain.handle('fs:readFile', async (_event: Electron.IpcMainInvokeEvent, filename: string) => {
    const filePath = path.join(workspacePath, filename)
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch (error) {
      throw new Error(`Failed to read file: ${filename}`)
    }
  })

  ipcMain.handle('fs:writeFile', async (_event: Electron.IpcMainInvokeEvent, filename: string, content: string) => {
    const filePath = path.join(workspacePath, filename)
    try {
      fs.writeFileSync(filePath, content, 'utf-8')
      return true
    } catch (error) {
      throw new Error(`Failed to write file: ${filename}`)
    }
  })

  ipcMain.handle('fs:fileExists', async (_event: Electron.IpcMainInvokeEvent, filename: string) => {
    const filePath = path.join(workspacePath, filename)
    return fs.existsSync(filePath)
  })

  ipcMain.handle('fs:listFiles', async () => {
    try {
      const entries = fs.readdirSync(workspacePath, { withFileTypes: true })
      return entries.map((entry: Dirent) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file'
      }))
    } catch (error) {
      return []
    }
  })

  ipcMain.handle('fs:deleteFile', async (_event: Electron.IpcMainInvokeEvent, filename: string) => {
    const filePath = path.join(workspacePath, filename)
    try {
      fs.unlinkSync(filePath)
      return true
    } catch (error) {
      throw new Error(`Failed to delete file: ${filename}`)
    }
  })

  ipcMain.handle('fs:getWorkspacePath', async () => {
    return workspacePath
  })

  // Dialog handlers for export functionality
  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Export Folder'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_event: Electron.IpcMainInvokeEvent, folderPath: string, filename: string, dataUrl: string) => {
    try {
      const filePath = path.join(folderPath, filename)
      // Convert data URL to buffer
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
      const buffer = Buffer.from(base64Data, 'base64')
      fs.writeFileSync(filePath, buffer)
      return { success: true, path: filePath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('dialog:listExportFolder', async (_event: Electron.IpcMainInvokeEvent, folderPath: string) => {
    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true })
      return entries.map((entry: Dirent) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file'
      }))
    } catch (error) {
      return []
    }
  })
}

app.whenReady().then(async () => {
  await initializeWorkspace()
  setupIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

