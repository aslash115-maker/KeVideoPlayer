// Renderer: full video player with welcome state, drop zone, filter tile grid,
// transport with timeline tooltip, A-B loop, frame stepping, and keyboard help.
'use strict';

const $ = (id) => document.getElementById(id);
const T = (k, v) => window.VFSi18n.t(k, v);

const els = {
  body: document.body,
  // top
  btnPick: $('btnPick'),
  btnExtract: $('btnExtract'),
  extractStatus: $('extractStatus'),
  btnHelp: $('btnHelp'),
  btnManual: $('btnManual'),
  btnHelpClose: $('btnHelpClose'),
  helpModal: $('helpModal'),
  langSelect: $('langSelect'),
  optFps: $('optFps'),
  optMax: $('optMax'),
  optQuality: $('optQuality'),
  optAudioFormat: $('optAudioFormat'),
  btnExtractAudio: $('btnExtractAudio'),
  // welcome / drop
  welcome: $('welcome'),
  dropZone: $('dropZone'),
  dropOverlay: $('dropOverlay'),
  // stage
  stage: $('stage'),
  videoEl: $('videoEl'),
  previewCanvas: $('previewCanvas'),
  centerBadge: $('centerBadge'),
  filterPausedHint: $('filterPausedHint'),
  stageTitlebar: $('stageTitlebar'),
  btnTopPlayPause: $('btnTopPlayPause'),
  iconTopPlay: $('iconTopPlay'),
  iconTopPause: $('iconTopPause'),
  topPlayState: $('topPlayState'),
  btnSnapshot: $('btnSnapshot'),
  btnDoodle: $('btnDoodle'),
  doodleCanvas: $('doodleCanvas'),
  doodleToolbar: $('doodleToolbar'),
  doodleTextEditor: $('doodleTextEditor'),
  dtToolPen: $('dtToolPen'),
  dtToolText: $('dtToolText'),
  dtToolArrow: $('dtToolArrow'),
  dtToolMove: $('dtToolMove'),
  dtFontSize: $('dtFontSize'),
  dtColor: $('dtColor'),
  dtSize: $('dtSize'),
  dtUndo: $('dtUndo'),
  dtClear: $('dtClear'),
  dtExit: $('dtExit'),
  // transport
  timeCur: $('timeCur'),
  timeDur: $('timeDur'),
  timeline: $('timeline'),
  tlBuffer: $('tlBuffer'),
  tlProgress: $('tlProgress'),
  tlLoop: $('tlLoop'),
  tlMarkerA: $('tlMarkerA'),
  tlMarkerB: $('tlMarkerB'),
  tlTooltip: $('tlTooltip'),
  seekSlider: $('seekSlider'),
  btnFirst: $('btnFirst'),
  btnStepBack: $('btnStepBack'),
  btnPlayPause: $('btnPlayPause'),
  btnStepFwd: $('btnStepFwd'),
  btnLast: $('btnLast'),
  iconPlay: $('iconPlay'),
  iconPause: $('iconPause'),
  btnLoopIn: $('btnLoopIn'),
  btnLoopOut: $('btnLoopOut'),
  btnLoopToggle: $('btnLoopToggle'),
  btnLoopClear: $('btnLoopClear'),
  speedSelect: $('speedSelect'),
  btnMute: $('btnMute'),
  iconVol: $('iconVol'),
  iconMute: $('iconMute'),
  volumeSlider: $('volumeSlider'),
  btnFullscreen: $('btnFullscreen'),
  frameInfo: $('frameInfo'),
  filmstrip: $('filmstrip'),
  // actions
  btnExportFiltered: $('btnExportFiltered'),
  btnExportOriginal: $('btnExportOriginal'),
  btnReset: $('btnReset'),
  // filters pane
  filtersGrid: $('filtersGrid'),
  filterCats: $('filterCats'),
  filterSearch: $('filterSearch'),
  activeFilterName: $('activeFilterName'),
  filterStrength: $('filterStrength'),
  filterStrengthVal: $('filterStrengthVal'),
  heroName: $('heroName'),
  heroDesc: $('heroDesc'),
  // overlays
  toast: $('toast'),
  progress: $('progress'),
  progressText: $('progressText'),
};

const state = {
  videoPath: null,
  videoMeta: null,
  hasVideo: false,
  fps: 30,
  sessionId: null,
  frames: [],
  // Effective FPS at which frames were extracted — used for frame-index → time mapping.
  // null = same as source fps; otherwise the user-chosen sampling rate.
  extractFps: null,
  activeFilterId: 'original',
  strength: 1.0,
  loopA: null,
  loopB: null,
  loopEnabled: false,
  isExtracting: false,
  thumbCache: new Map(),
  isSeeking: false,
  lastVolume: 0.8,
  tileThumbs: new Map(), // filterId -> dataURL of preview thumbnail
  activeCategory: 'all',
  dragDepth: 0,
  // Track previously known active filmstrip index to avoid full DOM scans.
  prevActiveIdx: -1,
  doodleActive: false,
  doodleTool: 'pen',
  doodleColor: '#ff3b30',
  doodleSize: 4,
  doodleFontSize: 24, // canvas-pixel font size for the text tool
  doodleStrokes: [], // each: {type:'stroke', color, size, points:[{x,y},...]} or {type:'text', x,y,text,color,size}
};

const CATEGORIES = ['all', 'basic', 'color', 'bw', 'stylize', 'blur', 'distort', 'mood'];

const previewCtx = els.previewCanvas.getContext('2d', { willReadFrequently: true });

const THUMB_CACHE_LIMIT = 1000;
const TILE_THUMB_W = 200; // small frame snapshot size for the filter palette

// ---------- helpers ----------
function lruSet(map, key, val, limit) {
  if (map.has(key)) map.delete(key);
  map.set(key, val);
  while (map.size > limit) map.delete(map.keys().next().value);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function fmtDuration(s) {
  if (!s || isNaN(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(2);
  return `${m}m ${sec}s`;
}

function showToast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('error', isError);
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  if (isError) {
    els.toast.style.cursor = 'pointer';
    els.toast.onclick = () => { els.toast.hidden = true; };
    console.error('[VFS]', msg);
  } else {
    els.toast.style.cursor = '';
    els.toast.onclick = null;
    showToast._t = setTimeout(() => { els.toast.hidden = true; }, 2400);
  }
}
function showProgress(text) { els.progressText.textContent = text || T('working'); els.progress.hidden = false; }
function hideProgress() { els.progress.hidden = true; }

function showCenterBadge(svgInnerHtml) {
  // If a badge is already visible, don't restart it — let it complete naturally
  // to avoid flicker on rapid play/pause toggles.
  if (showCenterBadge._t && !els.centerBadge.hidden) {
    clearTimeout(showCenterBadge._t);
  }
  els.centerBadge.innerHTML = svgInnerHtml;
  els.centerBadge.hidden = false;
  // Restart the CSS animation by re-reading offsetHeight.
  els.centerBadge.style.animation = 'none';
  void els.centerBadge.offsetHeight;
  els.centerBadge.style.animation = '';
  showCenterBadge._t = setTimeout(() => { els.centerBadge.hidden = true; }, 500);
}

// ---------- localization ----------
function localizeStaticText() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = T(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = T(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = T(el.getAttribute('data-i18n-placeholder'));
  });
  document.title = T('app_title');
}

function refreshActiveFilterLabel() {
  const id = state.activeFilterId;
  els.activeFilterName.textContent = id && window.VFSFilters.get(id)
    ? T(`f_${id}_n`) : T('lbl_active_none');
}

function refreshFrameInfo() {
  if (!state.hasVideo) { els.frameInfo.textContent = ''; return; }
  const cur = Math.round(els.videoEl.currentTime * state.fps);
  const total = state.videoMeta ? state.videoMeta.nbFrames : 0;
  els.frameInfo.textContent = T('frame_pos', { cur, total: total || '?' });
}

function applyLocalization() {
  localizeStaticText();
  refreshFilterTilesText();
  refreshActiveFilterLabel();
  refreshFrameInfo();
  if (state.videoPath) {
    els.stageTitlebar.textContent = state.videoPath.split(/[\\/]/).pop();
  }
}

// ---------- filter tiles ----------
function buildFilterTiles() {
  const list = window.VFSFilters.list();
  els.filtersGrid.innerHTML = '';
  list.forEach((f, i) => {
    const tile = document.createElement('button');
    tile.className = 'filter-tile';
    tile.dataset.filterId = f.id;
    tile.dataset.category = f.category || 'stylize';
    tile.disabled = true;
    tile.title = T(`f_${f.id}_d`);

    // Text column
    const text = document.createElement('div');
    text.className = 'tile-text';
    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = T(`f_${f.id}_n`);
    text.appendChild(name);
    const desc = document.createElement('span');
    desc.className = 'tile-desc';
    desc.textContent = T(`f_${f.id}_d`);
    text.appendChild(desc);
    tile.appendChild(text);

    // Thumbnail on the right
    const thumb = document.createElement('div');
    thumb.className = 'tile-thumb empty';
    if (i >= 1 && i <= 9) {
      const key = document.createElement('span');
      key.className = 'tile-key';
      key.textContent = String(i);
      thumb.appendChild(key);
    }
    if (f.cssFilter) {
      const live = document.createElement('span');
      live.className = 'tile-live';
      live.textContent = T('live_badge');
      thumb.appendChild(live);
    }
    const check = document.createElement('span');
    check.className = 'tile-check';
    check.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    thumb.appendChild(check);
    tile.appendChild(thumb);

    tile.addEventListener('click', () => setActiveFilter(f.id));
    els.filtersGrid.appendChild(tile);
  });
  highlightActiveFilter();
}

function buildCategoryTabs() {
  els.filterCats.innerHTML = '';
  const list = window.VFSFilters.list();
  // Count filters per category.
  const counts = {};
  for (const f of list) {
    const c = f.category || 'stylize';
    counts[c] = (counts[c] || 0) + 1;
  }
  CATEGORIES.forEach((cat) => {
    if (cat !== 'all' && !counts[cat]) return; // skip empty cat
    const btn = document.createElement('button');
    btn.className = 'cat-tab' + (cat === state.activeCategory ? ' active' : '');
    btn.dataset.cat = cat;
    const label = document.createElement('span');
    label.className = 'cat-label';
    label.textContent = T(`cat_${cat}`);
    btn.appendChild(label);
    const count = document.createElement('span');
    count.className = 'cat-count';
    count.textContent = cat === 'all' ? list.length : (counts[cat] || 0);
    btn.appendChild(count);
    btn.addEventListener('click', () => {
      state.activeCategory = cat;
      // Just toggle the active class — no full rebuild.
      els.filterCats.querySelectorAll('.cat-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.cat === cat);
      });
      applyFilterVisibility();
    });
    els.filterCats.appendChild(btn);
  });
}

