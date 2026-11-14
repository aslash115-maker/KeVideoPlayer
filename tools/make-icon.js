// Build build/icon.ico from build/icon.png.
//
// electron-builder can derive an .ico itself, but doing it here means the
// multi-size layers are generated with lanczos from the 256px master and are
// checked in, so the packaged icon is reproducible and reviewable.
//
// ICO is a simple container: a 6-byte header, one 16-byte directory entry per
// image, then the payloads. Each payload here is a complete PNG (allowed since
// Vista), which keeps the alpha channel intact — the older BMP/DIB form would
// need a separate AND mask.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ffmpegPath = require('ffmpeg-static');

const SRC = path.join('build', 'icon.png');
const OUT = path.join('build', 'icon.ico');
// Sizes Windows actually asks for: tray/menu, small/large shell icons, and the
// 256 entry used by the extra-large view and by electron-builder's installers.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

if (!fs.existsSync(SRC)) {
  console.error(`missing ${SRC}`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-ico-'));
const images = [];

for (const size of SIZES) {
  const out = path.join(tmp, `${size}.png`);
  // Downscaling from the 256 master; lanczos keeps the circular edge crisp.
  // No cas here: at 16-32px extra sharpening just produces ringing.
  const r = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-i', SRC,
    '-vf', `scale=w=${size}:h=${size}:flags=lanczos,format=rgba`,
    '-frames:v', '1', '-y', out,
  ]);
  if (r.status !== 0) {
    console.error(`scale to ${size} failed:\n${r.stderr}`);
    process.exit(1);
  }
  images.push({ size, data: fs.readFileSync(out) });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);              // reserved
header.writeUInt16LE(1, 2);              // type 1 = icon
header.writeUInt16LE(images.length, 4);  // image count

const dir = Buffer.alloc(16 * images.length);
// Payloads start after the header and the full directory.
let offset = 6 + 16 * images.length;

images.forEach((img, i) => {
  const b = i * 16;
  // 256 is encoded as 0 in the single-byte width/height fields.
  dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 0);
  dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 1);
  dir.writeUInt8(0, b + 2);               // palette colours (0 = truecolour)
  dir.writeUInt8(0, b + 3);               // reserved
  dir.writeUInt16LE(1, b + 4);            // colour planes
  dir.writeUInt16LE(32, b + 6);           // bits per pixel
  dir.writeUInt32LE(img.data.length, b + 8);
  dir.writeUInt32LE(offset, b + 12);
  offset += img.data.length;
});

fs.writeFileSync(OUT, Buffer.concat([header, dir, ...images.map((i) => i.data)]));
fs.rmSync(tmp, { recursive: true, force: true });

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`wrote ${OUT} (${kb} KB) with sizes: ${SIZES.join(', ')}`);
