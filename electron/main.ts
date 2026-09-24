import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs, { Dirent } from 'fs'
import { execFile, spawn, type ChildProcess } from 'child_process'
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

// Dev-only automation hooks (never active in a packaged build):
//   STP_HEADLESS=1       keep the window hidden and don't throttle it, so exports can be
//                        driven over the remote-debugging port without a visible window
//   STP_AUTOSAVE_DIR=dir the video save dialog returns <dir>/<defaultName> without showing
const devHeadless = !app.isPackaged && process.env.STP_HEADLESS === '1'
const devAutosaveDir = !app.isPackaged ? process.env.STP_AUTOSAVE_DIR : undefined

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
      ...(devHeadless ? { backgroundThrottling: false } : {}),
    },
    backgroundColor: '#1a1a1a',
    show: false,
    autoHideMenuBar: true, // Hide menu bar by default (Alt to show)
  })

  // Lock to 16:9 aspect ratio
  mainWindow.setAspectRatio(16 / 9)

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (!devHeadless) mainWindow.show()
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

// --- FFmpeg resolution (shared by the video export handlers) ---

/** Resolve the ffmpeg binary path — try multiple locations. */
function resolveFfmpegPath(): { path: string | null; tried: string[] } {
  const isWin = process.platform === 'win32'
  const ffmpegBin = isWin ? 'ffmpeg.exe' : 'ffmpeg'
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
    if (fs.existsSync(candidate)) {
      console.log('FFmpeg resolved:', candidate)
      return { path: candidate, tried: candidates }
    }
  }
  return { path: null, tried: candidates }
}