function highlightActiveFilter() {
  els.filtersGrid.querySelectorAll('.filter-tile').forEach((b) => {
    b.classList.toggle('active', b.dataset.filterId === state.activeFilterId);
  });
  refreshActiveFilterLabel();
  refreshHeroCard();
  const active = els.filtersGrid.querySelector('.filter-tile.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function refreshHeroCard() {
  const id = state.activeFilterId;
  const f = window.VFSFilters.get(id);
  if (!f) return;
  els.heroName.textContent = T(`f_${id}_n`);
  els.heroDesc.textContent = T(`f_${id}_d`);
}

function setFilterTilesEnabled(enabled) {
  els.filtersGrid.querySelectorAll('.filter-tile').forEach((b) => { b.disabled = !enabled; });
}

function setActiveFilter(id) {
  state.activeFilterId = id;
  highlightActiveFilter();
  applyFilterMode();
}

function applyFilterVisibility() {
  const q = (els.filterSearch.value || '').trim().toLowerCase();
  const cat = state.activeCategory;
  els.filtersGrid.querySelectorAll('.filter-tile').forEach((tile) => {
    const id = tile.dataset.filterId;
    const tcat = tile.dataset.category;
    let visible = true;
    if (cat !== 'all' && tcat !== cat) visible = false;
    if (q) {
      const name = T(`f_${id}_n`).toLowerCase();
      const desc = T(`f_${id}_d`).toLowerCase();
      if (!(name.includes(q) || desc.includes(q) || id.includes(q))) visible = false;
    }
    tile.style.display = visible ? '' : 'none';
  });
}

// (kept for backward compat with i18n change handler)
function refreshFilterTilesText() {
  els.filtersGrid.querySelectorAll('.filter-tile').forEach((tile) => {
    const id = tile.dataset.filterId;
    const nameEl = tile.querySelector('.tile-name');
    if (nameEl) nameEl.textContent = T(`f_${id}_n`);
    const descEl = tile.querySelector('.tile-desc');
    if (descEl) descEl.textContent = T(`f_${id}_d`);
    const liveEl = tile.querySelector('.tile-live');
    if (liveEl) liveEl.textContent = T('live_badge');
    tile.title = T(`f_${id}_d`);
  });
  // Refresh category tab labels
  els.filterCats.querySelectorAll('.cat-tab').forEach((btn) => {
    const lbl = btn.querySelector('.cat-label');
    if (lbl) lbl.textContent = T(`cat_${btn.dataset.cat}`);
  });
  refreshHeroCard();
}

// Generate per-filter thumbnails based on the current frame.
async function regenerateFilterThumbnails() {
  if (!state.hasVideo) return;
  const v = els.videoEl;
  if (!v.videoWidth || !v.videoHeight) return;
  const ratio = v.videoWidth / v.videoHeight;
  const W = TILE_THUMB_W, H = Math.round(W / ratio);
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const bctx = base.getContext('2d', { willReadFrequently: true });
  bctx.drawImage(v, 0, 0, W, H);
  const baseData = bctx.getImageData(0, 0, W, H);

  const tiles = els.filtersGrid.querySelectorAll('.filter-tile');
  for (const tile of tiles) {
    const id = tile.dataset.filterId;
    const f = window.VFSFilters.get(id);
    if (!f) continue;
    const copy = new ImageData(new Uint8ClampedArray(baseData.data), W, H);
    const out = window.VFSFilters.apply(id, copy, 1.0);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').putImageData(out, 0, 0);
    const url = c.toDataURL('image/jpeg', 0.6);
    state.tileThumbs.set(id, url);
    const thumb = tile.querySelector('.tile-thumb');
    if (thumb) {
      thumb.classList.remove('empty');
      thumb.style.backgroundImage = `url("${url}")`;
    }
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ---------- filter rendering on stage ----------
function applyFilterMode() {
  if (!state.hasVideo) return;
  const f = window.VFSFilters.get(state.activeFilterId);
  if (!f) return;
  if (f.cssFilter) {
    els.body.classList.remove('canvas-mode');
    els.filterPausedHint.hidden = true;
    els.videoEl.style.filter = f.cssFilter(state.strength);
  } else {
    els.body.classList.add('canvas-mode');
    els.videoEl.style.filter = '';
    if (!els.videoEl.paused) {
      els.videoEl.pause();
    }
    drawFilteredFrameToCanvas();
  }
}

function drawFilteredFrameToCanvas() {
  const v = els.videoEl;
  if (!v.videoWidth || !v.videoHeight) return;
  const w = v.videoWidth, h = v.videoHeight;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  tctx.drawImage(v, 0, 0, w, h);
  const data = tctx.getImageData(0, 0, w, h);
  const out = window.VFSFilters.apply(state.activeFilterId, data, state.strength);
  els.previewCanvas.width = out.width;
  els.previewCanvas.height = out.height;
  previewCtx.putImageData(out, 0, 0);
  els.filterPausedHint.hidden = true;
}

// ---------- timeline ----------
function updateTimelineUI() {
  const v = els.videoEl;
  const dur = v.duration || 0;
  const cur = v.currentTime || 0;
  const ratio = dur > 0 ? cur / dur : 0;
  if (!state.isSeeking) els.seekSlider.value = String(ratio * 1000);
  els.tlProgress.style.width = `${ratio * 100}%`;
  els.timeCur.textContent = fmtTime(cur);
  els.timeDur.textContent = fmtTime(dur);

  if (v.buffered.length && dur > 0) {
    const end = v.buffered.end(v.buffered.length - 1);
    els.tlBuffer.style.width = `${(end / dur) * 100}%`;
  }

  if (dur > 0) {
    if (state.loopA != null) {
      els.tlMarkerA.style.left = `${(state.loopA / dur) * 100}%`;
      els.tlMarkerA.hidden = false;
    } else els.tlMarkerA.hidden = true;
    if (state.loopB != null) {
      els.tlMarkerB.style.left = `${(state.loopB / dur) * 100}%`;
      els.tlMarkerB.hidden = false;
    } else els.tlMarkerB.hidden = true;
    if (state.loopA != null && state.loopB != null && state.loopEnabled) {
      const a = Math.min(state.loopA, state.loopB);
      const b = Math.max(state.loopA, state.loopB);
      els.tlLoop.style.left = `${(a / dur) * 100}%`;
      els.tlLoop.style.width = `${((b - a) / dur) * 100}%`;
      els.tlLoop.classList.add('active');
    } else {
      els.tlLoop.classList.remove('active');
    }
  }
}

function bindTimelineHover() {
  const tl = els.timeline;
  tl.addEventListener('mousemove', (e) => {
    const dur = els.videoEl.duration || 0;
    if (dur === 0) return;
    const rect = tl.getBoundingClientRect();
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const t = ratio * dur;
    els.tlTooltip.hidden = false;
    els.tlTooltip.textContent = fmtTime(t);
    els.tlTooltip.style.left = `${ratio * 100}%`;
  });
  tl.addEventListener('mouseleave', () => { els.tlTooltip.hidden = true; });
}

// ---------- video lifecycle ----------
async function loadVideoFile(filePath) {
  try {
    // Clean up any prior video state.
    if (state.sessionId) {
      try { await window.api.cleanupSession(state.sessionId); } catch {}
      state.sessionId = null;
    }
    state.frames = [];
    state.thumbCache.clear();
    state.tileThumbs.clear();
    if (filmstripObserver) { filmstripObserver.disconnect(); filmstripObserver = null; }
    els.filmstrip.innerHTML = '';
    els.filmstrip.hidden = true;
    if (els.extractStatus) els.extractStatus.textContent = '';
    // Reset all filter tile thumbnails to "empty" state.
    els.filtersGrid.querySelectorAll('.tile-thumb').forEach((t) => {
      t.classList.add('empty');
      t.style.backgroundImage = '';
    });

    state.videoPath = filePath;
    showProgress(T('probing'));
    await window.api.setActiveVideo(filePath);
    const meta = await window.api.probe(filePath);
    state.videoMeta = meta;
    state.fps = (meta.fps && Number.isFinite(meta.fps) && meta.fps > 0) ? meta.fps : 30;

    // Reset playback rate & loop on new video.
    els.videoEl.playbackRate = 1;
    els.speedSelect.value = '1';
    state.loopA = state.loopB = null;
    state.loopEnabled = false;
    els.btnLoopToggle.classList.remove('active');

    els.videoEl.src = `vfs://video?_=${Date.now()}`;
    els.videoEl.load();

    state.hasVideo = true;
    enableTransport(true);
    els.btnExtract.disabled = false;
    if (els.btnExtractAudio) els.btnExtractAudio.disabled = false;
    if (els.btnTopPlayPause) els.btnTopPlayPause.disabled = false;
    if (els.btnSnapshot) els.btnSnapshot.disabled = false;
    if (els.btnDoodle) els.btnDoodle.disabled = false;
    setFilterTilesEnabled(true);
    els.btnExportFiltered.disabled = false;
    els.btnExportOriginal.disabled = false;
    els.btnReset.disabled = false;

    els.body.classList.remove('state-welcome');
    els.stageTitlebar.textContent = filePath.split(/[\\/]/).pop();
    applyFilterMode();
    hideProgress();

    // Schedule filter thumbnails after the first frame is decoded.
    // Using `once: true` ensures we don't accumulate listeners on repeated loads.
    els.videoEl.addEventListener('loadeddata', () => {
      regenerateFilterThumbnails();
    }, { once: true });
  } catch (e) {
    hideProgress();
    showToast(T('toast_probe_failed', { msg: e.message }), true);
  }
}

async function pickVideo() {
  const p = await window.api.pickVideo({
    dialogTitle: T('dialog_open_title'),
    filterVideoLabel: T('filter_video'),
    filterAllLabel: T('filter_all'),
  });
  if (!p) return;
  await loadVideoFile(p);
}

function enableTransport(on) {
  const ids = ['btnFirst','btnStepBack','btnPlayPause','btnStepFwd','btnLast',
              'btnLoopIn','btnLoopOut','btnLoopToggle','btnLoopClear',
              'speedSelect','btnMute','volumeSlider','btnFullscreen'];
  ids.forEach((id) => { els[id].disabled = !on; });
  els.seekSlider.disabled = !on;
}

function togglePlayPause() {
  if (!state.hasVideo) return;
  const f = window.VFSFilters.get(state.activeFilterId);
  const isCanvasFilter = f && !f.cssFilter && state.activeFilterId !== 'original';
  if (els.videoEl.paused) {
    if (isCanvasFilter) {
      // We can't play with a canvas-only filter (the canvas is a static snapshot).
      // Hide canvas, switch to video, and reset CSS filter.
      showToast(T('filter_paused_hint'), false);
      els.body.classList.remove('canvas-mode');
      els.videoEl.style.filter = '';
    }
    els.videoEl.play().catch((e) => showToast(`Play failed: ${e.message}`, true));
    showCenterBadge('<svg viewBox="0 0 24 24" width="40" height="40"><path d="M8 5v14l11-7z"/></svg>');
  } else {
    els.videoEl.pause();
    showCenterBadge('<svg viewBox="0 0 24 24" width="40" height="40"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>');
    // If user had a canvas-mode filter selected, re-apply it on the now-paused frame.
    if (isCanvasFilter) {
      els.body.classList.add('canvas-mode');
      drawFilteredFrameToCanvas();
    }
  }
}

function stepFrames(delta) {
  if (!state.hasVideo) return;
  if (!els.videoEl.paused) els.videoEl.pause();
  const fps = state.fps || 30;
  const dur = els.videoEl.duration || 0;
  // Add a tiny epsilon so the decoder doesn't snap to the boundary frame.
  const newTime = clamp(els.videoEl.currentTime + (delta / fps) + 1e-6, 0, Math.max(0, dur - 1e-3));
  els.videoEl.currentTime = newTime;
}

function seekRelative(deltaSec) {
  if (!state.hasVideo) return;
  els.videoEl.currentTime = clamp(els.videoEl.currentTime + deltaSec, 0, els.videoEl.duration || 0);
}

function setSpeed(rate) { if (state.hasVideo) els.videoEl.playbackRate = rate; }

function setVolume(v) {
  // Preserve lastVolume so unmute can restore the previous level.
  if (els.videoEl.volume > 0 && !els.videoEl.muted) state.lastVolume = els.videoEl.volume;
  els.videoEl.volume = clamp(v, 0, 1);
  els.videoEl.muted = (v === 0);
  if (v > 0) state.lastVolume = v;
  updateVolumeUI();
}
function updateVolumeUI() {
  const muted = els.videoEl.muted || els.videoEl.volume === 0;
  els.iconVol.hidden = muted;
  els.iconMute.hidden = !muted;
  const pct = Math.round((els.videoEl.muted ? 0 : els.videoEl.volume) * 100);
  els.volumeSlider.value = String(pct);
  els.volumeSlider.style.setProperty('--vol', `${pct}%`);
}
function toggleMute() {
  if (els.videoEl.muted || els.videoEl.volume === 0) {
    els.videoEl.muted = false;
    els.videoEl.volume = state.lastVolume || 0.8;
  } else {
    state.lastVolume = els.videoEl.volume;
    els.videoEl.muted = true;
  }
  updateVolumeUI();
}

function toggleFullscreen() {
  const playerPane = document.querySelector('.player-pane');
  const target = playerPane || els.stage;
  if (!document.fullscreenElement) {
    target.requestFullscreen().catch((e) => showToast(`Fullscreen: ${e.message}`, true));
  } else {
    document.exitFullscreen();
  }
}

// ---------- A/B loop ----------
function setLoopIn() {
  if (!state.hasVideo) return;
  state.loopA = els.videoEl.currentTime;
  state.loopEnabled = (state.loopA != null && state.loopB != null);
  updateTimelineUI();
  showToast(`A = ${fmtTime(state.loopA)}`);
}
function setLoopOut() {
  if (!state.hasVideo) return;
  state.loopB = els.videoEl.currentTime;
  state.loopEnabled = (state.loopA != null && state.loopB != null);
  updateTimelineUI();
  showToast(`B = ${fmtTime(state.loopB)}`);
}
function toggleLoop() {
  if (state.loopA == null || state.loopB == null) return;
  state.loopEnabled = !state.loopEnabled;
  els.btnLoopToggle.classList.toggle('active', state.loopEnabled);
  updateTimelineUI();
}
function clearLoop() {
  state.loopA = state.loopB = null;
  state.loopEnabled = false;
  els.btnLoopToggle.classList.remove('active');
  updateTimelineUI();
}
function enforceLoop() {
  if (!state.loopEnabled || state.loopA == null || state.loopB == null) return;
  const a = Math.min(state.loopA, state.loopB);
  const b = Math.max(state.loopA, state.loopB);
  if (b - a < 0.05) return; // ignore degenerate loops
  const t = els.videoEl.currentTime;
  if (t >= b) {
    els.videoEl.currentTime = a;
  } else if (t < a - 0.01) {
    els.videoEl.currentTime = a;
  }
}

// ---------- exports ----------
async function exportOriginal() {
  if (!state.hasVideo || els.btnExportOriginal.disabled) return;
  els.btnExportOriginal.disabled = true;
  const v = els.videoEl;
  const tmp = document.createElement('canvas');
  tmp.width = v.videoWidth || state.videoMeta.width;
  tmp.height = v.videoHeight || state.videoMeta.height;
  tmp.getContext('2d').drawImage(v, 0, 0);
  const dataUrl = tmp.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1];
  const cur = Math.round(v.currentTime * state.fps);
  const suggested = `frame_${String(cur).padStart(6, '0')}_original.png`;
  try {
    const r = await window.api.savePngFromBase64({
      base64, suggestedName: suggested,
      dialogTitle: T('dialog_save_orig_title'),
      filterPngLabel: T('filter_png'),
      filterJpegLabel: T('filter_jpeg'),
    });
    if (!r.canceled) showToast(T('toast_save_ok', { path: r.path }));
  } catch (e) { showToast(T('toast_save_failed', { msg: e.message }), true); }
  finally { els.btnExportOriginal.disabled = false; }
}

async function exportFiltered() {
  if (!state.hasVideo || els.btnExportFiltered.disabled) return;
  els.btnExportFiltered.disabled = true;
  const v = els.videoEl;
  const w = v.videoWidth || state.videoMeta.width;
  const h = v.videoHeight || state.videoMeta.height;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  tctx.drawImage(v, 0, 0, w, h);
  const data = tctx.getImageData(0, 0, w, h);
  const out = window.VFSFilters.apply(state.activeFilterId, data, state.strength);
  const tmp2 = document.createElement('canvas');
  tmp2.width = w; tmp2.height = h;
  tmp2.getContext('2d').putImageData(out, 0, 0);
  const dataUrl = tmp2.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1];
  const cur = Math.round(v.currentTime * state.fps);
  const suggested = `frame_${String(cur).padStart(6, '0')}_${state.activeFilterId}.png`;
  try {
    const r = await window.api.savePngFromBase64({
      base64, suggestedName: suggested,
      dialogTitle: T('dialog_save_filtered_title'),
      filterPngLabel: T('filter_png'),
      filterJpegLabel: T('filter_jpeg'),
    });
    if (!r.canceled) showToast(T('toast_save_ok', { path: r.path }));
  } catch (e) { showToast(T('toast_save_failed', { msg: e.message }), true); }
  finally { els.btnExportFiltered.disabled = false; }
}

// Snapshot the current video frame to PNG and prompt for save location.
// Always captures the raw frame (no filter) for predictability — to export with
// filters use the existing "Export Filtered" button.
async function snapshotCurrentFrame() {
  if (!state.hasVideo || !els.btnSnapshot || els.btnSnapshot.disabled) return;
  // If a doodle text editor is open, commit it first so the typed text lands in canvas.
  if (state.doodleActive) commitDoodleText();
  els.btnSnapshot.disabled = true;
  try {
    const v = els.videoEl;
    const w = v.videoWidth || state.videoMeta?.width;
    const h = v.videoHeight || state.videoMeta?.height;
    if (!w || !h) throw new Error('video not ready');
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(v, 0, 0, w, h);
    // Composite the doodle layer on top — it has matching native pixel dimensions.
    if (state.doodleActive && els.doodleCanvas && els.doodleCanvas.width === w && els.doodleCanvas.height === h) {
      tctx.drawImage(els.doodleCanvas, 0, 0);
    }
    const dataUrl = tmp.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    const cur = Math.round(v.currentTime * state.fps);
    const baseName = (state.videoPath || 'video').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const suggested = `${baseName}_snapshot_${String(cur).padStart(6, '0')}.png`;
    const r = await window.api.savePngFromBase64({
      base64, suggestedName: suggested,
      dialogTitle: T('dialog_save_snapshot_title'),
      filterPngLabel: T('filter_png'),
      filterJpegLabel: T('filter_jpeg'),
    });
    if (!r.canceled) showToast(T('toast_save_ok', { path: r.path }));
  } catch (e) {
    showToast(T('toast_save_failed', { msg: e.message }), true);
  } finally {
    els.btnSnapshot.disabled = !state.hasVideo;
  }
}

// ---------- doodle ----------
// A transparent canvas overlay sized to the video's native pixel dimensions.
// Strokes/text are stored in state.doodleStrokes for undo + redraw on resize.
let doodleCtx = null;
let doodleDrawing = false;
let doodleCurrentStroke = null;

function syncDoodleCanvasSize() {
  const v = els.videoEl;
  const w = v.videoWidth || state.videoMeta?.width || 0;
  const h = v.videoHeight || state.videoMeta?.height || 0;
  if (!w || !h) return;
  if (els.doodleCanvas.width !== w || els.doodleCanvas.height !== h) {
    els.doodleCanvas.width = w;
    els.doodleCanvas.height = h;
    doodleCtx = els.doodleCanvas.getContext('2d');
    redrawDoodle();
  } else if (!doodleCtx) {
    doodleCtx = els.doodleCanvas.getContext('2d');
  }
  positionDoodleOverlay();
}

// Match the doodle canvas's CSS rect to the *displayed* video rect within the
// stage. The video uses max-width/max-height + grid centering, so its actual
// rendered rect is letterboxed inside the stage.
function positionDoodleOverlay() {
  const stage = els.stage;
  if (!stage) return;
  // In canvas-mode (filtered preview) the video is hidden; use previewCanvas.
  const ref = els.body.classList.contains('canvas-mode') ? els.previewCanvas : els.videoEl;
  if (!ref) return;
  const stageRect = stage.getBoundingClientRect();
  const refRect = ref.getBoundingClientRect();
  if (!stageRect.width || !refRect.width) return;
  const left = refRect.left - stageRect.left;
  const top = refRect.top - stageRect.top;
  els.doodleCanvas.style.left = left + 'px';
  els.doodleCanvas.style.top = top + 'px';
  els.doodleCanvas.style.width = refRect.width + 'px';
  els.doodleCanvas.style.height = refRect.height + 'px';
}

function redrawDoodle() {
  if (!doodleCtx) return;
  const c = els.doodleCanvas;
  doodleCtx.clearRect(0, 0, c.width, c.height);
  for (const s of state.doodleStrokes) {
    if (s.type === 'stroke') {
      doodleCtx.strokeStyle = s.color;
      doodleCtx.lineWidth = s.size;
      doodleCtx.lineCap = 'round';
      doodleCtx.lineJoin = 'round';
      doodleCtx.beginPath();
      const pts = s.points;
      if (pts.length === 1) {
        doodleCtx.arc(pts[0].x, pts[0].y, s.size / 2, 0, Math.PI * 2);
        doodleCtx.fillStyle = s.color;
        doodleCtx.fill();
      } else {
        doodleCtx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) doodleCtx.lineTo(pts[i].x, pts[i].y);
        doodleCtx.stroke();
      }
    } else if (s.type === 'arrow') {
      drawArrow(doodleCtx, s.x1, s.y1, s.x2, s.y2, s.color, s.size);
    } else if (s.type === 'text') {
      doodleCtx.fillStyle = s.color;
      doodleCtx.font = `${s.size}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      doodleCtx.textBaseline = 'top';
      const lines = String(s.text).split('\n');
      const lh = s.size * 1.2;
      for (let i = 0; i < lines.length; i++) {
        doodleCtx.fillText(lines[i], s.x, s.y + i * lh);
      }
    }
  }
}

// Draw a straight line with a filled triangular arrowhead at (x2,y2).
// `size` is the line width; head length scales with size and segment length.
function drawArrow(ctx, x1, y1, x2, y2, color, size) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  // Head length: ~5x line width, but never more than half the segment.
  const head = Math.min(Math.max(size * 5, size * 2 + 4), len * 0.5);
  const ang = Math.atan2(dy, dx);
  // Shorten the shaft so the line ends inside the arrowhead base (avoids a
  // ragged tip when head and line widths differ).
  const shaftX = x2 - Math.cos(ang) * head * 0.85;
  const shaftY = y2 - Math.sin(ang) * head * 0.85;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(shaftX, shaftY);
  ctx.stroke();
  // Arrowhead: isoceles triangle, half-width ~0.5x head length.
  const hw = head * 0.5;
  const baseX = x2 - Math.cos(ang) * head;
  const baseY = y2 - Math.sin(ang) * head;
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(baseX + nx * hw, baseY + ny * hw);
  ctx.lineTo(baseX - nx * hw, baseY - ny * hw);
  ctx.closePath();
  ctx.fill();
}

// Map a pointer event on the doodle canvas to its native pixel coords.
function doodlePointFromEvent(ev) {
  const rect = els.doodleCanvas.getBoundingClientRect();
  const sx = els.doodleCanvas.width / rect.width;
  const sy = els.doodleCanvas.height / rect.height;
  return {
    x: (ev.clientX - rect.left) * sx,
    y: (ev.clientY - rect.top) * sy,
    sx, sy,
  };
}

function setDoodleActive(on) {
  if (on && !state.hasVideo) return;
  if (on && !els.videoEl.paused) {
    // Auto-pause so the user can draw on a still frame.
    els.videoEl.pause();
  }
  state.doodleActive = on;
  els.body.classList.toggle('doodle-mode', on);
  els.doodleCanvas.hidden = !on;
  els.doodleToolbar.hidden = !on;
  if (els.btnDoodle) els.btnDoodle.classList.toggle('primary', on);
  if (on) {
    syncDoodleCanvasSize();
    setDoodleTool(state.doodleTool || 'pen');
  } else {
    commitDoodleText();
  }
}

function setDoodleTool(name) {
  state.doodleTool = name;
  els.dtToolPen.classList.toggle('active', name === 'pen');
  els.dtToolText.classList.toggle('active', name === 'text');
  if (els.dtToolArrow) els.dtToolArrow.classList.toggle('active', name === 'arrow');
  if (els.dtToolMove) els.dtToolMove.classList.toggle('active', name === 'move');
  els.body.classList.toggle('doodle-tool-text', name === 'text');
  els.body.classList.toggle('doodle-tool-move', name === 'move');
}

function clearDoodle() {
  state.doodleStrokes = [];
  redrawDoodle();
  hideDoodleTextEditor();
}

function undoDoodle() {
  if (state.doodleStrokes.length === 0) return;
  state.doodleStrokes.pop();
  redrawDoodle();
}

// Squared distance from point (px,py) to segment (ax,ay)-(bx,by).
function distSqPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + t * dx, cy = ay + t * dy;
  const ex = px - cx, ey = py - cy;
  return ex * ex + ey * ey;
}

// Return the topmost stroke index hit by (x,y) in canvas pixels, or -1.
// Tolerance scales with the element's stroke/font size so thin strokes are
// still grabbable. Iterates top-down: later items in the array shadow earlier.
function doodleHitTest(x, y) {
  const arr = state.doodleStrokes;
  for (let i = arr.length - 1; i >= 0; i--) {
    const s = arr[i];
    if (s.type === 'stroke') {
      const tol = Math.max(s.size, 6);
      const tol2 = tol * tol;
      const pts = s.points;
      if (pts.length === 1) {
        const dx = x - pts[0].x, dy = y - pts[0].y;
        if (dx * dx + dy * dy <= tol2) return i;
      } else {
        for (let j = 1; j < pts.length; j++) {
          if (distSqPointToSegment(x, y, pts[j - 1].x, pts[j - 1].y, pts[j].x, pts[j].y) <= tol2) {
            return i;
          }
        }
      }
    } else if (s.type === 'arrow') {
      const tol = Math.max(s.size, 8);
      if (distSqPointToSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= tol * tol) return i;
    } else if (s.type === 'text') {
      // Approximate bbox using the canvas-pixel font size. Width is metric-based.
      const lines = String(s.text).split('\n');
      const lh = s.size * 1.2;
      const ctx = doodleCtx;
      const prevFont = ctx ? ctx.font : null;
      let w = 0;
      if (ctx) {
        ctx.font = `${s.size}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        for (const line of lines) w = Math.max(w, ctx.measureText(line).width);
        if (prevFont !== null) ctx.font = prevFont;
      } else {
        w = s.size * 0.6 * Math.max(...lines.map(l => l.length));
      }
      const h = lh * lines.length;
      const pad = 4;
      if (x >= s.x - pad && x <= s.x + w + pad && y >= s.y - pad && y <= s.y + h + pad) return i;
    }
  }
  return -1;
}

