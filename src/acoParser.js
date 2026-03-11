"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Buffer helper — Node's fs.readFileSync returns a Buffer whose .buffer is a
// SHARED pool with a non-zero byteOffset. Always copy into a fresh ArrayBuffer
// before wrapping in DataView, otherwise reads are offset garbage.
// ─────────────────────────────────────────────────────────────────────────────
function toArrayBuffer(buf) {
  return new Uint8Array(buf).buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACO Parser  (Adobe Color — Photoshop)
// ─────────────────────────────────────────────────────────────────────────────
function parseACO(buffer) {
  const ab   = toArrayBuffer(buffer);
  const view = new DataView(ab);
  let offset = 0;

  function readUint16() {
    const v = view.getUint16(offset, false); offset += 2; return v;
  }

  function readBlock() {
    if (offset + 4 > ab.byteLength) return null;
    const version = readUint16();
    if (version !== 1 && version !== 2) { offset -= 2; return null; }
    const count = readUint16();
    console.log(`[ACO] V${version} block — ${count} colors`);
    const colors = [];

    for (let i = 0; i < count; i++) {
      if (offset + 10 > ab.byteLength) break;
      const colorSpace = readUint16();
      const w = readUint16(), x = readUint16(), y = readUint16(), z = readUint16();
      const rgb = colorSpaceToRgb(colorSpace, w, x, y, z);

      let name = null;
      if (version === 2) {
        readUint16(); // reserved
        const nameLen = readUint16();
        let n = "";
        for (let c = 0; c < nameLen - 1; c++) n += String.fromCharCode(readUint16());
        readUint16(); // null terminator
        name = n || null;
      }
      colors.push({ rgb, name });
    }
    return { version, colors };
  }

  const block1 = readBlock();
  if (!block1) {
    console.error("[ACO] Failed to read first block — not a valid ACO file");
    return [];
  }
  let colors = block1.colors;

  // V1 may be followed by a V2 block that contains names
  if (block1.version === 1 && offset < ab.byteLength - 4) {
    const saved = offset;
    try {
      const block2 = readBlock();
      if (block2 && block2.version === 2) {
        block2.colors.forEach((c, i) => {
          if (i < colors.length && c.name) colors[i].name = c.name;
        });
      } else {
        offset = saved;
      }
    } catch (e) {
      console.warn("[ACO] V2 block read failed (non-fatal):", e.message);
      offset = saved;
    }
  }

  return colors.map((c, i) => ({ ...c, name: c.name || `Color ${i + 1}` }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ASE Parser  (Adobe Swatch Exchange — Illustrator / InDesign / web tools)
// ─────────────────────────────────────────────────────────────────────────────
function parseASE(buffer) {
  const ab   = toArrayBuffer(buffer);
  const view = new DataView(ab);
  let offset = 0;

  function readUint16()  { const v = view.getUint16(offset,  false); offset += 2; return v; }
  function readUint32()  { const v = view.getUint32(offset,  false); offset += 4; return v; }
  function readFloat32() { const v = view.getFloat32(offset, false); offset += 4; return v; }

  function readAscii(n) {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(offset++));
    return s;
  }

  function readUtf16(len) {
    // len = char count INCLUDING null terminator
    let s = "";
    for (let i = 0; i < len; i++) {
      const code = view.getUint16(offset, false); offset += 2;
      if (code !== 0) s += String.fromCharCode(code);
    }
    return s;
  }

  if (ab.byteLength < 12) throw new Error("File too small to be a valid ASE file");

  const magic = readAscii(4);
  console.log(`[ASE] magic="${magic}" fileSize=${ab.byteLength}`);
  if (magic !== "ASEF") throw new Error(`Not a valid ASE file — magic bytes are "${magic}", expected "ASEF"`);

  const vMajor     = readUint16();
  const vMinor     = readUint16();
  const blockCount = readUint32();
  console.log(`[ASE] version=${vMajor}.${vMinor} blockCount=${blockCount}`);

  const colors     = [];
  let currentGroup = null;
  let autoIndex    = 1;

  for (let b = 0; b < blockCount && offset < ab.byteLength - 6; b++) {
    const blockType   = readUint16();
    const blockLength = readUint32();
    const blockEnd    = offset + blockLength;

    console.log(`[ASE] block ${b}: type=0x${blockType.toString(16).padStart(4,"0")} length=${blockLength}`);

    if (blockType === 0xC001) {
      // Group start
      const nameLen = readUint16();
      currentGroup  = nameLen > 0 ? readUtf16(nameLen) : null;
      console.log(`[ASE]   group start: "${currentGroup}"`);

    } else if (blockType === 0xC002) {
      // Group end
      console.log(`[ASE]   group end`);
      currentGroup = null;

    } else if (blockType === 0x0001) {
      // Color entry
      const nameLen = readUint16();
      const rawName = nameLen > 0 ? readUtf16(nameLen) : null;
      const name    = rawName || (currentGroup ? `${currentGroup} ${autoIndex++}` : `Color ${autoIndex++}`);
      const model   = readAscii(4);
      console.log(`[ASE]   color: "${name}" model="${model}"`);

      let rgb = { r: 0, g: 0, b: 0 };

      if (model === "RGB ") {
        const r = readFloat32(), g = readFloat32(), bv = readFloat32();
        rgb = {
          r: Math.round(Math.min(255, Math.max(0, r  * 255))),
          g: Math.round(Math.min(255, Math.max(0, g  * 255))),
          b: Math.round(Math.min(255, Math.max(0, bv * 255))),
        };
      } else if (model === "CMYK") {
        const c = readFloat32(), m = readFloat32(), y = readFloat32(), k = readFloat32();
        rgb = cmykToRgb(c, m, y, k);
      } else if (model === "LAB ") {
        const L  = readFloat32() * 100;
        const a  = readFloat32() * 128;
        const bv = readFloat32() * 128;
        rgb = labToRgb(L, a, bv);
      } else if (model === "Gray") {
        const gray = Math.round(readFloat32() * 255);
        rgb = { r: gray, g: gray, b: gray };
      } else {
        console.warn(`[ASE]   unknown color model "${model}" — skipping channels`);
      }

      console.log(`[ASE]   → rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);

      const colorType = offset + 2 <= blockEnd ? readUint16() : 0;
      colors.push({ rgb, name, group: currentGroup, colorType });

    } else {
      console.log(`[ASE]   unknown block type 0x${blockType.toString(16)} — skipping`);
    }

    offset = blockEnd;
  }

  console.log(`[ASE] parsed ${colors.length} colors`);
  return colors.map((c, i) => ({ ...c, name: c.name || `Color ${i + 1}` }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared color space converters
// ─────────────────────────────────────────────────────────────────────────────

function colorSpaceToRgb(colorSpace, w, x, y, z) {
  switch (colorSpace) {
    case 0:
      return { r: Math.round((w/65535)*255), g: Math.round((x/65535)*255), b: Math.round((y/65535)*255) };
    case 1:
      return hsvToRgb(w/100, x/10000, y/10000);
    case 2:
      return cmykToRgb(1-w/65535, 1-x/65535, 1-y/65535, 1-z/65535);
    case 7:
      return labToRgb(w/100, readSigned(x)/100, readSigned(y)/100);
    case 8: {
      const g = Math.round((w/10000)*255);
      return { r: g, g: g, b: g };
    }
    default:
      console.warn(`[ACO] unknown color space ${colorSpace}`);
      return { r: 0, g: 0, b: 0 };
  }
}

function readSigned(u) { return u > 32767 ? u - 65536 : u; }

function hsvToRgb(h, s, v) {
  if (s === 0) { const g = Math.round(v*255); return { r:g, g:g, b:g }; }
  const i = Math.floor(h/60) % 6;
  const f = (h/60) - Math.floor(h/60);
  const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
  const vals = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i];
  return { r: Math.round(vals[0]*255), g: Math.round(vals[1]*255), b: Math.round(vals[2]*255) };
}

function cmykToRgb(c, m, y, k) {
  return {
    r: Math.round(255*(1-c)*(1-k)),
    g: Math.round(255*(1-m)*(1-k)),
    b: Math.round(255*(1-y)*(1-k)),
  };
}

function labToRgb(L, a, b) {
  let y = (L+16)/116, x = a/500+y, z = y-b/200;
  x = (x**3 > 0.008856 ? x**3 : (x-16/116)/7.787) * 0.95047;
  y = (y**3 > 0.008856 ? y**3 : (y-16/116)/7.787) * 1.00000;
  z = (z**3 > 0.008856 ? z**3 : (z-16/116)/7.787) * 1.08883;
  let r =  x*3.2406  + y*-1.5372 + z*-0.4986;
  let g =  x*-0.9689 + y*1.8758  + z*0.0415;
  let bv = x*0.0557  + y*-0.2040 + z*1.0570;
  const gamma = v => v > 0.0031308 ? 1.055*v**(1/2.4)-0.055 : 12.92*v;
  return {
    r: Math.round(Math.min(255, Math.max(0, gamma(r) *255))),
    g: Math.round(Math.min(255, Math.max(0, gamma(g) *255))),
    b: Math.round(Math.min(255, Math.max(0, gamma(bv)*255))),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived format generators
// ─────────────────────────────────────────────────────────────────────────────

function toHex({ r, g, b }) {
  return "#" + [r,g,b].map(v => v.toString(16).padStart(2,"0")).join("").toUpperCase();
}

function toRgbString({ r, g, b }) { return `rgb(${r}, ${g}, ${b})`; }

function toHsl({ r, g, b }) {
  const rn=r/255, gn=g/255, bn=b/255;
  const max=Math.max(rn,gn,bn), min=Math.min(rn,gn,bn);
  const l=(max+min)/2;
  if (max===min) return { h:0, s:0, l:Math.round(l*100) };
  const d=max-min;
  const s=l>0.5 ? d/(2-max-min) : d/(max+min);
  let h;
  switch (max) {
    case rn: h=((gn-bn)/d+(gn<bn?6:0))/6; break;
    case gn: h=((bn-rn)/d+2)/6; break;
    default: h=((rn-gn)/d+4)/6;
  }
  return { h:Math.round(h*360), s:Math.round(s*100), l:Math.round(l*100) };
}

function toHslString(rgb) {
  const { h, s, l } = toHsl(rgb);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function toCssFilter({ r, g, b }, alpha = 1) {
  const { h, s, l } = toHsl({ r, g, b });
  const invert   = Math.round(l * 80);
  const saturate = Math.round(s * 7.5);
  const bright   = Math.round(l * 1.8 * 100);
  const contrast = s > 50 ? 110 : 100;
  const base = `brightness(0) saturate(100%) invert(${invert}%) sepia(100%) saturate(${saturate}%) hue-rotate(${h}deg) brightness(${bright}%) contrast(${contrast}%)`;
  return alpha < 1 ? `${base} opacity(${Math.round(alpha * 100)}%)` : base;
}

function toHexAlpha(rgb, alpha) {
  const hex = toHex(rgb);
  const ah = Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase();
  return `${hex}${ah}`;
}

function toHslaString(rgb, alpha) {
  const { h, s, l } = toHsl(rgb);
  return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "color";
}

function enrichColor(color, index) {
  const { rgb, name, group = null, colorType = null } = color;
  const alpha = typeof color.alpha === "number" ? Math.min(1, Math.max(0, color.alpha)) : 1;
  const hex = toHex(rgb);
  const hasAlpha = alpha < 1;
  return {
    index, name, group, colorType,
    slug: slugify(name),
    hex,
    rgb: toRgbString(rgb),
    rgba: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`,
    hsl: toHslString(rgb),
    hexa: hasAlpha ? toHexAlpha(rgb, alpha) : null,
    hsla: hasAlpha ? toHslaString(rgb, alpha) : null,
    cssFilter: toCssFilter(rgb, alpha),
    rawRgb: rgb,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACO Writer  (Adobe Color — Photoshop, version 2)
// ─────────────────────────────────────────────────────────────────────────────
function writeACO(colors) {
  // Calculate total buffer size
  // Header: 2 (version) + 2 (count)
  // Per color: 2 (colorSpace) + 4*2 (channels) + 2 (reserved) + 2 (nameLen) + name*2 + 2 (null)
  let size = 4; // version + count
  for (const c of colors) {
    const name = c.name || "Color";
    size += 10; // colorSpace(2) + channels(8)
    size += 2;  // reserved
    size += 2;  // name length
    size += name.length * 2; // UTF-16BE chars
    size += 2;  // null terminator
  }

  const buf = Buffer.alloc(size);
  let offset = 0;

  function writeUint16(v) { buf.writeUInt16BE(v, offset); offset += 2; }

  writeUint16(2); // version 2
  writeUint16(colors.length);

  for (const c of colors) {
    const rgb = c.rawRgb || { r: 0, g: 0, b: 0 };
    const name = c.name || "Color";

    writeUint16(0); // colorSpace = RGB
    writeUint16(Math.round((rgb.r / 255) * 65535));
    writeUint16(Math.round((rgb.g / 255) * 65535));
    writeUint16(Math.round((rgb.b / 255) * 65535));
    writeUint16(0); // fourth channel unused for RGB

    writeUint16(0); // reserved
    writeUint16(name.length + 1); // name length including null terminator
    for (let i = 0; i < name.length; i++) {
      writeUint16(name.charCodeAt(i));
    }
    writeUint16(0); // null terminator
  }

  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASE Writer  (Adobe Swatch Exchange)
// ─────────────────────────────────────────────────────────────────────────────
function writeASE(colors) {
  // Header: 4 (magic) + 2 (major) + 2 (minor) + 4 (blockCount) = 12
  // Per color block: 2 (blockType) + 4 (blockLength)
  //   block content: 2 (nameLen) + name*2 + 2 (null) + 4 (model) + 3*4 (floats) + 2 (colorType)
  let size = 12;
  for (const c of colors) {
    const name = c.name || "Color";
    const blockContent = 2 + (name.length + 1) * 2 + 4 + 12 + 2;
    size += 6 + blockContent; // blockType(2) + blockLength(4) + content
  }

  const buf = Buffer.alloc(size);
  let offset = 0;

  function writeAscii(s) { for (let i = 0; i < s.length; i++) { buf[offset++] = s.charCodeAt(i); } }
  function writeUint16(v) { buf.writeUInt16BE(v, offset); offset += 2; }
  function writeUint32(v) { buf.writeUInt32BE(v, offset); offset += 4; }
  function writeFloat32(v) { buf.writeFloatBE(v, offset); offset += 4; }

  writeAscii("ASEF");
  writeUint16(1); // major version
  writeUint16(0); // minor version
  writeUint32(colors.length); // block count

  for (const c of colors) {
    const rgb = c.rawRgb || { r: 0, g: 0, b: 0 };
    const name = c.name || "Color";
    const nameChars = name.length + 1; // including null terminator
    const blockLength = 2 + nameChars * 2 + 4 + 12 + 2;

    writeUint16(0x0001); // color entry block type
    writeUint32(blockLength);
    writeUint16(nameChars);
    for (let i = 0; i < name.length; i++) {
      writeUint16(name.charCodeAt(i));
    }
    writeUint16(0); // null terminator
    writeAscii("RGB ");
    writeFloat32(rgb.r / 255);
    writeFloat32(rgb.g / 255);
    writeFloat32(rgb.b / 255);
    writeUint16(0); // color type = global
  }

  return buf;
}

module.exports = { parseACO, parseASE, enrichColor, toHex, slugify, writeACO, writeASE };