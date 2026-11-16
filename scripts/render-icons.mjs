#!/usr/bin/env node
/**
 * Renders this lab's app icons from `design/app-icon.svg`.
 *
 *   node scripts/render-icons.mjs
 *
 * Lab-pipeline rule (2026-11-07): every lab has its own app icon. The tile is
 * the same for all labs (Beyondles Deep Navy #0A0E1A, rounded like the
 * Beyondles icon); the glyph is the lab's Lucide icon from the Suite toolbox
 * (beyondles-suite `app/(dashboard)/toolbox/ToolboxView.tsx`), stroked in the
 * brand gradient. Change the glyph in the SVG, then run this script.
 *
 * Writes (all checked in, the build does not run this):
 *   src/app/icon.png          512x512  rounded tile (browser tab, Android)
 *   src/app/apple-icon.png    180x180  square tile (iOS rounds it itself)
 *   src/app/favicon.ico       16, 32, 48 rounded tile
 *   public/icon-maskable.png  512x512  square tile, glyph at 50 % (80 % safe zone)
 *
 * Needs `sharp`. If the lab does not have it: `npm i --no-save sharp` first.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TILE = 512;
const GLYPH_UNITS = 24; // Lucide view box

function withGlyphScale(svg, fraction) {
  const scale = (TILE * fraction) / GLYPH_UNITS;
  const offset = (TILE - GLYPH_UNITS * scale) / 2;
  const marker = /data-glyph-scale="[^"]*" transform="[^"]*"/;
  if (!marker.test(svg)) {
    throw new Error("design/app-icon.svg: glyph group with data-glyph-scale not found");
  }
  return svg.replace(
    marker,
    `data-glyph-scale="${fraction}" transform="translate(${offset} ${offset}) scale(${scale})"`,
  );
}

/** Same icon with a square tile (iOS and maskable icons are cropped by the OS). */
function square(svg) {
  return svg.replace(/(<rect data-tile[^>]*?) rx="[^"]*"/, "$1");
}

async function png(svg, size) {
  return sharp(Buffer.from(svg), { density: 72 * Math.max(1, size / TILE) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** An ICO file whose entries are PNG images (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const source = await readFile(join(root, "design/app-icon.svg"), "utf8");

await mkdir(join(root, "public"), { recursive: true });
await writeFile(join(root, "src/app/icon.png"), await png(source, 512));
await writeFile(join(root, "src/app/apple-icon.png"), await png(square(source), 180));
await writeFile(
  join(root, "src/app/favicon.ico"),
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(source, size) })))),
);
await writeFile(join(root, "public/icon-maskable.png"), await png(square(withGlyphScale(source, 0.5)), 512));
console.log("icons rendered: icon.png, apple-icon.png, favicon.ico, public/icon-maskable.png");
