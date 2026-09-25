/**
 * Rebuild every NUTrace logo asset from the official artwork.
 *
 *   node scripts/generate-logo.js
 *
 * Source:  assets/images/logo-source.png   (896x752, flat navy / white / gold)
 * Outputs: the paths app.json already points at —
 *   icon.png                    app icon (iOS + fallback)
 *   android-icon-foreground.png adaptive foreground (mark only, transparent)
 *   android-icon-background.png adaptive background (flat navy)
 *   android-icon-monochrome.png themed-icon silhouette (white on transparent)
 *   splash-icon.png             rounded tile for the splash screen
 *   favicon.png                 web favicon
 *
 * The artwork is re-coloured to the app's own tokens while it is copied:
 *   navy  -> colors.navy900 (#0C134F)
 *   gold  -> colors.gold500 (#FDB833)
 *   paper -> #FFFFFF
 * so the icon, the splash and the in-app brand mark (components/brand-logo.tsx)
 * all use the same navy + gold as the rest of the UI.
 *
 * No dependencies: a small PNG decoder/encoder on top of Node's `zlib`.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IMAGES = path.join(__dirname, '..', 'assets', 'images');
const SOURCE = path.join(IMAGES, 'logo-source.png');

// ---- design tokens (mirror of lib/theme.ts) --------------------------------
const NAVY = '#0C134F'; // colors.navy900
const GOLD = '#FDB833'; // colors.gold500
const PAPER = '#FFFFFF';

/** How much of a tile the mark fills. */
const ICON_MARK = 0.8; // app icon / splash / favicon
const ADAPTIVE_MARK = 0.6; // inside Android's 66% adaptive safe zone
const SPLASH_RADIUS = 0.22; // rounded-corner tile, as a fraction of the tile

// ---- PNG -------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
};

const encodePng = (width, height, rgba) => {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/** Decode an 8-bit non-interlaced PNG (colour types 0/2/3/4/6) to RGBA. */
function decodePng(file) {
  const buf = fs.readFileSync(file);
  let off = 8;
  const idat = [];
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let palette = null;
  let transparent = null;

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('ascii');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported');
      if (depth !== 8) throw new Error(`Only 8-bit PNGs are supported (got ${depth})`);
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparent = data;
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      pixels[y * stride + x] = v & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    let r;
    let g;
    let b;
    let alpha = 255;
    if (colorType === 3) {
      const index = pixels[p];
      r = palette[index * 3];
      g = palette[index * 3 + 1];
      b = palette[index * 3 + 2];
      if (transparent && transparent.length > index) alpha = transparent[index];
    } else if (colorType === 0 || colorType === 4) {
      r = g = b = pixels[p];
      if (colorType === 4) alpha = pixels[p + 1];
    } else {
      r = pixels[p];
      g = pixels[p + 1];
      b = pixels[p + 2];
      if (colorType === 6) alpha = pixels[p + 3];
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = alpha;
  }

  return { width, height, rgba };
}

// ---- colour ----------------------------------------------------------------
const parseHex = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const NAVY_RGB = parseHex(NAVY);
const GOLD_RGB = parseHex(GOLD);
const PAPER_RGB = parseHex(PAPER);

/** Hue in degrees, plus the chroma (colourfulness) and lightness, all 0..1. */
function toHsl([r, g, b]) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const chroma = max - min;
  const l = (max + min) / 2;
  if (chroma === 0) return { h: 0, chroma, l };
  let h;
  if (max === rr) h = ((gg - bb) / chroma + (gg < bb ? 6 : 0)) * 60;
  else if (max === gg) h = ((bb - rr) / chroma + 2) * 60;
  else h = ((rr - gg) / chroma + 4) * 60;
  return { h, chroma, l };
}

/**
 * Which of the three brand colours a source pixel is.
 *
 * Neither a nearest-RGB test nor the HSL saturation works here: a grey edge sits
 * numerically closer to the yellow than to the white, and HSL saturation
 * explodes on very light pixels (the artwork's white carries a faint warm tint,
 * which HSL reports as ~0.9 saturation and would sprinkle the white A with
 * gold speckles). Raw chroma is the honest measure — 0.9 for the real gold,
 * 0.05 for a warm white — so that is what this uses.
 */
function classify([r, g, b]) {
  const { h, chroma, l } = toHsl([r, g, b]);
  if (chroma > 0.25) return h > 120 && h < 300 ? 'navy' : 'gold';
  return l < 0.5 ? 'navy' : 'paper';
}

/**
 * A tiny box blur runs first: the source artwork's diagonal edges are dithered
 * (scattered alternating pixels rather than a clean anti-aliased ramp), and a
 * per-pixel colour test would turn that dither into a dotted edge.
 *
 * Then every pixel is mapped onto the app palette and the navy background is
 * dropped to transparent, so what is left is the mark itself (white + gold),
 * ready to sit on a freshly painted navy tile.
 *
 * The mark keeps its own anti-aliasing: an edge pixel's *transparency* is
 * derived from how far it has moved away from navy, so a soft navy-to-white
 * edge stays a soft edge when it is composited onto the new navy tile.
 */
