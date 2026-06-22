const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ffmpegPath = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

let mainWindow = null;
const sessions = new Map();
let currentVideoPath = null; // path the renderer is allowed to stream
const activeFfmpegProcs = new Set(); // track running ffmpeg children for cleanup

// Register a privileged 'vfs' scheme so renderer can stream the picked file
// without exposing arbitrary disk access via file://. We map vfs://video to the
// currently selected video file (set after the user picks one).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vfs',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
      stream: true,
      corsEnabled: false,
    },
  },
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1200,
    minHeight: 720,
    backgroundColor: '#1b1d22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Disable HTTP/disk cache so renderer always sees the latest CSS/JS during dev.
  app.commandLine.appendSwitch('disable-http-cache');
  // Resolve vfs://video → the currently selected file. Refuse anything else.
  // We implement HTTP Range support manually so <video> can seek inside the file.
  protocol.handle('vfs', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'video') {
      return new Response('not found', { status: 404 });
    }
    if (!currentVideoPath) {
      return new Response('no video selected', { status: 404 });
    }
    try {
      const stat = await fsp.stat(currentVideoPath);
      const size = stat.size;
      const ext = path.extname(currentVideoPath).toLowerCase();
      const mime = ({
        '.mp4': 'video/mp4',
        '.m4v': 'video/mp4',
        '.mov': 'video/quicktime',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.flv': 'video/x-flv',
        '.wmv': 'video/x-ms-wmv',
        '.mpg': 'video/mpeg',
        '.mpeg': 'video/mpeg',
        '.ts': 'video/mp2t',
      })[ext] || 'application/octet-stream';

      // Stream the file with proper error handling.
      const makeBody = (start, end) => {
        return new ReadableStream({
          start(controller) {
            const stream = fs.createReadStream(currentVideoPath,
              start != null ? { start, end } : undefined);
            stream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
            stream.on('end', () => controller.close());
            stream.on('error', (err) => controller.error(err));
            this._stream = stream;
          },
          cancel() { try { this._stream?.destroy(); } catch {} },
        });
      };

      const range = request.headers.get('Range') || request.headers.get('range');
      if (range) {
        // Support both `bytes=N-M`, `bytes=N-`, and suffix `bytes=-N`.
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (m) {
          let start, end;
          if (m[1] === '' && m[2] !== '') {
            // Suffix: last N bytes.
            const suffix = parseInt(m[2], 10);
            start = Math.max(0, size - suffix);
            end = size - 1;
          } else {
            start = m[1] === '' ? 0 : parseInt(m[1], 10);
            end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
          }
          if (start > end || start >= size) {
            return new Response('range not satisfiable', {
              status: 416,
              headers: { 'Content-Range': `bytes */${size}` },
            });
          }
          const length = end - start + 1;
          return new Response(makeBody(start, end), {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Length': String(length),
              'Content-Range': `bytes ${start}-${end}/${size}`,
              'Accept-Ranges': 'bytes',
            },
          });
        }
      }

      // No range — stream the whole file.
      return new Response(makeBody(), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (e) {
      return new Response(`vfs error: ${e.message}`, { status: 500 });
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  // Kill any running ffmpeg children before quitting.
  for (const proc of activeFfmpegProcs) {
    try { proc.kill(); } catch {}
  }
  activeFfmpegProcs.clear();
  cleanupAllSessions();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function cleanupAllSessions() {
  for (const session of sessions.values()) {
    try {
      if (session.dir && fs.existsSync(session.dir)) {
        fs.rmSync(session.dir, { recursive: true, force: true });
      }
    } catch {}
  }
  sessions.clear();
}

ipcMain.handle('dialog:openVideo', async (_evt, opts = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts.dialogTitle || 'Select a video file',
    properties: ['openFile'],
    filters: [
      { name: opts.filterVideoLabel || 'Videos', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts'] },
      { name: opts.filterAllLabel || 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  currentVideoPath = result.filePaths[0];
  return currentVideoPath;
});

ipcMain.handle('video:setActive', async (_evt, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return false;
  try {
    const resolved = await fsp.realpath(filePath);
    await fsp.access(resolved, fs.constants.R_OK);
    currentVideoPath = resolved;
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('video:probe', async (_evt, filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const stream = (data.streams || []).find((s) => s.codec_type === 'video');
      if (!stream) return reject(new Error('No video stream found'));
      const fpsParts = (stream.r_frame_rate || '0/1').split('/');
      const fps = fpsParts.length === 2 ? parseInt(fpsParts[0], 10) / parseInt(fpsParts[1], 10) : 0;
      const duration = parseFloat(stream.duration || data.format?.duration || 0);
      resolve({
        filePath,
        width: stream.width,
        height: stream.height,
        duration,
        fps,
        codec: stream.codec_name,
        nbFrames: stream.nb_frames ? parseInt(stream.nb_frames, 10) : Math.round(duration * fps),
      });
    });
  });
});

ipcMain.handle('video:extractFrames', async (evt, { filePath, targetFps, maxFrames, quality }) => {
  // Only allow extraction from the file the renderer has registered.
  if (!filePath || filePath !== currentVideoPath) {
    throw new Error('extractFrames: filePath does not match active video');
  }
  // Sanity check: file exists and is readable.
  try {
    await fsp.access(filePath, fs.constants.R_OK);
  } catch {
    throw new Error('extractFrames: file not accessible');
  }

  const sessionId = crypto.randomBytes(8).toString('hex');
  const dir = path.join(os.tmpdir(), `vfs-${sessionId}`);
  await fsp.mkdir(dir, { recursive: true });
  sessions.set(sessionId, { dir, filePath });

  const sender = evt.sender;
  const args = ['-hide_banner', '-y', '-i', filePath];

  const filters = [];
  // Validate targetFps: must be a finite positive number ≤ 240.
  const tFps = Number(targetFps);
  if (Number.isFinite(tFps) && tFps > 0 && tFps <= 240) {
    filters.push(`fps=${tFps}`);
  }
  if (filters.length) args.push('-vf', filters.join(','));

  // Validate maxFrames: positive integer ≤ 100000.
  const mFrames = parseInt(maxFrames, 10);
  if (Number.isFinite(mFrames) && mFrames > 0 && mFrames <= 100000) {
    args.push('-frames:v', String(mFrames));
  }

  const q = Math.max(2, Math.min(31, parseInt(quality, 10) || 3));
  args.push('-q:v', String(q));
  args.push('-progress', 'pipe:2');
  args.push(path.join(dir, 'frame_%06d.jpg'));

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    activeFfmpegProcs.add(proc);
    let stderrBuf = '';
    let lastReport = 0;

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;
      if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
      const m = text.match(/frame=\s*(\d+)/g);
      if (m && m.length) {
        const last = m[m.length - 1];
        const n = parseInt(last.replace(/\D/g, ''), 10);
        const now = Date.now();
        if (!Number.isNaN(n) && now - lastReport > 80) {
          lastReport = now;
          if (!sender.isDestroyed()) {
            sender.send('extract:progress', { sessionId, framesDone: n });
          }
        }
      }
    });

    proc.on('error', (err) => {
      activeFfmpegProcs.delete(proc);
      reject(err);
    });
    proc.on('close', async (code) => {
      activeFfmpegProcs.delete(proc);
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}\n${stderrBuf}`));
      }
      try {
        const files = (await fsp.readdir(dir))
          .filter((f) => f.endsWith('.jpg'))
          .sort();
        const frames = files.map((name, i) => ({
          index: i,
          name,
          path: path.join(dir, name),
        }));
        resolve({ sessionId, dir, frames, count: frames.length });
      } catch (e) {
        reject(e);
      }
    });
  });
});

// Audio extraction: pull the audio stream out of the active video and save to disk.
// fmt: 'mp3' | 'wav' | 'm4a' | 'flac' | 'ogg'
ipcMain.handle('audio:extract', async (evt, { filePath, format, dialogTitle, suggestedName, filterLabel }) => {
  if (!filePath || filePath !== currentVideoPath) {
    throw new Error('extractAudio: filePath does not match active video');
  }
  try {
    await fsp.access(filePath, fs.constants.R_OK);
  } catch {
    throw new Error('extractAudio: file not accessible');
  }

  const FORMAT_PRESETS = {
    mp3:  { ext: 'mp3',  args: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'] },
    wav:  { ext: 'wav',  args: ['-vn', '-c:a', 'pcm_s16le'] },
    m4a:  { ext: 'm4a',  args: ['-vn', '-c:a', 'aac', '-b:a', '192k'] },
    flac: { ext: 'flac', args: ['-vn', '-c:a', 'flac'] },
    ogg:  { ext: 'ogg',  args: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'] },
  };
  const fmt = (typeof format === 'string' && FORMAT_PRESETS[format.toLowerCase()]) ? format.toLowerCase() : 'mp3';
  const preset = FORMAT_PRESETS[fmt];

  const baseName = path.basename(filePath, path.extname(filePath));
  const defaultName = (suggestedName && typeof suggestedName === 'string')
    ? suggestedName
    : `${baseName}.${preset.ext}`;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: dialogTitle || 'Save audio',
    defaultPath: defaultName,
    filters: [
      { name: filterLabel || `${fmt.toUpperCase()} audio`, extensions: [preset.ext] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  // Refuse to overwrite the source file by accident.
  try {
    const a = await fsp.realpath(result.filePath).catch(() => result.filePath);
    const b = await fsp.realpath(filePath).catch(() => filePath);
    if (a === b) throw new Error('Output path matches the source video');
  } catch (e) {
    if (e && e.message === 'Output path matches the source video') throw e;
  }

  const outPath = result.filePath;
  const args = ['-hide_banner', '-y', '-i', filePath, ...preset.args, '-progress', 'pipe:2', outPath];
  const sender = evt.sender;

  return await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    activeFfmpegProcs.add(proc);
    let stderrBuf = '';
    let lastReport = 0;
    let foundAudio = true;

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;
      if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
      if (/Output file does not contain any stream|does not contain any stream/i.test(text)) {
        foundAudio = false;
      }
      // ffmpeg progress reports out_time_ms; surface to renderer.
      const m = /out_time_ms=(\d+)/.exec(text);
      if (m) {
        const ms = parseInt(m[1], 10) / 1000; // out_time_ms is microseconds
        const now = Date.now();
        if (Number.isFinite(ms) && now - lastReport > 100) {
          lastReport = now;
          if (!sender.isDestroyed()) {
            sender.send('audio:progress', { ms });
          }
        }
      }
    });

    proc.on('error', (err) => {
      activeFfmpegProcs.delete(proc);
      reject(err);
    });
    proc.on('close', (code) => {
      activeFfmpegProcs.delete(proc);
      if (code !== 0) {
        if (!foundAudio) {
          return reject(new Error('No audio stream found in this video'));
        }
        return reject(new Error(`ffmpeg exited with code ${code}\n${stderrBuf}`));
      }
      resolve({ canceled: false, path: outPath, format: fmt });
    });
  });
});

ipcMain.handle('frame:read', async (_evt, framePath) => {
  if (typeof framePath !== 'string' || !framePath) {
    throw new Error('frame:read: invalid path');
  }
  // Resolve real paths to defeat symlink/UNC tricks.
  let realFrame;
  try {
    realFrame = await fsp.realpath(framePath);
  } catch {
    throw new Error('frame:read: file not found');
  }
  let allowed = false;
  for (const s of sessions.values()) {
    try {
      const realDir = await fsp.realpath(s.dir);
      const rel = path.relative(realDir, realFrame);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        allowed = true;
        break;
      }
    } catch {}
  }
  if (!allowed) {
    throw new Error('Access denied: frame path outside any session directory');
  }
  const buf = await fsp.readFile(realFrame);
  return buf.toString('base64');
});

ipcMain.handle('frame:saveOriginal', async (_evt, { framePath, suggestedName, dialogTitle, filterJpegLabel, filterPngLabel }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: dialogTitle || 'Save frame',
    defaultPath: suggestedName || path.basename(framePath),
    filters: [
      { name: filterJpegLabel || 'JPEG', extensions: ['jpg', 'jpeg'] },
      { name: filterPngLabel || 'PNG', extensions: ['png'] },
    ],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fsp.copyFile(framePath, result.filePath);
  return { canceled: false, path: result.filePath };
});

ipcMain.handle('frame:savePngFromBase64', async (_evt, { base64, suggestedName, dialogTitle, filterPngLabel, filterJpegLabel }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: dialogTitle || 'Export filtered frame',
    defaultPath: suggestedName || 'frame.png',
    filters: [
      { name: filterPngLabel || 'PNG', extensions: ['png'] },
      { name: filterJpegLabel || 'JPEG', extensions: ['jpg', 'jpeg'] },
    ],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const buf = Buffer.from(base64, 'base64');
  await fsp.writeFile(result.filePath, buf);
  return { canceled: false, path: result.filePath };
});

ipcMain.handle('shell:revealItem', async (_evt, p) => {
  shell.showItemInFolder(p);
});

let manualWindow = null;
ipcMain.handle('manual:open', async () => {
  if (manualWindow && !manualWindow.isDestroyed()) {
    manualWindow.focus();
    return;
  }
  manualWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e1014',
    title: 'Video Frame Studio · Manual',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  manualWindow.setMenuBarVisibility(false);
  await manualWindow.loadFile(path.join(__dirname, 'docs', 'manual.html'));
  manualWindow.on('closed', () => { manualWindow = null; });
});

ipcMain.handle('session:cleanup', async (_evt, sessionId) => {
  const s = sessions.get(sessionId);
  if (!s) return;
  try {
    if (s.dir && fs.existsSync(s.dir)) fs.rmSync(s.dir, { recursive: true, force: true });
  } catch {}
  sessions.delete(sessionId);
});