// Translate a stroke in place by (dx,dy) in canvas pixels.
function translateStroke(s, dx, dy) {
  if (s.type === 'stroke') {
    for (const p of s.points) { p.x += dx; p.y += dy; }
  } else if (s.type === 'arrow') {
    s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy;
  } else if (s.type === 'text') {
    s.x += dx; s.y += dy;
  }
}

// Move-tool drag state. Lives outside doodleCurrentStroke since we're not
// creating a new element — just translating an existing one.
let doodleMoveIdx = -1;
let doodleMoveLast = null;

function bindDoodleCanvas() {
  const c = els.doodleCanvas;

  c.addEventListener('pointerdown', (ev) => {
    if (!state.doodleActive) return;
    if (state.doodleTool === 'text') {
      const p = doodlePointFromEvent(ev);
      openDoodleTextEditor(ev.clientX, ev.clientY, p);
      return;
    }
    if (state.doodleTool === 'move') {
      const p = doodlePointFromEvent(ev);
      const idx = doodleHitTest(p.x, p.y);
      if (idx === -1) return;
      c.setPointerCapture(ev.pointerId);
      doodleMoveIdx = idx;
      doodleMoveLast = { x: p.x, y: p.y };
      return;
    }
    if (state.doodleTool === 'arrow') {
      c.setPointerCapture(ev.pointerId);
      doodleDrawing = true;
      const p = doodlePointFromEvent(ev);
      doodleCurrentStroke = {
        type: 'arrow',
        color: state.doodleColor,
        size: state.doodleSize,
        x1: p.x, y1: p.y,
        x2: p.x, y2: p.y,
      };
      state.doodleStrokes.push(doodleCurrentStroke);
      redrawDoodle();
      return;
    }
    // Pen.
    c.setPointerCapture(ev.pointerId);
    doodleDrawing = true;
    const p = doodlePointFromEvent(ev);
    doodleCurrentStroke = {
      type: 'stroke',
      color: state.doodleColor,
      size: state.doodleSize,
      points: [{ x: p.x, y: p.y }],
    };
    state.doodleStrokes.push(doodleCurrentStroke);
    redrawDoodle();
  });
  c.addEventListener('pointermove', (ev) => {
    if (doodleMoveIdx !== -1) {
      const p = doodlePointFromEvent(ev);
      const dx = p.x - doodleMoveLast.x, dy = p.y - doodleMoveLast.y;
      if (dx === 0 && dy === 0) return;
      translateStroke(state.doodleStrokes[doodleMoveIdx], dx, dy);
      doodleMoveLast = { x: p.x, y: p.y };
      redrawDoodle();
      return;
    }
    if (!doodleDrawing || !doodleCurrentStroke) {
      // Hover feedback in move mode: switch cursor when over a hit.
      if (state.doodleTool === 'move') {
        const p = doodlePointFromEvent(ev);
        c.classList.toggle('hit', doodleHitTest(p.x, p.y) !== -1);
      }
      return;
    }
    const p = doodlePointFromEvent(ev);
    if (doodleCurrentStroke.type === 'arrow') {
      doodleCurrentStroke.x2 = p.x;
      doodleCurrentStroke.y2 = p.y;
      // Arrow geometry depends on the endpoint; can't draw incrementally —
      // wipe and redraw the whole layer.
      redrawDoodle();
      return;
    }
    const pts = doodleCurrentStroke.points;
    const last = pts[pts.length - 1];
    // Skip jitter — require at least 1 device px movement at canvas resolution.
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1) return;
    pts.push({ x: p.x, y: p.y });
    // Incremental draw: just continue the path from the last segment.
    doodleCtx.strokeStyle = doodleCurrentStroke.color;
    doodleCtx.lineWidth = doodleCurrentStroke.size;
    doodleCtx.lineCap = 'round';
    doodleCtx.lineJoin = 'round';
    doodleCtx.beginPath();
    doodleCtx.moveTo(last.x, last.y);
    doodleCtx.lineTo(p.x, p.y);
    doodleCtx.stroke();
  });
  const endStroke = (ev) => {
    if (doodleMoveIdx !== -1) {
      doodleMoveIdx = -1;
      doodleMoveLast = null;
      try { c.releasePointerCapture(ev.pointerId); } catch {}
      return;
    }
    if (!doodleDrawing) return;
    doodleDrawing = false;
    try { c.releasePointerCapture(ev.pointerId); } catch {}
    // Drop zero-length arrows so a stray click doesn't leave an invisible item
    // taking up an undo slot.
    if (doodleCurrentStroke && doodleCurrentStroke.type === 'arrow') {
      const a = doodleCurrentStroke;
      if (Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 2) {
        const idx = state.doodleStrokes.lastIndexOf(a);
        if (idx !== -1) state.doodleStrokes.splice(idx, 1);
        redrawDoodle();
      }
    }
    doodleCurrentStroke = null;
  };
  c.addEventListener('pointerup', endStroke);
  c.addEventListener('pointercancel', endStroke);
  c.addEventListener('pointerleave', (ev) => { if (ev.buttons === 0) endStroke(ev); });
}