function recolour({ width, height, rgba }) {
  const mark = Buffer.alloc(width * height * 4);
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const blurred = boxBlur(rgba, width, height, 1);

  for (let i = 0; i < width * height; i++) {
    const src = [blurred[i * 4], blurred[i * 4 + 1], blurred[i * 4 + 2]];
    const sourceAlpha = rgba[i * 4 + 3] / 255;
    const { l } = toHsl(src);
    const kind = classify(src);
    const target = kind === 'navy' ? NAVY_RGB : kind === 'gold' ? GOLD_RGB : PAPER_RGB;

    // Navy *is* the background, so it leaves nothing behind; white and gold are
    // opaque once they are bright enough to be the colour itself.
    const coverage =
      kind === 'navy' ? 0 : kind === 'gold' ? clamp01((l - 0.16) / 0.3) : clamp01((l - 0.3) / 0.6);

    for (let c = 0; c < 3; c++) mark[i * 4 + c] = target[c];
    mark[i * 4 + 3] = Math.round(coverage * sourceAlpha * 255);
  }
  return mark;
}


/** Separable box blur — kills the source's dithered edges. */
function boxBlur(rgba, width, height, radius) {
  const pass = (input, horizontal) => {
    const out = Buffer.alloc(input.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const acc = [0, 0, 0, 0];
        let count = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? x + k : x;
          const sy = horizontal ? y : y + k;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
          const i = (sy * width + sx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += input[i + c];
          count++;
        }
        const o = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / count);
      }
    }
    return out;
  };
  // Skip pixels that are already flat — the blur only needs to touch the edges.
  return pass(pass(rgba, true), false);
}

/** Bounding box of everything that isn't background in the mark buffer. */
function markBounds(mark, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mark[(y * width + x) * 4 + 3] < 24) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) throw new Error('The source logo looks empty — check assets/images/logo-source.png');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Bilinear resample of a sub-rectangle of `src` into a `dw x dh` buffer. */
function resample(src, sw, sh, rect, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const scaleX = rect.width / dw;
  const scaleY = rect.height / dh;
  for (let y = 0; y < dh; y++) {
    const sy = rect.top + (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
    const y1 = Math.max(0, Math.min(sh - 1, y0 + 1));
    const wy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < dw; x++) {
      const sx = rect.left + (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const x1 = Math.max(0, Math.min(sw - 1, x0 + 1));
      const wx = Math.max(0, Math.min(1, sx - x0));
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - wx) + src[i10 + c] * wx;
        const bottom = src[i01 + c] * (1 - wx) + src[i11 + c] * wx;
        out[o + c] = Math.round(top * (1 - wy) + bottom * wy);
      }
    }
  }
  return out;
}

/** Area-average downscale — the right tool for the 48px favicon. */
function downscale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      const acc = [0, 0, 0, 0];
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += src[i + c];
          count++;
        }
      }
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(acc[c] / count);
    }
  }
  return out;
}

/** Source-over composite of a `dw x dh` layer onto a `dw x dh` base. */
function over(base, layer, size) {
  for (let i = 0; i < size * size; i++) {
    const a = layer[i * 4 + 3] / 255;
    if (a <= 0) continue;
    const dstA = base[i * 4 + 3] / 255;
    const outA = a + dstA * (1 - a);
    for (let c = 0; c < 3; c++) {
      base[i * 4 + c] = Math.round(
        (layer[i * 4 + c] * a + base[i * 4 + c] * dstA * (1 - a)) / outA,
      );
    }
    base[i * 4 + 3] = Math.round(outA * 255);
  }
  return base;
}

const solid = (size, [r, g, b], alpha = 255) => {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = alpha;
  }
  return out;
};

/** Punch a rounded-rectangle mask out of a tile (transparent outside). */
function roundCorners(tile, size, radius) {
  const half = size / 2;
  const r = radius * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x + 0.5 - half);
      const dy = Math.abs(y + 0.5 - half);
      if (dx <= half - r || dy <= half - r) continue; // straight part of the side
      const cx = dx - (half - r);
      const cy = dy - (half - r);
      if (cx * cx + cy * cy > r * r) tile[(y * size + x) * 4 + 3] = 0;
    }
  }
  return tile;
}

/** A white silhouette of the mark — Android's themed (monochrome) icon. */
function silhouetted(layer, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const a = layer[i * 4 + 3];
    if (a === 0) continue;
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = a;
  }
  return out;
}

// ---- build -----------------------------------------------------------------
const write = (name, buffer) => {
  fs.writeFileSync(path.join(IMAGES, name), buffer);
  console.log(`  \u2713 ${name}  (${(buffer.length / 1024).toFixed(1)} kB)`);
};

/**
 * A square tile with the mark centred inside it.
 *
 * `fraction` is how much of the tile the mark fills; `base` lets the caller use
 * a transparent tile (for the adaptive foreground) instead of navy.
 */
function tile(size, fraction, base) {
  const side = Math.round(size * fraction);
  const pad = Math.round((size - side) / 2);
  const scaled = resample(mark, source.width, source.height, bounds, side, side);
  const layer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < side; y++) {
    scaled.copy(layer, ((y + pad) * size + pad) * 4, y * side * 4, (y + 1) * side * 4);
  }
  return over(base, layer, size);
}

