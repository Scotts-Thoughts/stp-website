import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs, { Dirent } from 'fs'
import os from 'os'
import { execFile } from 'child_process'
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

// Workspace directory preferences — stores a custom workspace path if the user has changed it.
function getWorkspacePrefsPath(): string {
  return path.join(app.getPath('userData'), 'workspace-prefs.json')
}

function readWorkspacePrefs(): { workspacePath?: string } {
  try {
    return JSON.parse(fs.readFileSync(getWorkspacePrefsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeWorkspacePrefs(prefs: { workspacePath?: string }): void {
  fs.writeFileSync(getWorkspacePrefsPath(), JSON.stringify(prefs), 'utf-8')
}

// Get the user data path for storing tierlists
function getUserDataPath(): string {
  const prefs = readWorkspacePrefs()
  if (prefs.workspacePath) return prefs.workspacePath
  return path.join(app.getPath('userData'), 'workspace')
}

function getDefaultWorkspacePath(): string {
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

// --- External-change watcher ---
// Tracks the last-known mtime of each workspace file the renderer has touched.
// On window focus, we stat each tracked file and report any with newer mtimes
// so the renderer can prompt the user to reload changed tierlists.
const fileMtimes = new Map<string, number>()

function recordMtime(filename: string): void {
  try {
    const filePath = path.join(getUserDataPath(), filename)
    const stat = fs.statSync(filePath)
    fileMtimes.set(filename, stat.mtimeMs)
  } catch {
    // File missing or unreadable — drop the entry so we don't false-positive later
    fileMtimes.delete(filename)
  }
}

function detectExternalChanges(): string[] {
  const changed: string[] = []
  for (const [filename, knownMtime] of fileMtimes.entries()) {
    try {
      const filePath = path.join(getUserDataPath(), filename)
      const stat = fs.statSync(filePath)
      // Treat anything newer than the snapshot as an external change
      if (stat.mtimeMs > knownMtime + 1) {
        console.log(`[watch] external change detected: ${filename} (snapshot=${knownMtime}, current=${stat.mtimeMs})`)
        changed.push(filename)
      }
    } catch {
      // File deleted out from under us — skip
    }
  }
  return changed
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

  // On window focus, check if any tracked workspace file has been modified externally
  // (e.g. by the scheduler app). If so, notify the renderer to prompt the user.
  mainWindow.on('focus', () => {
    console.log(`[watch] focus event — tracked files: ${fileMtimes.size}`)
    const changed = detectExternalChanges()
    if (changed.length > 0) {
      console.log(`[watch] sending workspace:externalChange to renderer: ${changed.join(', ')}`)
      mainWindow.webContents.send('workspace:externalChange', changed)
    } else {
      console.log('[watch] no changes detected on focus')
    }
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
  ipcMain.handle('fs:readFile', async (_event: Electron.IpcMainInvokeEvent, filename: string) => {
    const filePath = path.join(getUserDataPath(), filename)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      // Snapshot the mtime so the focus-watcher can detect external edits later
      recordMtime(filename)
      return content
    } catch (error) {
      throw new Error(`Failed to read file: ${filename}`)
    }
  })

  ipcMain.handle('fs:writeFile', async (_event: Electron.IpcMainInvokeEvent, filename: string, content: string) => {
    const wsPath = getUserDataPath()
    if (filename.startsWith('trash/')) {
      const trashPath = path.join(wsPath, 'trash')
      if (!fs.existsSync(trashPath)) {
        fs.mkdirSync(trashPath, { recursive: true })
      }
    }
    const filePath = path.join(wsPath, filename)
    try {
      fs.writeFileSync(filePath, content, 'utf-8')
      // Refresh the snapshot so our own write doesn't trigger a "changed externally" prompt
      recordMtime(filename)
      return true
    } catch (error) {
      throw new Error(`Failed to write file: ${filename}`)
    }
  })

  // Renderer calls this after handling an external change (either reloaded or dismissed)
  // so the next focus check uses the current on-disk mtime as the new baseline.
  ipcMain.handle('watch:acknowledgeChange', async (_event: Electron.IpcMainInvokeEvent, filename: string) => {
    recordMtime(filename)
  })

  // Lets the renderer manually re-check on demand (e.g. on window blur→focus that
  // didn't fire the focus event in some odd window-manager edge cases).
  ipcMain.handle('watch:checkNow', async () => {
    return detectExternalChanges()
  })

  ipcMain.handle('fs:fileExists', async (_event: Electron.IpcMainInvokeEvent, filename: string) => {
    const filePath = path.join(getUserDataPath(), filename)
    return fs.existsSync(filePath)
  })

  ipcMain.handle('fs:listFiles', async () => {
    try {
      const entries = fs.readdirSync(getUserDataPath(), { withFileTypes: true })
      return entries.map((entry: Dirent) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file'
      }))
    } catch (error) {
      return []
    }
  })

  ipcMain.handle('fs:listTrash', async () => {
    const trashPath = path.join(getUserDataPath(), 'trash')
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
    const filePath = path.join(getUserDataPath(), filename)
    try {
      fs.unlinkSync(filePath)
      return true
    } catch (error) {
      throw new Error(`Failed to delete file: ${filename}`)
    }
  })

  ipcMain.handle('fs:getWorkspacePath', async () => {
    return getUserDataPath()
  })

  // Workspace directory management
  ipcMain.handle('workspace:changeDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Workspace Folder',
      defaultPath: getUserDataPath(),
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const newPath = result.filePaths[0]
    writeWorkspacePrefs({ workspacePath: newPath })
    // Re-initialize the new workspace and reload the app
    await initializeWorkspace()
    ensureScottTierlistsFromBundle()
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.reload()
    }
    return newPath
  })

  ipcMain.handle('workspace:resetDirectory', async () => {
    writeWorkspacePrefs({})
    await initializeWorkspace()
    ensureScottTierlistsFromBundle()
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.reload()
    }
    return getDefaultWorkspacePath()
  })

  ipcMain.handle('workspace:isCustomDirectory', async () => {
    const prefs = readWorkspacePrefs()
    return !!prefs.workspacePath
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

  // --- Video export IPC handlers ---

  ipcMain.handle('video:createTempDir', async () => {
    const tmpDir = path.join(os.tmpdir(), `stp-video-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    return tmpDir
  })

  ipcMain.handle('video:saveFrame', async (_event: Electron.IpcMainInvokeEvent, tmpDir: string, frameIndex: number, dataUrl: string) => {
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const filename = `frame_${String(frameIndex).padStart(5, '0')}.png`
    fs.writeFileSync(path.join(tmpDir, filename), buffer)
  })

  ipcMain.handle('video:encode', async (_event: Electron.IpcMainInvokeEvent, tmpDir: string, outputPath: string, fps: number) => {
    // Resolve ffmpeg binary path — try multiple locations
    const isWin = process.platform === 'win32'
    const ffmpegBin = isWin ? 'ffmpeg.exe' : 'ffmpeg'
    let ffmpegPath = 'ffmpeg'
    const candidates: string[] = []

    // 1. Try require('ffmpeg-static') — works in dev when node_modules is intact
    try {
      const fromRequire = require('ffmpeg-static')
      if (fromRequire) {
        // In packaged app, the binary is inside the asar archive where execFile can't reach it.
        // asarUnpack extracts it to app.asar.unpacked — check that path first.
        if (fromRequire.includes('app.asar')) {
          candidates.push(fromRequire.replace('app.asar', 'app.asar.unpacked'))
        }
        candidates.push(fromRequire)
      }
    } catch { /* ignore */ }

    // 2. Relative to compiled electron main (dist-electron/../node_modules)
    candidates.push(path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', ffmpegBin))

    // 3. Relative to app root
    candidates.push(path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', ffmpegBin))

    // 4. Relative to process.cwd()
    candidates.push(path.join(process.cwd(), 'node_modules', 'ffmpeg-static', ffmpegBin))

    // 5. Packaged app — extraResources
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, ffmpegBin))
    }

    for (const candidate of candidates) {
      console.log('FFmpeg candidate:', candidate, fs.existsSync(candidate) ? '✓' : '✗')
      if (fs.existsSync(candidate)) {
        ffmpegPath = candidate
        break
      }
    }

    console.log('FFmpeg resolved:', ffmpegPath)

    const inputPattern = path.join(tmpDir, 'frame_%05d.png')

    // Try ProRes 4444 first (supports alpha), fall back to PNG-in-MOV if unavailable
    const proResArgs = [
      '-y',
      '-framerate', String(fps),
      '-i', inputPattern,
      '-c:v', 'prores_ks',
      '-profile:v', '4444',
      '-pix_fmt', 'yuva444p10le',
      '-an',
      outputPath,
    ]

    // PNG codec fallback (universally supported, preserves alpha, larger file)
    const pngArgs = [
      '-y',
      '-framerate', String(fps),
      '-i', inputPattern,
      '-c:v', 'png',
      '-pix_fmt', 'rgba',
      '-an',
      outputPath,
    ]

    // If none of the candidates exist, report which paths were tried
    if (ffmpegPath === 'ffmpeg') {
      const tried = candidates.join('\n  ')
      return { success: false, error: `FFmpeg not found. Tried:\n  ${tried}` }
    }

    function runFfmpeg(args: string[]): Promise<{ success: boolean; error?: string }> {
      return new Promise((resolve) => {
        console.log('FFmpeg command:', ffmpegPath, args.join(' '))
        execFile(ffmpegPath, args, { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, stderr) => {
          if (error) {
            console.error('FFmpeg stderr:', stderr)
            console.error('FFmpeg error:', error.message)
            resolve({ success: false, error: `FFmpeg error: ${error.message}\n${stderr}` })
          } else {
            resolve({ success: true })
          }
        })
      })
    }

    // Try ProRes first
    let result = await runFfmpeg(proResArgs)
    if (!result.success) {
      console.log('ProRes failed, trying PNG codec fallback...')
      result = await runFfmpeg(pngArgs)
    }
    return result
  })

  ipcMain.handle('video:cleanup', async (_event: Electron.IpcMainInvokeEvent, tmpDir: string) => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  ipcMain.handle('dialog:saveFileDialog', async (_event: Electron.IpcMainInvokeEvent, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Save Video',
      defaultPath: defaultName,
      filters: [{ name: 'QuickTime Movie', extensions: ['mov'] }],
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
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