// Position the contenteditable overlay at clientX/clientY; remember the
// canvas-pixel anchor (canvasX/Y) so we can rasterize on commit.
let pendingTextAnchor = null; // { x, y, sx, sy }

function openDoodleTextEditor(clientX, clientY, canvasPoint) {
  commitDoodleText();
  const stageRect = els.stage.getBoundingClientRect();
  const ed = els.doodleTextEditor;
  ed.hidden = false;
  ed.textContent = '';
  ed.style.left = (clientX - stageRect.left) + 'px';
  ed.style.top = (clientY - stageRect.top) + 'px';
  ed.style.color = state.doodleColor;
  // Convert canvas-pixel font size to displayed pixel size for the editor.
  const cssFontPx = Math.max(8, Math.round(state.doodleFontSize / canvasPoint.sx));
  ed.style.fontSize = cssFontPx + 'px';
  pendingTextAnchor = canvasPoint;
  setTimeout(() => ed.focus(), 0);
}

function hideDoodleTextEditor() {
  els.doodleTextEditor.hidden = true;
  els.doodleTextEditor.textContent = '';
  pendingTextAnchor = null;
}

function commitDoodleText() {
  const ed = els.doodleTextEditor;
  if (ed.hidden || !pendingTextAnchor) return;
  const text = ed.innerText.replace(/ /g, ' ').replace(/\r/g, '');
  if (text.trim().length > 0) {
    // Canvas-pixel font size from the dedicated font-size input.
    const fontPx = state.doodleFontSize;
    state.doodleStrokes.push({
      type: 'text',
      x: pendingTextAnchor.x,
      y: pendingTextAnchor.y,
      text, color: state.doodleColor, size: fontPx,
    });
    redrawDoodle();
  }
  hideDoodleTextEditor();
}

