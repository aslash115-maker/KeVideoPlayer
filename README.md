# Video Frame Studio

An Electron app that extracts every frame from a video, lets you preview each frame, apply one of **33 filters** with adjustable strength, and export individual frames as PNG (filtered) or JPG (original).

## Features

- 📁 Open any video FFmpeg can decode (mp4, mov, mkv, webm, avi, flv, wmv, m4v, mpg, mpeg, ts, …)
- 🎞️ Extract frames with optional target FPS sampling and a max-frame cap (so 2-hour videos won't lock the disk)
- 🖼️ Lazy-loaded thumbnail grid — fast even with hundreds of frames
- 🎨 33 filters spanning color grading, stylization, distortion, blur, edge, and pop-culture looks
- 🎚️ Strength slider (0–100%) that smoothly blends filter ↔ original
- 💾 Export the original frame or the filtered preview (PNG)

## Filter list

Original, Grayscale, Sepia, Invert, Brighten, Darken, Contrast, Saturate, Desaturate, Hue Shift, Warm Tone, Cool Tone, B&W Punch, Threshold, Posterize, Solarize, Vignette, Box Blur, Gaussian, Sharpen, Edge Detect, Emboss, Pixelate, Noise, Scanlines, Duotone, Vintage Film, Cyberpunk, RGB Shift, Polaroid, Heat Map, Mirror X, Night Vision, Comic.

## Setup

```bash
npm install
npm start
```

`ffmpeg-static` ships a prebuilt FFmpeg binary, so no separate install is needed.

## Project layout

```
main.js               Electron main process: file dialogs, ffprobe, frame extraction, IPC
preload.js            contextIsolation bridge — exposes a typed `window.api`
renderer/
  index.html          Three-pane layout (frame grid · preview · filters)
  styles.css          Dark UI theme
  filters.js          33 filters as pure ImageData → ImageData functions
  renderer.js         UI logic: pick/probe/extract, lazy thumbs, filter pipeline, export
```

## How it works

1. **Probe** — `ffprobe` reads dimensions, duration, fps, codec.
2. **Extract** — FFmpeg writes JPEGs into a per-session `os.tmpdir()/vfs-<id>/` directory; progress is streamed to the UI.
3. **Preview** — Selected frame is decoded into an `ImageData` at native resolution.
4. **Filter** — On every change (filter or strength), the renderer copies the base ImageData and runs the chosen filter, then `putImageData`s into a canvas.
5. **Export** — Original = direct file copy. Filtered = `canvas.toDataURL('image/png')` written by main.

The session's tmp directory is cleaned up on exit and when a new extraction starts.

## Extraction options

- **Sample FPS** — `0` keeps every source frame; `1` decimates to one frame per second; `12` to 12fps, etc. Use this for long videos.
- **Max frames** — Hard upper cap; `0` means unlimited.
- **Quality** — FFmpeg `-q:v` (2 = best, 31 = worst). Default `3` is near-lossless JPEG.