const source = decodePng(SOURCE);
const mark = recolour(source);
const bounds = markBounds(mark, source.width, source.height);

const ICON = 1024;

console.log(`\nNUTrace logo \u2192 ${IMAGES}`);
console.log(
  `  source ${source.width}x${source.height}, mark box ${bounds.width}x${bounds.height}` +
    ` \u2014 navy ${NAVY}, gold ${GOLD}, on ${PAPER}`,
);

// App icon: a full-bleed navy tile (each OS applies its own corner mask).
write('icon.png', encodePng(ICON, ICON, tile(ICON, ICON_MARK, solid(ICON, NAVY_RGB))));

// Adaptive icon layers: flat navy behind, the mark alone in front.
write('android-icon-background.png', encodePng(ICON, ICON, solid(ICON, NAVY_RGB)));
const foreground = tile(ICON, ADAPTIVE_MARK, Buffer.alloc(ICON * ICON * 4));
write('android-icon-foreground.png', encodePng(ICON, ICON, foreground));
write('android-icon-monochrome.png', encodePng(ICON, ICON, silhouetted(foreground, ICON)));

// Splash: rounded corners, because it sits on a plain white background.
write(
  'splash-icon.png',
  encodePng(ICON, ICON, roundCorners(tile(ICON, ICON_MARK, solid(ICON, NAVY_RGB)), ICON, SPLASH_RADIUS)),
);

// Favicon: render bigger, then box-downscale (crisper than resampling the source).
const faviconBase = roundCorners(tile(256, ICON_MARK, solid(256, NAVY_RGB)), 256, SPLASH_RADIUS);
write('favicon.png', encodePng(48, 48, downscale(faviconBase, 256, 256, 48, 48)));

/**
 * A self-contained page (images inlined as data URIs) so the icon set can be
 * eyeballed without running a build: open `scripts/logo-preview.html`, or ask
 * the assistant to show it in the Preview tab.
 */
function writePreview() {
  const dataUri = (name) =>
    `data:image/png;base64,${fs.readFileSync(path.join(IMAGES, name)).toString('base64')}`;
  const card = (name, width, extra = '') =>
    `<div class="card"><img src="${dataUri(name)}" width="${width}"${extra}></div>`;

  // A real 200px render, box-downscaled from the icon — this is what a launcher
  // shows, and it is the honest way to judge the artwork (browsers rescale a
  // 1024px image very differently).
  const preview200 = downscale(tile(ICON, ICON_MARK, solid(ICON, NAVY_RGB)), ICON, ICON, 200, 200);
  const preview200Uri = `data:image/png;base64,${encodePng(200, 200, preview200).toString('base64')}`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>NUTrace logo</title><style>
body{font-family:system-ui,sans-serif;background:#eef2f7;margin:0;padding:24px;color:#0C134F}
h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-top:28px}
.row{display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap}
.card{background:#fff;border-radius:16px;padding:14px;box-shadow:0 6px 18px rgba(15,23,42,.08)}
.card img{display:block}
</style></head><body>
<h2>icon.png downscaled to 200px \u2014 no browser rescaling</h2>
<div class="row">
<div class="card"><img src="${preview200Uri}" width="200" height="200" style="border-radius:48px"></div>
</div>
<h2>icon.png \u2014 launcher sizes</h2>
<div class="row">
${card('icon.png', 200, ' style="border-radius:48px"')}
${card('icon.png', 96, ' style="border-radius:23px"')}
${card('icon.png', 56, ' style="border-radius:14px"')}
${card('icon.png', 34, ' style="border-radius:9px"')}
${card('favicon.png', 48, ' style="border-radius:11px"')}
</div>
<h2>android adaptive layers</h2>
<div class="row">
<div class="card" style="padding:0;border-radius:24px;overflow:hidden"><div style="position:relative;width:180px;height:180px">
<img src="${dataUri('android-icon-background.png')}" width="180" height="180" style="position:absolute">
<img src="${dataUri('android-icon-foreground.png')}" width="180" height="180" style="position:absolute">
</div></div>
<div class="card" style="padding:0;border-radius:24px;overflow:hidden"><div style="position:relative;width:180px;height:180px">
<img src="${dataUri('android-icon-background.png')}" width="180" height="180" style="position:absolute">
<img src="${dataUri('android-icon-foreground.png')}" width="180" height="180" style="position:absolute">
<div style="position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 90px rgba(244,247,251,.78)"></div>
</div></div>
<div class="card" style="background:#0C134F"><img src="${dataUri('android-icon-monochrome.png')}" width="120" height="120"></div>
<div class="card" style="background:#FDB833"><img src="${dataUri('android-icon-monochrome.png')}" width="120" height="120"></div>
${card('splash-icon.png', 120, ' style="border-radius:26px"')}
</div>
</body></html>`;

  fs.writeFileSync(path.join(__dirname, 'logo-preview.html'), html);
  console.log('  \u2713 logo-preview.html  (open it to eyeball the icons)');
}

writePreview();