function bindDoodleTextEditor() {
  const ed = els.doodleTextEditor;
  ed.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      commitDoodleText();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      hideDoodleTextEditor();
    }
    // stop most app shortcuts from firing while typing
    ev.stopPropagation();
  });
  ed.addEventListener('blur', commitDoodleText);
}

// ---------- frame extraction ----------
async function extractFrames() {
  if (!state.videoPath || state.isExtracting) return;
  state.isExtracting = true;
  els.btnExtract.disabled = true;
  if (state.sessionId) {
    try { await window.api.cleanupSession(state.sessionId); } catch {}
  }
  state.sessionId = null;
  state.frames = [];
  state.thumbCache.clear();
  state.prevActiveIdx = -1;
  if (filmstripObserver) { filmstripObserver.disconnect(); filmstripObserver = null; }
  els.filmstrip.hidden = true;
  els.filmstrip.innerHTML = '';
  if (els.extractStatus) els.extractStatus.textContent = '';

  const targetFps = Math.max(0, parseFloat(els.optFps.value) || 0);
  const maxFrames = Math.max(0, parseInt(els.optMax.value, 10) || 0);
  const quality = Math.max(2, Math.min(31, parseInt(els.optQuality.value, 10) || 3));

  // Remember the rate at which frames were extracted so we can map index ↔ time later.
  state.extractFps = targetFps > 0 ? targetFps : (state.fps || 30);

  showProgress(T('extracting', { n: 0 }));
  const off = window.api.onProgress(({ framesDone }) => {
    els.progressText.textContent = T('extracting', { n: framesDone });
  });
  try {
    const result = await window.api.extractFrames({
      filePath: state.videoPath, targetFps, maxFrames, quality,
    });
    state.sessionId = result.sessionId;
    state.frames = result.frames;
    if (result.count > 0) {
      buildFilmstrip();
      els.filmstrip.hidden = false;
      els.extractStatus.textContent = T('meta_frames_extracted', { n: result.count });
    } else {
      showToast(T('toast_no_frames'), true);
      els.extractStatus.textContent = '';
    }
    // Re-enable extract button.
    els.btnExtract.disabled = false;
  } catch (e) {
    showToast(T('toast_extract_failed', { msg: e.message }), true);
    els.btnExtract.disabled = false;
  } finally {
    off && off();
    hideProgress();
    state.isExtracting = false;
  }
}

