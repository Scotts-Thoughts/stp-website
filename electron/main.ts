import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs, { Dirent } from 'fs'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import pkg from 'electron-updater'
const { autoUpdater } = pkg

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

// Add any bundled Scott tierlists that are missing from the user's workspace (never overwrite existing).
function ensureScottTierlistsFromBundle(): void {
  const workspacePath = getUserDataPath()
  const bundledDataPath = app.isPackaged
    ? path.join(process.resourcesPath, 'workspace')
    : path.join(__dirname, '..', 'bundled-workspace')

  if (!fs.existsSync(bundledDataPath) || !fs.existsSync(workspacePath)) return

  const files = fs.readdirSync(bundledDataPath)
  let added = 0
  for (const file of files) {
    if (file.startsWith('scott-') && file.endsWith('.json')) {
      const destPath = path.join(workspacePath, file)
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(path.join(bundledDataPath, file), destPath)
        added++
      }
    }
  }
  if (added > 0) {
    console.log(`Added ${added} Scott tierlist(s) to workspace`)
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

  // Lock to 16:9 aspect ratio
  mainWindow.setAspectRatio(16 / 9)

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
    if (filename.startsWith('trash/')) {
      const trashPath = path.join(workspacePath, 'trash')
      if (!fs.existsSync(trashPath)) {
        fs.mkdirSync(trashPath, { recursive: true })
      }
    }
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

  ipcMain.handle('fs:listTrash', async () => {
    const trashPath = path.join(workspacePath, 'trash')
    try {
      if (!fs.existsSync(trashPath)) return []
      const entries = fs.readdirSync(trashPath, { withFileTypes: true })
      return entries
        .filter((e: Dirent) => e.isFile() && e.name.endsWith('.json'))
        .map((e: Dirent) => e.name)
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

// Update preferences file — stores whether the user dismissed updates for a specific version.
// Resets automatically when a newer version becomes available.
function getUpdatePrefsPath(): string {
  return path.join(app.getPath('userData'), 'update-prefs.json')
}

function readUpdatePrefs(): { dismissedVersion?: string } {
  try {
    return JSON.parse(fs.readFileSync(getUpdatePrefsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeUpdatePrefs(prefs: { dismissedVersion?: string }): void {
  fs.writeFileSync(getUpdatePrefsPath(), JSON.stringify(prefs), 'utf-8')
}

// Tracks an available update version that the user skipped (either this session or via "Don't remind me").
// The renderer queries this to show an update button on the Choose a Tierlist screen.
let availableUpdateVersion: string | null = null

// Check for updates before showing the main window.
// If an update is available, prompt the user. If they accept, download, quit, and install.
async function checkForUpdates(): Promise<void> {
  // Skip update checks in dev mode
  if (process.env.VITE_DEV_SERVER_URL) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result || !result.updateInfo) return

    const currentVersion = app.getVersion()
    const newVersion = result.updateInfo.version
    if (newVersion === currentVersion) return

    // Check if the user dismissed this version
    const prefs = readUpdatePrefs()
    if (prefs.dismissedVersion === newVersion) {
      // Still store it so the in-app button can appear
      availableUpdateVersion = newVersion
      return
    }

    const response = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `A new version (v${newVersion}) is available. You are currently on v${currentVersion}.\n\nWould you like to update now?`,
      buttons: ['Update', 'Skip', "Don't remind me"],
      defaultId: 0,
      cancelId: 1,
    })

    if (response.response === 2) {
      // "Don't remind me" — save this version so we don't ask again
      writeUpdatePrefs({ dismissedVersion: newVersion })
      availableUpdateVersion = newVersion
      return
    }

    if (response.response !== 0) {
      // "Skip" — remember for the in-app button but don't persist
      availableUpdateVersion = newVersion
      return
    }

    // Download the update
    await autoUpdater.downloadUpdate()

    // Quit and install immediately
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    // Silently ignore update errors (e.g. no internet) and let the app start normally
    console.error('Auto-update check failed:', error)
  }
}

// IPC handlers for update functionality (renderer can query and trigger updates)
function setupUpdateIpcHandlers(): void {
  ipcMain.handle('update:getAvailableVersion', async () => {
    return availableUpdateVersion
  })

  ipcMain.handle('update:install', async () => {
    if (!availableUpdateVersion) return
    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall(false, true)
  })
}

app.whenReady().then(async () => {
  await initializeWorkspace()
  ensureScottTierlistsFromBundle()
  setupIpcHandlers()
  setupUpdateIpcHandlers()

  // Check for updates before creating the window
  await checkForUpdates()

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

