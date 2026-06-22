# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # one-time; pulls Electron + ffmpeg-static + ffprobe-static
npm start          # launch the app (electron .)
npm run dev        # same, but with --enable-logging for Chromium logs
```

There is no test suite, linter, or build step — the renderer is plain `<script>` tags, no bundler.

`ffmpeg-static` / `ffprobe-static` ship prebuilt binaries; no separate ffmpeg install needed. On `npm start` Electron loads `main.js` (process entry from `package.json:main`).

## Architecture

Classic Electron 3-layer split with one notable twist: a **custom `vfs://` protocol** that streams the user-picked video file into the renderer with HTTP Range support (so `<video>` can seek) without granting the renderer arbitrary file access.

### Process boundary

- **`main.js`** — Electron main. Owns: `BrowserWindow`, all FS access, ffmpeg/ffprobe spawns, the `vfs://` protocol handler, and IPC handlers. `contextIsolation: true`, `nodeIntegration: false` — the renderer has no Node APIs.
- **`preload.js`** — the only contextBridge surface. Exposes `window.api.*` (≈14 methods) over `ipcRenderer.invoke`. Also exposes `webUtils.getPathForFile` so drag-dropped files resolve to absolute paths (Electron ≥32 API).
- **`renderer/`** — plain HTML + 4 scripts loaded in fixed order (`index.html:339-342`):
  1. `i18n.js` — base i18n dictionary, exposes `window.VFSi18n.t(key, vars)`
  2. `i18n_player.js` — merges player-specific keys into `VFSi18n.LOCALES` (depends on #1)
  3. `filters.js` — exposes `window.VFSFilters.{list,get,apply}` (33 pure ImageData→ImageData filters; each takes `strength01` 0..1 and blends against the original)
  4. `renderer.js` — UI controller (~1.6k lines): welcome/drop state, video transport, A-B loop, frame stepping, filmstrip grid, snapshot+doodle, filter pipeline, export

If you add a new renderer script, preserve that load order — later scripts assume earlier globals exist.

### Frame extraction flow (the hot path)

1. Renderer calls `api.pickVideo()` → main shows dialog, **records the path in `currentVideoPath`** (module-level in `main.js`). This is the gatekeeper for both `vfs://video` streaming and `extractFrames` — any other path is refused.
2. Renderer calls `api.setActiveVideo(path)` for drag-drop (skips dialog but still verifies `realpath` + readability).
3. `api.probe(path)` runs `ffprobe` → returns `{width, height, duration, fps, codec, nbFrames}`.
4. `api.extractFrames({filePath, targetFps, maxFrames, quality})` spawns ffmpeg into `os.tmpdir()/vfs-<sessionId>/frame_%06d.jpg`. Progress is parsed out of stderr (`frame=\s*(\d+)`) and pushed via `extract:progress` IPC, throttled to 80 ms. The session id maps to its tmp dir in the `sessions` Map.
5. `api.readFrame(framePath)` returns base64. **Security check**: `realpath(framePath)` must resolve inside `realpath(session.dir)` of *some* live session — defeats symlink escapes.
6. Export: `frame:saveOriginal` is a file copy; `frame:savePngFromBase64` writes a base64 PNG produced by `canvas.toDataURL`.

Cleanup: `session:cleanup` deletes one session dir; `cleanupAllSessions()` runs on `window-all-closed`, after killing every tracked ffmpeg child in `activeFfmpegProcs`.

### `vfs://` protocol

Registered as a privileged scheme (`main.js:23-35`) with `stream: true`, `secure: true`, `bypassCSP: false`. `protocol.handle('vfs', …)` only resolves `vfs://video` → `currentVideoPath`; anything else returns 404. Range parsing supports `bytes=N-M`, `bytes=N-`, and suffix `bytes=-N`. Mime is derived from extension via a small table. **Do not** broaden this handler to arbitrary paths — `currentVideoPath` is the trust anchor for the whole renderer.

### Audio extraction

`api.extractAudio({filePath, format})` mirrors frame extraction but writes directly to a user-chosen path. Format presets (`mp3/wav/m4a/flac/ogg`) live in `FORMAT_PRESETS` (`main.js:327-333`). Refuses to overwrite the source video (compares `realpath` of both). Detects "no audio stream" via stderr regex so the error is meaningful.

### Filters

Each filter mutates and returns the same `ImageData` for speed, then `blendOriginal(imageData, originalData, t)` lerps toward the captured pre-filter pixels based on the strength slider. Convolution filters use the in-file `convolve3x3` helper. To add a filter, register via the internal `register(...)` calls in `filters.js` with `{category}` — it shows up automatically in the tile grid.

### Manual window

`api.openManual()` opens a separate `BrowserWindow` loading `docs/manual.html` with `sandbox: true` (stricter than the main window). It is reused if already open.

## Conventions worth knowing

- `currentVideoPath` is **the** path the renderer is allowed to act on. Any new IPC handler that touches a user-picked file should validate against it (see `extractFrames` / `audio:extract` for the pattern).
- All `dialog.*` titles, filter labels, and suggested filenames are passed *from the renderer* (so i18n stays in the renderer). Main treats them as untrusted strings with defaults.
- `disable-http-cache` is appended on `whenReady` so renderer CSS/JS changes are picked up without a hard reload during development.
- The renderer never imports Node modules — if you need FS or a child process, add an IPC handler in `main.js` and expose it through `preload.js`.