// ---------- audio extraction ----------
function formatHMS(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

async function extractAudio() {
  if (!state.videoPath || state.isExtracting) return;
  const fmt = (els.optAudioFormat && els.optAudioFormat.value) || 'mp3';
  if (els.btnExtractAudio) els.btnExtractAudio.disabled = true;
  els.btnExtract.disabled = true;
  state.isExtracting = true;

  showProgress(T('extracting_audio', { t: '0:00' }));
  const off = window.api.onAudioProgress(({ ms }) => {
    els.progressText.textContent = T('extracting_audio', { t: formatHMS((ms || 0) / 1000) });
  });
  try {
    const baseName = state.videoPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const result = await window.api.extractAudio({
      filePath: state.videoPath,
      format: fmt,
      dialogTitle: T('dialog_save_audio_title'),
      suggestedName: `${baseName}.${fmt}`,
      filterLabel: T('filter_audio_label', { fmt: fmt.toUpperCase() }),
    });
    if (!result || result.canceled) {
      // user cancelled save dialog — nothing to do
    } else {
      showToast(T('toast_save_ok', { path: result.path }));
    }
  } catch (e) {
    showToast(T('toast_audio_extract_failed', { msg: e.message }), true);
  } finally {
    off && off();
    hideProgress();
    state.isExtracting = false;
    if (els.btnExtractAudio) els.btnExtractAudio.disabled = !state.hasVideo;
    els.btnExtract.disabled = !state.hasVideo;
  }
}

// ---------- filmstrip ----------
async function getThumbBase64(idx) {
  if (state.thumbCache.has(idx)) return state.thumbCache.get(idx);
  const f = state.frames[idx];
  if (!f) return null;
  const b64 = await window.api.readFrame(f.path);
  lruSet(state.thumbCache, idx, b64, THUMB_CACHE_LIMIT);
  return b64;
}

let filmstripObserver = null;

// Convert a frame index (within state.frames) to a video timestamp in seconds.
function frameIndexToTime(i) {
  const fps = state.extractFps || state.fps || 30;
  const dur = els.videoEl.duration || state.videoMeta?.duration || 0;
  // Each frame represents 1/fps seconds; clamp to duration to be safe.
  const t = (i + 0.5) / fps;
  if (dur > 0) return Math.min(t, Math.max(0, dur - 0.001));
  return t;
}

// Inverse: given the current play time, which extracted frame is "active"?
function timeToFrameIndex(t) {
  const fps = state.extractFps || state.fps || 30;
  if (state.frames.length === 0) return -1;
  const i = Math.floor(t * fps);
  return Math.max(0, Math.min(state.frames.length - 1, i));
}

function buildFilmstrip() {
  if (filmstripObserver) { filmstripObserver.disconnect(); filmstripObserver = null; }
  els.filmstrip.innerHTML = '';
  state.prevActiveIdx = -1;
  if (state.frames.length === 0) return;

  const active = timeToFrameIndex(els.videoEl.currentTime);
  state.prevActiveIdx = active;

  for (let i = 0; i < state.frames.length; i++) {
    const item = document.createElement('div');
    item.className = 'film-thumb placeholder' + (i === active ? ' active' : '');
    item.dataset.index = String(i);
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(i + 1);
    item.appendChild(idx);
    els.filmstrip.appendChild(item);
  }

  filmstripObserver = new IntersectionObserver(async (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const item = entry.target;
      filmstripObserver.unobserve(item);
      const i = Number(item.dataset.index);
      try {
        const b64 = await getThumbBase64(i);
        if (item.parentElement !== els.filmstrip) return;
        const img = new Image();
        img.onload = () => {
          item.classList.remove('placeholder');
          item.appendChild(img);
        };
        img.src = `data:image/jpeg;base64,${b64}`;
      } catch (e) { console.warn('[VFS] thumb load fail', i, e); }
    }
  }, { root: els.filmstrip, rootMargin: '500px 0px', threshold: 0.01 });

  els.filmstrip.querySelectorAll('.film-thumb').forEach((el) => filmstripObserver.observe(el));

  requestAnimationFrame(() => scrollFilmstripToActive(false));
}

function updateFilmstripActive() {
  if (state.frames.length === 0) return;
  const active = timeToFrameIndex(els.videoEl.currentTime);
  if (active === state.prevActiveIdx) return; // already correct
  // Remove active from the previous one (cheap), add to the new (cheap).
  if (state.prevActiveIdx >= 0) {
    const prev = els.filmstrip.querySelector(
      `.film-thumb[data-index="${state.prevActiveIdx}"]`);
    if (prev) prev.classList.remove('active');
  }
  const cur = els.filmstrip.querySelector(`.film-thumb[data-index="${active}"]`);
  if (cur) cur.classList.add('active');
  state.prevActiveIdx = active;
  scrollFilmstripToActive(true);
}

function scrollFilmstripToActive(smooth) {
  const active = els.filmstrip.querySelector('.film-thumb.active');
  if (!active) return;
  const stripRect = els.filmstrip.getBoundingClientRect();
  const itemRect = active.getBoundingClientRect();
  const offset = (itemRect.left + itemRect.width / 2) - (stripRect.left + stripRect.width / 2);
  if (Math.abs(offset) < 20) return;
  els.filmstrip.scrollBy({ left: offset, behavior: smooth ? 'smooth' : 'auto' });
}

