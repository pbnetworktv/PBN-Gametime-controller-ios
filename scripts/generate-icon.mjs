import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";

const size = 1024;
const pixels = Buffer.alloc(size * size * 3);
const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

function pixel(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 3;
  pixels[offset] = clamp(r);
  pixels[offset + 1] = clamp(g);
  pixels[offset + 2] = clamp(b);
}

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const dx = (x - 512) / 720;
    const dy = (y - 270) / 820;
    const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
    pixel(x, y, 3 + glow * 28, 3 + glow * 24, 7 + glow * 35);
  }
}

function rect(x, y, width, height, color) {
  for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) pixel(px, py, ...color);
}

function line(x1, y1, x2, y2, thickness, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i += 1) {
    const x = Math.round(x1 + ((x2 - x1) * i) / steps);
    const y = Math.round(y1 + ((y2 - y1) * i) / steps);
    rect(x - Math.floor(thickness / 2), y - Math.floor(thickness / 2), thickness, thickness, color);
  }
}

line(120, 512, 904, 512, 8, [104, 46, 151]);
line(205, 745, 340, 285, 11, [76, 34, 108]);
line(819, 745, 684, 285, 11, [76, 34, 108]);

const glyphs = {
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  N: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"]
};

const scale = 58;
const gap = 32;
const letterWidth = 5 * scale;
const totalWidth = letterWidth * 3 + gap * 2;
let cursor = Math.floor((size - totalWidth) / 2);
for (const letter of "PBN") {
  const rows = glyphs[letter];
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < rows[row].length; col += 1) {
      if (rows[row][col] !== "1") continue;
      const top = 300 + row * scale;
      const shade = 210 - row * 12;
      rect(cursor + col * scale, top, scale - 9, scale - 9, [shade, 104 - row * 3, 246 - row * 8]);
    }
  }
  cursor += letterWidth + gap;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

const raw = Buffer.alloc((size * 3 + 1) * size);
for (let y = 0; y < size; y += 1) {
  const rowStart = y * (size * 3 + 1);
  raw[rowStart] = 0;
  pixels.copy(raw, rowStart + 1, y * size * 3, (y + 1) * size * 3);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 2;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);

await writeFile(new URL("../resources/AppIcon-1024.png", import.meta.url), png);
console.log("Generated resources/AppIcon-1024.png");
