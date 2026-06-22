// Pure ImageData pixel filters. Each filter: (imageData, strength01) -> ImageData
// `strength01` is 0..1; 0 means unchanged, 1 means full effect.
// Filters mutate and return the same ImageData for speed.

(function () {
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  // Generic 3x3 convolution that handles edges by clamping coordinates.
  function convolve3x3(imageData, kernel, divisor = 1, offset = 0) {
    const { width, height, data } = imageData;
    const out = new Uint8ClampedArray(data.length);
    const w = width, h = height;
    const k = kernel;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const sx = Math.min(w - 1, Math.max(0, x + kx));
            const sy = Math.min(h - 1, Math.max(0, y + ky));
            const idx = (sy * w + sx) * 4;
            const kval = k[(ky + 1) * 3 + (kx + 1)];
            r += data[idx] * kval;
            g += data[idx + 1] * kval;
            b += data[idx + 2] * kval;
          }
        }
        const i = (y * w + x) * 4;
        out[i] = clamp(r / divisor + offset);
        out[i + 1] = clamp(g / divisor + offset);
        out[i + 2] = clamp(b / divisor + offset);
        out[i + 3] = data[i + 3];
      }
    }
    data.set(out);
    return imageData;
  }

  function blendOriginal(imageData, originalData, t) {
    if (t >= 1) return imageData;
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = lerp(originalData[i],     data[i],     t);
      data[i + 1] = lerp(originalData[i + 1], data[i + 1], t);
      data[i + 2] = lerp(originalData[i + 2], data[i + 2], t);
    }
    return imageData;
  }

  // RGB <-> HSL helpers
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s; const l = (max + min) / 2;
    if (max === min) { h = 0; s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h, s, l];
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }
  function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [r * 255, g * 255, b * 255];
  }

  const FILTERS = {};

  function defineFilter(id, name, desc, fn, opts) {
    // name/desc are kept as English fallbacks; localized labels come from VFSi18n.
    // opts.cssFilter: a `filter:` value for live <video> playback (null = pause-mode).
    // opts.category: 'basic' | 'color' | 'bw' | 'stylize' | 'blur' | 'distort' | 'mood'
    FILTERS[id] = {
      id, name, desc, apply: fn,
      cssFilter: opts?.cssFilter || null,
      category: opts?.category || 'stylize',
    };
  }

  defineFilter('original', 'Original', 'No filter applied', (img) => img,
    { cssFilter: () => 'none', category: 'basic' });

  defineFilter('grayscale', 'Grayscale', 'Luminance-weighted gray', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      d[i] = d[i+1] = d[i+2] = y;
    }
    return blendOriginal(img, orig, t);
  }, { cssFilter: (t) => `grayscale(${t})`, category: 'bw' });

  defineFilter('sepia', 'Sepia', 'Warm vintage tone', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      d[i]   = clamp(0.393*r + 0.769*g + 0.189*b);
      d[i+1] = clamp(0.349*r + 0.686*g + 0.168*b);
      d[i+2] = clamp(0.272*r + 0.534*g + 0.131*b);
    }
    return blendOriginal(img, orig, t);
  }, { cssFilter: (t) => `sepia(${t})`, category: 'mood' });

  defineFilter('invert', 'Invert', 'Color negative', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i];
      d[i+1] = 255 - d[i+1];
      d[i+2] = 255 - d[i+2];
    }
    return blendOriginal(img, orig, t);
  }, { cssFilter: (t) => `invert(${t})`, category: 'stylize' });

  defineFilter('brighten', 'Brighten', 'Increase exposure', (img, t) => {
    const amt = 60 * t;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp(d[i] + amt);
      d[i+1] = clamp(d[i+1] + amt);
      d[i+2] = clamp(d[i+2] + amt);
    }
    return img;
  }, { cssFilter: (t) => `brightness(${1 + 0.6 * t})`, category: 'color' });

  defineFilter('darken', 'Darken', 'Reduce exposure', (img, t) => {
    const amt = 60 * t;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp(d[i] - amt);
      d[i+1] = clamp(d[i+1] - amt);
      d[i+2] = clamp(d[i+2] - amt);
    }
    return img;
  }, { cssFilter: (t) => `brightness(${1 - 0.6 * t})`, category: 'color' });

  defineFilter('contrast', 'Contrast', 'Boost contrast', (img, t) => {
    const c = 1 + 1.2 * t;
    const intercept = 128 * (1 - c);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp(d[i] * c + intercept);
      d[i+1] = clamp(d[i+1] * c + intercept);
      d[i+2] = clamp(d[i+2] * c + intercept);
    }
    return img;
  }, { cssFilter: (t) => `contrast(${1 + 1.2 * t})`, category: 'color' });

  defineFilter('saturate', 'Saturate', 'Punch up colors', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = rgbToHsl(d[i], d[i+1], d[i+2]);
      const ns = Math.min(1, s * (1 + 1.2 * t));
      const [r, g, b] = hslToRgb(h, ns, l);
      d[i] = r; d[i+1] = g; d[i+2] = b;
    }
    return blendOriginal(img, orig, 1);
  }, { cssFilter: (t) => `saturate(${1 + 1.2 * t})`, category: 'color' });

  defineFilter('desaturate', 'Desaturate', 'Wash out colors', (img, t) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      d[i]   = lerp(d[i], y, t);
      d[i+1] = lerp(d[i+1], y, t);
      d[i+2] = lerp(d[i+2], y, t);
    }
    return img;
  }, { cssFilter: (t) => `saturate(${1 - t})`, category: 'color' });

  defineFilter('hueshift', 'Hue Shift', 'Rotate the hue wheel', (img, t) => {
    const shift = t; // full rotation at 100%
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = rgbToHsl(d[i], d[i+1], d[i+2]);
      const [r, g, b] = hslToRgb((h + shift) % 1, s, l);
      d[i] = r; d[i+1] = g; d[i+2] = b;
    }
    return img;
  }, { cssFilter: (t) => `hue-rotate(${t * 360}deg)`, category: 'color' });

  defineFilter('warm', 'Warm Tone', 'Push highlights to amber', (img, t) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = clamp(d[i] + 35 * t);
      d[i+1] = clamp(d[i+1] + 12 * t);
      d[i+2] = clamp(d[i+2] - 25 * t);
    }
    return img;
  }, { cssFilter: (t) => `sepia(${0.4 * t}) saturate(${1 + 0.3 * t})`, category: 'color' });

  defineFilter('cool', 'Cool Tone', 'Push toward blue', (img, t) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = clamp(d[i] - 25 * t);
      d[i+1] = clamp(d[i+1] - 8 * t);
      d[i+2] = clamp(d[i+2] + 35 * t);
    }
    return img;
  }, { cssFilter: (t) => `hue-rotate(${-15 * t}deg) saturate(${1 + 0.3 * t}) brightness(${1 - 0.05 * t})`, category: 'color' });

  defineFilter('bw_high', 'B&W Punch', 'High-contrast monochrome', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      let y = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      y = clamp((y - 128) * 1.6 + 128);
      d[i] = d[i+1] = d[i+2] = y;
    }
    return blendOriginal(img, orig, t);
  }, { cssFilter: (t) => `grayscale(${t}) contrast(${1 + 0.6 * t})`, category: 'bw' });

  defineFilter('threshold', 'Threshold', 'Binary black/white', (img, t) => {
    const cutoff = 128 - 60 * (t - 0.5) * 2; // shift cutoff with strength
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      const v = y > cutoff ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = v;
    }
    return blendOriginal(img, orig, Math.max(0.001, t));
  }, { category: 'bw' });

  defineFilter('posterize', 'Posterize', 'Reduce color levels', (img, t) => {
    const levels = Math.max(2, Math.round(8 - 6 * t));
    const step = 255 / (levels - 1);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round(d[i] / step) * step;
      d[i+1] = Math.round(d[i+1] / step) * step;
      d[i+2] = Math.round(d[i+2] / step) * step;
    }
    return img;
  }, { category: 'stylize' });

  defineFilter('solarize', 'Solarize', 'Invert above threshold', (img, t) => {
    const cutoff = 128;
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = d[i] > cutoff ? 255 - d[i] : d[i];
      d[i+1] = d[i+1] > cutoff ? 255 - d[i+1] : d[i+1];
      d[i+2] = d[i+2] > cutoff ? 255 - d[i+2] : d[i+2];
    }
    return blendOriginal(img, orig, t);
  }, { category: 'stylize' });

  defineFilter('vignette', 'Vignette', 'Darkened corners', (img, t) => {
    const { width: w, height: h, data: d } = img;
    const cx = w / 2, cy = h / 2;
    const maxD = Math.sqrt(cx * cx + cy * cy);
    const strength = 0.85 * t;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxD;
        const factor = 1 - strength * Math.pow(dist, 2.2);
        const i = (y * w + x) * 4;
        d[i]   = clamp(d[i] * factor);
        d[i+1] = clamp(d[i+1] * factor);
        d[i+2] = clamp(d[i+2] * factor);
      }
    }
    return img;
  }, { category: 'mood' });

  defineFilter('blur', 'Box Blur', 'Soft 3x3 blur', (img, t) => {
    const orig = new Uint8ClampedArray(img.data);
    convolve3x3(img, [1,1,1, 1,1,1, 1,1,1], 9);
    return blendOriginal(img, orig, t);
  }, { cssFilter: (t) => `blur(${2 * t}px)`, category: 'blur' });

  defineFilter('gaussian', 'Gaussian', 'Smoother 3x3 blur', (img, t) => {
    const orig = new Uint8ClampedArray(img.data);
    convolve3x3(img, [1,2,1, 2,4,2, 1,2,1], 16);
    return blendOriginal(img, orig, t);
  }, { cssFilter: (t) => `blur(${3 * t}px)`, category: 'blur' });

  defineFilter('sharpen', 'Sharpen', 'Edge enhancement', (img, t) => {
    const orig = new Uint8ClampedArray(img.data);
    convolve3x3(img, [0,-1,0, -1,5,-1, 0,-1,0], 1);
    return blendOriginal(img, orig, t);
  }, { category: 'blur' });

  defineFilter('edge', 'Edge Detect', 'Outline edges', (img, t) => {
    const orig = new Uint8ClampedArray(img.data);
    convolve3x3(img, [-1,-1,-1, -1,8,-1, -1,-1,-1], 1);
    return blendOriginal(img, orig, t);
  }, { category: 'stylize' });

  defineFilter('emboss', 'Emboss', '3D-relief look', (img, t) => {
    const orig = new Uint8ClampedArray(img.data);
    convolve3x3(img, [-2,-1,0, -1,1,1, 0,1,2], 1, 128);
    return blendOriginal(img, orig, t);
  }, { category: 'stylize' });

  defineFilter('pixelate', 'Pixelate', 'Mosaic blocks', (img, t) => {
    const block = Math.max(2, Math.round(2 + 24 * t));
    const { width: w, height: h, data: d } = img;
    for (let y = 0; y < h; y += block) {
      for (let x = 0; x < w; x += block) {
        let r = 0, g = 0, b = 0, n = 0;
        const xMax = Math.min(x + block, w), yMax = Math.min(y + block, h);
        for (let yy = y; yy < yMax; yy++) {
          for (let xx = x; xx < xMax; xx++) {
            const i = (yy * w + xx) * 4;
            r += d[i]; g += d[i+1]; b += d[i+2]; n++;
          }
        }
        r /= n; g /= n; b /= n;
        for (let yy = y; yy < yMax; yy++) {
          for (let xx = x; xx < xMax; xx++) {
            const i = (yy * w + xx) * 4;
            d[i] = r; d[i+1] = g; d[i+2] = b;
          }
        }
      }
    }
    return img;
  }, { category: 'distort' });

  defineFilter('noise', 'Noise', 'Add film grain', (img, t) => {
    const amt = 80 * t;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amt;
      d[i] = clamp(d[i] + n);
      d[i+1] = clamp(d[i+1] + n);
      d[i+2] = clamp(d[i+2] + n);
    }
    return img;
  }, { category: 'mood' });

  defineFilter('scanlines', 'Scanlines', 'CRT line effect', (img, t) => {
    const { width: w, height: h, data: d } = img;
    const factor = 1 - 0.5 * t;
    for (let y = 0; y < h; y++) {
      if (y % 2 === 0) continue;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        d[i] = d[i] * factor;
        d[i+1] = d[i+1] * factor;
        d[i+2] = d[i+2] * factor;
      }
    }
    return img;
  }, { category: 'mood' });

  defineFilter('duotone', 'Duotone', 'Map gray to violet/cyan', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    const dark = [40, 20, 90];   // deep violet
    const light = [80, 220, 200]; // cyan
    for (let i = 0; i < d.length; i += 4) {
      const y = (0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]) / 255;
      d[i]   = lerp(dark[0], light[0], y);
      d[i+1] = lerp(dark[1], light[1], y);
      d[i+2] = lerp(dark[2], light[2], y);
    }
    return blendOriginal(img, orig, t);
  }, { category: 'stylize' });

  defineFilter('vintage_film', 'Vintage Film', 'Sepia + grain + vignette', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    const { width: w, height: h } = img;
    const cx = w / 2, cy = h / 2, maxD = Math.sqrt(cx*cx + cy*cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = d[i], g = d[i+1], b = d[i+2];
        let nr = 0.393*r + 0.769*g + 0.189*b;
        let ng = 0.349*r + 0.686*g + 0.168*b;
        let nb = 0.272*r + 0.534*g + 0.131*b;
        const grain = (Math.random() - 0.5) * 30;
        nr += grain; ng += grain; nb += grain;
        const dx = x - cx, dy = y - cy;
        const vf = 1 - 0.6 * Math.pow(Math.sqrt(dx*dx+dy*dy)/maxD, 2.2);
        d[i]   = clamp(nr * vf);
        d[i+1] = clamp(ng * vf);
        d[i+2] = clamp(nb * vf);
      }
    }
    return blendOriginal(img, orig, t);
  }, { category: 'mood' });

  defineFilter('cyberpunk', 'Cyberpunk', 'Neon magenta/cyan grade', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      const y = 0.299*r + 0.587*g + 0.114*b;
      // shadows -> teal, highlights -> magenta
      const tBlend = y / 255;
      const nr = lerp(20 + r*0.4, 230 + (r-128)*0.6, tBlend);
      const ng = lerp(80 + g*0.5, 60 + g*0.5, tBlend);
      const nb = lerp(120 + b*0.6, 220 + (b-128)*0.5, tBlend);
      d[i]   = clamp(nr);
      d[i+1] = clamp(ng);
      d[i+2] = clamp(nb);
    }
    return blendOriginal(img, orig, t);
  }, { category: 'mood' });

  defineFilter('rgb_shift', 'RGB Shift', 'Chromatic aberration', (img, t) => {
    const { width: w, height: h, data: d } = img;
    const out = new Uint8ClampedArray(d);
    const shift = Math.round(8 * t);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const rx = Math.min(w - 1, Math.max(0, x - shift));
        const bx = Math.min(w - 1, Math.max(0, x + shift));
        out[i]     = d[(y * w + rx) * 4];
        out[i + 1] = d[i + 1];
        out[i + 2] = d[(y * w + bx) * 4 + 2];
        out[i + 3] = d[i + 3];
      }
    }
    d.set(out);
    return img;
  }, { category: 'distort' });

  defineFilter('polaroid', 'Polaroid', 'Faded instant-cam look', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i+1], b = d[i+2];
      r = r * 1.05 + 10;
      g = g * 0.95 + 5;
      b = b * 0.85 + 25; // lifted blacks tinted blue
      // crush highlights slightly
      r = r > 235 ? 235 + (r - 235) * 0.3 : r;
      g = g > 235 ? 235 + (g - 235) * 0.3 : g;
      b = b > 235 ? 235 + (b - 235) * 0.3 : b;
      d[i]   = clamp(r);
      d[i+1] = clamp(g);
      d[i+2] = clamp(b);
    }
    return blendOriginal(img, orig, t);
  }, { category: 'mood' });

  defineFilter('heatmap', 'Heat Map', 'False-color thermal', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      const y = (0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]) / 255;
      // map [0,1] over black -> blue -> red -> yellow -> white
      let r, g, b;
      if (y < 0.25)      { const k = y / 0.25;      r = 0;            g = 0;            b = 128 + 127*k; }
      else if (y < 0.5)  { const k = (y-0.25)/0.25; r = 255*k;        g = 0;            b = 255 - 255*k; }
      else if (y < 0.75) { const k = (y-0.5)/0.25;  r = 255;          g = 255*k;        b = 0; }
      else               { const k = (y-0.75)/0.25; r = 255;          g = 255;          b = 255*k; }
      d[i] = r; d[i+1] = g; d[i+2] = b;
    }
    return blendOriginal(img, orig, t);
  }, { category: 'stylize' });

  defineFilter('mirror_x', 'Mirror X', 'Horizontal kaleidoscope', (img, t) => {
    const { width: w, height: h, data: d } = img;
    const orig = new Uint8ClampedArray(d);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x < w / 2 ? x : (w - 1 - x);
        const i = (y * w + x) * 4;
        const j = (y * w + sx) * 4;
        d[i]   = lerp(orig[i], orig[j], t);
        d[i+1] = lerp(orig[i+1], orig[j+1], t);
        d[i+2] = lerp(orig[i+2], orig[j+2], t);
      }
    }
    return img;
  }, { category: 'distort' });

  defineFilter('night_vision', 'Night Vision', 'Green-tinted intensifier', (img, t) => {
    const d = img.data, orig = new Uint8ClampedArray(d);
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      const boosted = clamp((y - 80) * 1.6 + 80);
      d[i]   = boosted * 0.15;
      d[i+1] = boosted;
      d[i+2] = boosted * 0.15;
    }
    return blendOriginal(img, orig, t);
  }, { category: 'mood' });

  defineFilter('comic', 'Comic', 'Posterize + edge overlay', (img, t) => {
    const orig = new Uint8ClampedArray(img.data);
    // posterize step
    const step = 255 / 4;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round(d[i] / step) * step;
      d[i+1] = Math.round(d[i+1] / step) * step;
      d[i+2] = Math.round(d[i+2] / step) * step;
    }
    // edge pass on a copy, then darken posterized image where edges are strong
    const edgeImg = new ImageData(new Uint8ClampedArray(orig), img.width, img.height);
    convolve3x3(edgeImg, [-1,-1,-1, -1,8,-1, -1,-1,-1], 1);
    const ed = edgeImg.data;
    for (let i = 0; i < d.length; i += 4) {
      const e = (ed[i] + ed[i+1] + ed[i+2]) / 3;
      if (e > 60) {
        d[i] = d[i+1] = d[i+2] = 0;
      }
    }
    return blendOriginal(img, orig, t);
  }, { category: 'stylize' });

  // Public API
  window.VFSFilters = {
    list: () => Object.values(FILTERS),
    get: (id) => FILTERS[id],
    apply: (id, imageData, strength01) => {
      const f = FILTERS[id];
      if (!f) return imageData;
      return f.apply(imageData, Math.max(0, Math.min(1, strength01)));
    },
  };
})();