// Click handler for any frame — sets active class, seeks the video, and forces
// a redraw if a canvas-mode filter is currently displayed.
function seekToFrameIndex(i, itemEl) {
  const v = els.videoEl;
  const t = frameIndexToTime(i);

  // Active class — immediately, on whatever element matches data-index=i.
  els.filmstrip.querySelectorAll('.film-thumb.active').forEach((el) => el.classList.remove('active'));
  const target = itemEl || els.filmstrip.querySelector(`.film-thumb[data-index="${i}"]`);
  if (target) target.classList.add('active');
  state.prevActiveIdx = i;

  try {
    if (Math.abs(v.currentTime - t) < 0.001) {
      v.currentTime = t + 0.001;
    } else {
      v.currentTime = t;
    }
  } catch (e) {
    console.error('[VFS] seek failed', e);
  }

  // If we're showing the canvas (non-CSS filter), redraw it after the seek
  // resolves — otherwise the canvas keeps showing the previous frame.
  // Use a timeout fallback so the listener is always cleaned up even if
  // `seeked` doesn't fire (e.g., currentTime was already at target).
  const f = window.VFSFilters.get(state.activeFilterId);
  const needsCanvasRedraw = f && !f.cssFilter && state.activeFilterId !== 'original';
  if (needsCanvasRedraw) {
    let timeoutId;
    const onSeeked = () => {
      v.removeEventListener('seeked', onSeeked);
      clearTimeout(timeoutId);
      drawFilteredFrameToCanvas();
    };
    v.addEventListener('seeked', onSeeked);
    timeoutId = setTimeout(() => {
      v.removeEventListener('seeked', onSeeked);
      drawFilteredFrameToCanvas();
    }, 500);
  }
}

// ---------- language picker ----------
function buildLangSelect() {
  els.langSelect.innerHTML = '';
  for (const { code, name } of window.VFSi18n.list()) {
    if (!name) continue; // skip incomplete locales
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = name;
    els.langSelect.appendChild(opt);
  }
  els.langSelect.value = window.VFSi18n.current();
  els.langSelect.addEventListener('change', () => {
    window.VFSi18n.set(els.langSelect.value);
  });
}

// ---------- help modal ----------
function toggleHelp(force) {
  const hidden = els.helpModal.hidden;
  const show = (typeof force === 'boolean') ? force : hidden;
  els.helpModal.hidden = !show;
}

// ---------- drag & drop ----------
function bindDragDrop() {
  const isFileDrag = (e) => e.dataTransfer
    && Array.from(e.dataTransfer.types).includes('Files');

  const onEnter = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    state.dragDepth++;
    els.dropOverlay.hidden = false;
  };
  const onOver = (e) => {
    if (isFileDrag(e)) e.preventDefault();
  };
  const onLeave = (e) => {
    if (!isFileDrag(e)) return;
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) els.dropOverlay.hidden = true;
  };
  const onDrop = (e) => {
    e.preventDefault();
    state.dragDepth = 0;
    els.dropOverlay.hidden = true;
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    // Pick the first file that looks like a supported video.
    const VIDEO_EXTS = /\.(mp4|m4v|mov|mkv|webm|avi|flv|wmv|mpg|mpeg|ts)$/i;
    let file = null;
    for (const f of files) {
      if (VIDEO_EXTS.test(f.name) || (f.type && f.type.startsWith('video/'))) {
        file = f;
        break;
      }
    }
    if (!file) {
      showToast(T('toast_not_video'), true);
      return;
    }
    const p = window.api.pathForFile(file);
    if (!p) {
      showToast(T('toast_drop_path_failed'), true);
      return;
    }
    loadVideoFile(p);
  };
  window.addEventListener('dragenter', onEnter);
  window.addEventListener('dragover', onOver);
  window.addEventListener('dragleave', onLeave);
  window.addEventListener('drop', onDrop);
}

// ---------- keyboard ----------
function isTypingTarget(e) {
  const t = e.target;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

function handleKey(e) {
  // Ignore key auto-repeats for keys that toggle UI state, to avoid flicker.
  if (e.repeat && (e.key === '?' || e.key === 'Escape' ||
                   e.key === ' ' || e.key === 'k' || e.key === 'K' ||
                   e.key === 'f' || e.key === 'F' ||
                   e.key === 'm' || e.key === 'M')) {
    return;
  }

  // ? toggles help (works regardless of state)
  if (!isTypingTarget(e) && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
    e.preventDefault();
    toggleHelp();
    return;
  }
  // Esc closes help if open
  if (e.key === 'Escape' && !els.helpModal.hidden) {
    e.preventDefault();
    toggleHelp(false);
    return;
  }

  if (isTypingTarget(e)) return;
  // If help modal is open, only Esc passes through (handled above).
  if (!els.helpModal.hidden) return;
  if (!state.hasVideo) return;

  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const n = parseInt(e.key, 10);
    if (!isNaN(n) && n >= 1 && n <= 9) {
      const list = window.VFSFilters.list();
      const target = list[n];
      if (target) { e.preventDefault(); setActiveFilter(target.id); return; }
    }
  }

  switch (e.key) {
    case ' ':
    case 'k': case 'K':
      e.preventDefault(); togglePlayPause(); break;
    case 'j': case 'J':
      e.preventDefault(); seekRelative(-10); break;
    case 'l': case 'L':
      e.preventDefault(); seekRelative(10); break;
    case 'ArrowLeft':
      e.preventDefault();
      if (e.shiftKey) seekRelative(-10);
      else if (els.videoEl.paused) stepFrames(-1);
      else seekRelative(-5);
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (e.shiftKey) seekRelative(10);
      else if (els.videoEl.paused) stepFrames(1);
      else seekRelative(5);
      break;
    case ',': case '<':
      e.preventDefault(); stepFrames(-1); break;
    case '.': case '>':
      e.preventDefault(); stepFrames(1); break;
    case 'Home':
      e.preventDefault(); els.videoEl.currentTime = 0; break;
    case 'End':
      e.preventDefault(); els.videoEl.currentTime = els.videoEl.duration || 0; break;
    case 'i': case 'I':
      e.preventDefault(); setLoopIn(); break;
    case 'o': case 'O':
      e.preventDefault(); setLoopOut(); break;
    case '\\':
      e.preventDefault(); clearLoop(); break;
    case 'm': case 'M':
      e.preventDefault(); toggleMute(); break;
    case 'f': case 'F':
      e.preventDefault(); toggleFullscreen(); break;
    case '/':
      e.preventDefault(); els.filterSearch.focus(); break;
    case 'ArrowUp':
      e.preventDefault(); setVolume(clamp(els.videoEl.volume + 0.05, 0, 1)); break;
    case 'ArrowDown':
      e.preventDefault(); setVolume(clamp(els.videoEl.volume - 0.05, 0, 1)); break;
  }
}