/** Whether this ffmpeg build has the given encoder (cached per binary + encoder). */
const encoderChecks = new Map<string, Promise<boolean>>()
function ffmpegHasEncoder(ffmpegPath: string, encoder: string): Promise<boolean> {
  const key = ffmpegPath + '::' + encoder
  let check = encoderChecks.get(key)
  if (!check) {
    check = new Promise<boolean>((resolve) => {
      execFile(ffmpegPath, ['-hide_banner', '-encoders'], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        if (error) { resolve(false); return }
        // `ffmpeg -encoders` lists one encoder per line as "<flags> <name> <description>",
        // where the flags column starts with V for video encoders.
        resolve(new RegExp('^\\s*V\\S*\\s+' + encoder + '\\s', 'm').test(String(stdout)))
      })
    })
    encoderChecks.set(key, check)
  }
  return check
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

  // Read the YouTube Production Scheduler's projects list so the tierlist app can
  // name a captured "state" after the episode being produced. The scheduler is a
  // sibling program under the same Dropbox root; we try a few likely locations and
  // return the parsed array, or null if it can't be found/read (renderer degrades
  // gracefully to a date-based name).
  ipcMain.handle('scheduler:readProjects', async () => {
    const candidates: string[] = []
    if (process.env.STP_SCHEDULER_PROJECTS) {
      candidates.push(process.env.STP_SCHEDULER_PROJECTS)
    }
    // Sibling of the app source (dev: cwd is the stp-website root)
    candidates.push(path.join(process.cwd(), '..', 'scheduler', 'data', 'projects.json'))
    candidates.push(path.join(app.getAppPath(), '..', 'scheduler', 'data', 'projects.json'))
    // Known absolute location under Dropbox (packaged app / fallback)
    candidates.push('A:\\Dropbox\\stp-projects\\programs\\scheduler\\data\\projects.json')

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const content = fs.readFileSync(candidate, 'utf-8')
          const parsed = JSON.parse(content)
          if (Array.isArray(parsed)) return parsed
        }
      } catch {
        // Try the next candidate
      }
    }
    return null
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
  //
  // Frames are streamed from the renderer as raw RGBA buffers straight into FFmpeg's stdin,
  // so encoding runs concurrently with capture (no PNG round-trip through the temp dir and
  // no separate "encoding" pass at the end).

  type StreamSession = {
    proc: ChildProcess
    outputPath: string
    stderr: string
    exited: Promise<number | null>
    exitCode: number | null | undefined
  }
  const streamSessions = new Map<string, StreamSession>()
  let nextStreamId = 1

  ipcMain.handle('video:beginStream', async (
    _event: Electron.IpcMainInvokeEvent,
    outputPath: string,
    fps: number,
    width: number,
    height: number,
    lossless: boolean = false,
  ): Promise<{ id?: string; error?: string }> => {
    const ffmpegPath = resolveFfmpegPath()
    if (!ffmpegPath.path) {
      return { error: `FFmpeg not found. Tried:\n  ${ffmpegPath.tried.join('\n  ')}` }
    }

    // ProRes 4444 (alpha) when the build has it; otherwise — or when a lossless, color-exact
    // file is requested — PNG-in-MOV. See the codec notes below for why.
    const useProRes = !lossless && await ffmpegHasEncoder(ffmpegPath.path, 'prores_ks')

    const inputArgs = [
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-video_size', `${width}x${height}`,
      '-framerate', String(fps),
      '-i', 'pipe:0',
    ]

    // ProRes 4444: `-qscale:v` sets the quantizer (higher = smaller file); 11 roughly halves
    // the size versus the default bitrate with no visible loss on these flat UI graphics. The
    // alpha channel is stored losslessly regardless, so sprite/edge cutouts stay crisp.
    const proResArgs = [
      '-c:v', 'prores_ks',
      '-profile:v', '4444',
      '-pix_fmt', 'yuva444p10le',
      '-qscale:v', '11',
    ]

    // PNG-in-MOV: lossless RGBA. This is the color-accurate path used for the scroll/change
    // videos — it matches the PNG exports exactly in Premiere. (QuickTime Animation / qtrle
    // would give inter-frame compression, but Premiere's QuickTime decoder applies its own
    // gamma to it, producing a lighter image than the PNGs — a codec quirk that color tags
    // can't override, so we stay on the png codec.) `-pred mixed` enables per-row PNG
    // prediction filters for noticeably smaller files with zero quality loss; alpha is
    // preserved.
    const pngArgs = [
      '-c:v', 'png',
      '-pix_fmt', 'rgba',
      '-pred', 'mixed',
    ]

    const args = [...inputArgs, ...(useProRes ? proResArgs : pngArgs), '-an', outputPath]
    console.log('FFmpeg command:', ffmpegPath.path, args.join(' '))

    const proc = spawn(ffmpegPath.path, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    const session: StreamSession = { proc, outputPath, stderr: '', exited: Promise.resolve(null), exitCode: undefined }
    session.exited = new Promise<number | null>((resolve) => {
      proc.on('error', (err) => {
        session.stderr += `\n${err.message}`
        session.exitCode = -1
        resolve(-1)
      })
      proc.on('close', (code) => {
        session.exitCode = code
        resolve(code)
      })
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      // Keep only the tail so a chatty encoder can't grow this without bound.
      session.stderr = (session.stderr + chunk.toString()).slice(-16384)
    })
    // FFmpeg exiting early (bad args, disk full) makes the next write EPIPE; swallow it here
    // and surface the real cause from stderr on end/write instead of crashing the main process.
    proc.stdin?.on('error', () => { /* reported via exit code + stderr */ })

    const id = String(nextStreamId++)
    streamSessions.set(id, session)
    return { id }
  })

  ipcMain.handle('video:writeFrame', async (_event: Electron.IpcMainInvokeEvent, id: string, data: Uint8Array): Promise<{ success: boolean; error?: string }> => {
    const session = streamSessions.get(id)
    if (!session) return { success: false, error: 'Unknown video stream' }
    if (session.exitCode !== undefined) {
      return { success: false, error: `FFmpeg exited early (code ${session.exitCode})\n${session.stderr}` }
    }
    const stdin = session.proc.stdin!
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    // Back-pressure: if the pipe is full, wait for it to drain (or for FFmpeg to die) before
    // letting the renderer produce the next frame.
    const ok = stdin.write(buf)
    if (!ok) {
      await Promise.race([
        new Promise<void>((resolve) => stdin.once('drain', resolve)),
        session.exited,
      ])
    }
    return { success: true }
  })

  ipcMain.handle('video:endStream', async (_event: Electron.IpcMainInvokeEvent, id: string): Promise<{ success: boolean; error?: string }> => {
    const session = streamSessions.get(id)
    if (!session) return { success: false, error: 'Unknown video stream' }
    streamSessions.delete(id)
    session.proc.stdin?.end()
    const code = await session.exited
    if (code !== 0) {
      console.error('FFmpeg stderr:', session.stderr)
      return { success: false, error: `FFmpeg error (exit code ${code})\n${session.stderr}` }
    }
    return { success: true }
  })

  ipcMain.handle('video:abortStream', async (_event: Electron.IpcMainInvokeEvent, id: string) => {
    const session = streamSessions.get(id)
    if (!session) return
    streamSessions.delete(id)
    try { session.proc.kill() } catch { /* ignore */ }
    // A killed encoder leaves a truncated, unplayable file behind — don't hand that to the user.
    await session.exited
    try { fs.rmSync(session.outputPath, { force: true }) } catch { /* ignore */ }
  })

  ipcMain.handle('dialog:saveFileDialog', async (_event: Electron.IpcMainInvokeEvent, defaultName: string) => {
    if (devAutosaveDir) return path.join(devAutosaveDir, defaultName)
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

// Check for updates in the background after the main window is shown.
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

    const parent = BrowserWindow.getAllWindows()[0]
    const options: Electron.MessageBoxOptions = {
      type: 'info',
      title: 'Update Available',
      message: `A new version (v${newVersion}) is available. You are currently on v${currentVersion}.\n\nWould you like to update now?`,
      buttons: ['Update', 'Skip', "Don't remind me"],
      defaultId: 0,
      cancelId: 1,
    }
    const response = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)

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

  // Show the window immediately; the update check hits GitHub over the network and
  // used to block window creation (and hang on slow/offline connections). It now runs
  // in the background and shows its dialog once the result comes back.
  createWindow()
  void checkForUpdates()

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