// ---------- init ----------
function init() {
  window.VFSi18n.init();
  window.VFSi18n.onChange(() => applyLocalization());

  buildFilterTiles();
  buildCategoryTabs();
  buildLangSelect();
  applyLocalization();
  bindDragDrop();
  bindTimelineHover();

  // Welcome card click → pick
  els.dropZone.addEventListener('click', pickVideo);

  // Top buttons
  els.btnPick.addEventListener('click', pickVideo);
  els.btnExtract.addEventListener('click', extractFrames);
  if (els.btnExtractAudio) els.btnExtractAudio.addEventListener('click', extractAudio);
  els.btnHelp.addEventListener('click', () => toggleHelp());
  els.btnManual.addEventListener('click', () => {
    window.api.openManual().catch((e) => showToast(`Manual: ${e.message}`, true));
  });
  els.btnHelpClose.addEventListener('click', () => toggleHelp(false));
  els.helpModal.addEventListener('click', (e) => {
    if (e.target === els.helpModal) toggleHelp(false);
  });

  // Exports / reset
  els.btnExportOriginal.addEventListener('click', exportOriginal);
  els.btnExportFiltered.addEventListener('click', exportFiltered);
  els.btnReset.addEventListener('click', () => setActiveFilter('original'));

  // Transport
  els.btnPlayPause.addEventListener('click', togglePlayPause);
  els.btnFirst.addEventListener('click', () => { els.videoEl.currentTime = 0; });
  els.btnLast.addEventListener('click', () => { els.videoEl.currentTime = els.videoEl.duration || 0; });
  els.btnStepBack.addEventListener('click', () => stepFrames(-1));
  els.btnStepFwd.addEventListener('click', () => stepFrames(1));
  els.btnLoopIn.addEventListener('click', setLoopIn);
  els.btnLoopOut.addEventListener('click', setLoopOut);
  els.btnLoopToggle.addEventListener('click', () => {
    if (state.loopA == null || state.loopB == null) {
      showToast(T('toast_loop_set_first'));
      return;
    }
    toggleLoop();
  });
  els.btnLoopClear.addEventListener('click', clearLoop);
  els.speedSelect.addEventListener('change', () => setSpeed(Number(els.speedSelect.value)));
  els.btnMute.addEventListener('click', toggleMute);
  els.volumeSlider.addEventListener('input', () => setVolume(Number(els.volumeSlider.value) / 100));
  els.btnFullscreen.addEventListener('click', toggleFullscreen);

  // Top-bar play/pause + snapshot
  if (els.btnTopPlayPause) els.btnTopPlayPause.addEventListener('click', togglePlayPause);
  if (els.btnSnapshot) els.btnSnapshot.addEventListener('click', snapshotCurrentFrame);
  if (els.btnDoodle) els.btnDoodle.addEventListener('click', () => setDoodleActive(!state.doodleActive));

  // Doodle toolbar
  if (els.dtToolPen) els.dtToolPen.addEventListener('click', () => setDoodleTool('pen'));
  if (els.dtToolText) els.dtToolText.addEventListener('click', () => setDoodleTool('text'));
  if (els.dtToolArrow) els.dtToolArrow.addEventListener('click', () => setDoodleTool('arrow'));
  if (els.dtToolMove) els.dtToolMove.addEventListener('click', () => setDoodleTool('move'));
  if (els.dtColor) els.dtColor.addEventListener('input', () => { state.doodleColor = els.dtColor.value; });
  if (els.dtSize) els.dtSize.addEventListener('input', () => { state.doodleSize = Number(els.dtSize.value) || 4; });
  if (els.dtFontSize) {
    els.dtFontSize.addEventListener('input', () => {
      const v = parseInt(els.dtFontSize.value, 10);
      if (Number.isFinite(v) && v >= 8 && v <= 200) {
        state.doodleFontSize = v;
        // Live update the in-flight text editor (if open) so the preview matches.
        const ed = els.doodleTextEditor;
        if (!ed.hidden && pendingTextAnchor) {
          ed.style.fontSize = Math.max(8, Math.round(state.doodleFontSize / pendingTextAnchor.sx)) + 'px';
        }
      }
    });
  }
  if (els.dtUndo) els.dtUndo.addEventListener('click', undoDoodle);
  if (els.dtClear) els.dtClear.addEventListener('click', clearDoodle);
  if (els.dtExit) els.dtExit.addEventListener('click', () => setDoodleActive(false));
  bindDoodleCanvas();
  bindDoodleTextEditor();
  // Re-position the doodle overlay when the video element resizes.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => { if (state.doodleActive || !els.doodleCanvas.hidden) positionDoodleOverlay(); });
    ro.observe(els.videoEl);
    ro.observe(els.stage);
  }
  window.addEventListener('resize', () => { if (!els.doodleCanvas.hidden) positionDoodleOverlay(); });

  // Seek slider
  els.seekSlider.addEventListener('input', () => {
    state.isSeeking = true;
    const v = els.videoEl;
    if (v.duration) v.currentTime = (Number(els.seekSlider.value) / 1000) * v.duration;
  });
  els.seekSlider.addEventListener('change', () => { state.isSeeking = false; });
  // Belt and suspenders: also clear isSeeking on pointerup/blur, in case the
  // change event doesn't fire (rare browser quirks).
  els.seekSlider.addEventListener('pointerup', () => { state.isSeeking = false; });
  els.seekSlider.addEventListener('blur', () => { state.isSeeking = false; });

  // Filter strength
  els.filterStrength.addEventListener('input', () => {
    state.strength = Number(els.filterStrength.value) / 100;
    els.filterStrengthVal.textContent = `${els.filterStrength.value}%`;
    els.filterStrength.style.setProperty('--strength', `${els.filterStrength.value}%`);
    applyFilterMode();
  });
  els.filterStrength.style.setProperty('--strength', '100%');

  // Filter search
  els.filterSearch.addEventListener('input', applyFilterVisibility);

  // Video events
  const v = els.videoEl;
  v.addEventListener('loadedmetadata', () => {
    updateTimelineUI();
    refreshFrameInfo();
    setVolume(state.lastVolume);
    // New video → drop any prior doodle and resize the layer.
    state.doodleStrokes = [];
    if (state.doodleActive) setDoodleActive(false);
    syncDoodleCanvasSize();
  });
  v.addEventListener('play', () => {
    els.iconPlay.hidden = true;
    els.iconPause.hidden = false;
    els.btnPlayPause.title = T('pause_title');
    if (els.iconTopPlay) els.iconTopPlay.hidden = true;
    if (els.iconTopPause) els.iconTopPause.hidden = false;
    if (els.btnTopPlayPause) els.btnTopPlayPause.title = T('pause_title');
    if (els.topPlayState) els.topPlayState.textContent = T('state_playing');
    // Doodle is paused-only; auto-exit on play.
    if (state.doodleActive) setDoodleActive(false);
  });
  v.addEventListener('pause', () => {
    els.iconPlay.hidden = false;
    els.iconPause.hidden = true;
    els.btnPlayPause.title = T('play_title');
    if (els.iconTopPlay) els.iconTopPlay.hidden = false;
    if (els.iconTopPause) els.iconTopPause.hidden = true;
    if (els.btnTopPlayPause) els.btnTopPlayPause.title = T('play_title');
    if (els.topPlayState) els.topPlayState.textContent = T('state_paused');
    const f = window.VFSFilters.get(state.activeFilterId);
    if (f && !f.cssFilter && state.activeFilterId !== 'original') {
      drawFilteredFrameToCanvas();
    }
  });
  v.addEventListener('timeupdate', () => {
    enforceLoop();
    updateTimelineUI();
    refreshFrameInfo();
    // While a seek is in flight, leave the filmstrip alone — the click handler
    // already set the right .active class and the `seeked` event will confirm.
    if (state.frames.length > 0 && !v.seeking) updateFilmstripActive();
  });
  v.addEventListener('seeked', () => {
    refreshFrameInfo();
    const f = window.VFSFilters.get(state.activeFilterId);
    if (f && !f.cssFilter && state.activeFilterId !== 'original') {
      drawFilteredFrameToCanvas();
    }
    if (state.frames.length > 0) updateFilmstripActive();
  });
  v.addEventListener('progress', updateTimelineUI);
  v.addEventListener('volumechange', updateVolumeUI);
  v.addEventListener('ratechange', () => {
    // Reflect actual playbackRate in the speed select if it matches an option.
    const r = String(els.videoEl.playbackRate);
    const opt = els.speedSelect.querySelector(`option[value="${r}"]`);
    if (opt) els.speedSelect.value = r;
  });
  v.addEventListener('ended', () => {
    if (state.loopEnabled && state.loopA != null) {
      els.videoEl.currentTime = Math.min(state.loopA, state.loopB || 0);
      els.videoEl.play().catch(() => {});
    }
  });
  v.addEventListener('error', () => {
    if (v.error) {
      const codes = ['ABORTED','NETWORK','DECODE','SRC_NOT_SUPPORTED'];
      showToast(`Video error: ${codes[v.error.code - 1] || v.error.code} ${v.error.message || ''}`, true);
    }
  });
  // Click on the stage (works for video AND canvas) toggles play/pause.
  els.stage.addEventListener('click', (e) => {
    if (e.target === els.videoEl || e.target === els.previewCanvas) {
      togglePlayPause();
    }
  });

  // Initial play state on load — sync top-bar.
  v.addEventListener('canplay', () => {
    if (v.paused) {
      if (els.iconTopPlay) els.iconTopPlay.hidden = false;
      if (els.iconTopPause) els.iconTopPause.hidden = true;
      if (els.topPlayState) els.topPlayState.textContent = T('state_paused');
    }
  });

  document.addEventListener('keydown', handleKey);

  // Vertical mousewheel → horizontal scroll on the filmstrip
  els.filmstrip.addEventListener('wheel', (e) => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    els.filmstrip.scrollLeft += e.deltaY;
  }, { passive: false });

  // Same trick for the category tabs row.
  els.filterCats.addEventListener('wheel', (e) => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    els.filterCats.scrollLeft += e.deltaY;
  }, { passive: false });

  // Delegated click on filmstrip — survives DOM rebuilds, no per-thumb re-binding.
  els.filmstrip.addEventListener('click', (e) => {
    const item = e.target.closest('.film-thumb');
    if (!item || !els.filmstrip.contains(item)) return;
    const i = Number(item.dataset.index);
    if (Number.isNaN(i)) return;
    seekToFrameIndex(i, item);
  });

  window.addEventListener('beforeunload', () => {
    if (state.sessionId) window.api.cleanupSession(state.sessionId);
  });
}

document.addEventListener('DOMContentLoaded', init);
