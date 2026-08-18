#!/usr/bin/env node
/**
 * Extends `apps/web/public/assets/atlas-game.{png,json}` with the 13 mode frames
 * defined by the design contract (`sprite-map.json`: origin y=320, maxY=400).
 *
 *   node scripts/build-atlas-modes.mjs           # rewrite the atlas in place
 *   node scripts/build-atlas-modes.mjs --check   # verify only, non-zero on drift
 *
 * The committed atlas is the shipped asset; this script is the reproducible recipe
 * for it, not a build step (`--check` is what the smoke run asserts). It never
 * moves an existing rect and never adds a palette entry: the source atlas is an
 * 8-bit indexed PNG with a 16-colour PLTE + 1-byte tRNS, and every new pixel is
 * drawn with one of those existing indices, so binary alpha and the ≤18 colour
 * budget hold by construction.
 */

import { deflateSync, inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const pngPath = path.join(repoRoot, "apps/web/public/assets/atlas-game.png");
const jsonPath = path.join(repoRoot, "apps/web/public/assets/atlas-game.json");
const checkOnly = process.argv.includes("--check");

/* ── indexed PNG codec (colour type 3, bit depth 8, no interlace) ────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const readChunks = (buffer) => {
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
};

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

const paethPredictor = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/** @returns {{ width: number, height: number, pixels: Uint8Array, plte: Buffer, trns: Buffer }} */
const decode = (buffer) => {
  const chunks = readChunks(buffer);
  const ihdr = chunks.find((entry) => entry.type === "IHDR").data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8 || ihdr[9] !== 3 || ihdr[12] !== 0) {
    throw new Error(
      `unsupported atlas png: depth=${ihdr[8]} colour=${ihdr[9]} interlace=${ihdr[12]}`,
    );
  }
  const raw = inflateSync(
    Buffer.concat(
      chunks.filter((entry) => entry.type === "IDAT").map((entry) => entry.data),
    ),
  );
  const pixels = new Uint8Array(width * height);
  let previous = new Uint8Array(width);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const line = new Uint8Array(width);
    for (let x = 0; x < width; x += 1) {
      const value = raw[cursor + x];
      const a = x > 0 ? line[x - 1] : 0;
      const b = previous[x];
      const c = x > 0 ? previous[x - 1] : 0;
      line[x] =
        filter === 0
          ? value
          : filter === 1
            ? (value + a) & 0xff
            : filter === 2
              ? (value + b) & 0xff
              : filter === 3
                ? (value + ((a + b) >> 1)) & 0xff
                : (value + paethPredictor(a, b, c)) & 0xff;
    }
    pixels.set(line, y * width);
    previous = line;
    cursor += width;
  }
  return {
    width,
    height,
    pixels,
    plte: Buffer.from(chunks.find((entry) => entry.type === "PLTE").data),
    trns: Buffer.from(chunks.find((entry) => entry.type === "tRNS").data),
  };
};

const encode = ({ width, height, pixels, plte, trns }) => {
  // Per-line filter choice: sub/up/none scored by absolute-sum, which is what the
  // original exporter effectively produced and keeps the file small without deps.
  const raw = Buffer.alloc((width + 1) * height);
  let previous = new Uint8Array(width);
  for (let y = 0; y < height; y += 1) {
    const line = pixels.subarray(y * width, y * width + width);
    const candidates = [];
    for (const filter of [0, 1, 2]) {
      const encoded = new Uint8Array(width);
      let score = 0;
      for (let x = 0; x < width; x += 1) {
        const a = x > 0 ? line[x - 1] : 0;
        const value =
          filter === 0
            ? line[x]
            : filter === 1
              ? (line[x] - a) & 0xff
              : (line[x] - previous[x]) & 0xff;
        encoded[x] = value;
        score += value < 128 ? value : 256 - value;
      }
      candidates.push({ filter, encoded, score });
    }
    const best = candidates.reduce((a, b) => (b.score < a.score ? b : a));
    raw[y * (width + 1)] = best.filter;
    Buffer.from(best.encoded).copy(raw, y * (width + 1) + 1);
    previous = line;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("tRNS", trns),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/* ── palette indices of the existing 16-colour atlas ─────────────────────── */

const C = {
  none: 0,
  night: 1, // #150e2a
  ink: 2, // #0c0511
  violet: 3, // #2b214c
  shadow: 4, // #271e31
  maroon: 5, // #2f1011
  brown: 6, // #582217
  red: 7, // #bb3d3c
  orange: 8, // #dc6913
  sand: 9, // #f8ae5b
  gold: 10, // #f79629
  slate: 11, // #434c51
  cream: 12, // #dbcfbc
  amber: 13, // #d9ba57
  teal: 14, // #418384
  pink: 15, // #e05695
};

/* ── tiny raster helpers, all in atlas space ─────────────────────────────── */

const createSurface = (width, height, pixels) => {
  const put = (x, y, colour) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    pixels[y * width + x] = colour;
  };
  return {
    put,
    rect(x, y, w, h, colour) {
      for (let dy = 0; dy < h; dy += 1)
        for (let dx = 0; dx < w; dx += 1) put(x + dx, y + dy, colour);
    },
    frame(x, y, w, h, colour) {
      for (let dx = 0; dx < w; dx += 1) {
        put(x + dx, y, colour);
        put(x + dx, y + h - 1, colour);
      }
      for (let dy = 0; dy < h; dy += 1) {
        put(x, y + dy, colour);
        put(x + w - 1, y + dy, colour);
      }
    },
    disc(cx, cy, radius, colour) {
      for (let dy = -radius; dy <= radius; dy += 1)
        for (let dx = -radius; dx <= radius; dx += 1)
          if (dx * dx + dy * dy <= radius * radius) put(cx + dx, cy + dy, colour);
      },
    ring(cx, cy, radius, colour) {
      for (let dy = -radius; dy <= radius; dy += 1)
        for (let dx = -radius; dx <= radius; dx += 1) {
          const d = dx * dx + dy * dy;
          if (d <= radius * radius && d > (radius - 1.6) * (radius - 1.6))
            put(cx + dx, cy + dy, colour);
        }
    },
    /** Outlines every opaque pixel of the given box with `colour` (binary alpha safe). */
    outline(x, y, w, h, colour) {
      const copy = new Uint8Array(w * h);
      for (let dy = 0; dy < h; dy += 1)
        for (let dx = 0; dx < w; dx += 1)
          copy[dy * w + dx] = pixels[(y + dy) * width + (x + dx)];
      const solid = (dx, dy) =>
        dx >= 0 && dy >= 0 && dx < w && dy < h && copy[dy * w + dx] !== C.none;
      for (let dy = 0; dy < h; dy += 1)
        for (let dx = 0; dx < w; dx += 1) {
          if (copy[dy * w + dx] !== C.none) continue;
          if (
            solid(dx - 1, dy) ||
            solid(dx + 1, dy) ||
            solid(dx, dy - 1) ||
            solid(dx, dy + 1)
          )
            put(x + dx, y + dy, colour);
        }
    },
  };
};

/* ── the 13 mode frames (rects come from design/sprite-map.json) ─────────── */

const FRAMES = {
  arrow_left: { x: 0, y: 320, w: 16, h: 16, anchor: { x: 8, y: 8 }, category: "dance" },
  arrow_right: { x: 16, y: 320, w: 16, h: 16, anchor: { x: 8, y: 8 }, category: "dance" },
  arrow_up: { x: 32, y: 320, w: 16, h: 16, anchor: { x: 8, y: 8 }, category: "dance" },
  arrow_down: { x: 48, y: 320, w: 16, h: 16, anchor: { x: 8, y: 8 }, category: "dance" },
  judgement_ring: { x: 64, y: 320, w: 24, h: 24, anchor: { x: 12, y: 12 }, category: "dance" },
  soccer_ball_0: { x: 0, y: 344, w: 16, h: 16, anchor: { x: 8, y: 8 }, category: "soccer" },
  soccer_ball_1: { x: 16, y: 344, w: 16, h: 16, anchor: { x: 8, y: 8 }, category: "soccer" },
  soccer_goal: { x: 32, y: 344, w: 32, h: 24, anchor: { x: 16, y: 24 }, category: "soccer" },
  drive_car: { x: 0, y: 368, w: 48, h: 24, anchor: { x: 24, y: 24 }, category: "drive" },
  road_solid: { x: 48, y: 368, w: 16, h: 16, anchor: { x: 8, y: 8 }, category: "drive" },
  road_dash: { x: 64, y: 368, w: 16, h: 16, anchor: { x: 8, y: 8 }, category: "drive" },
  sunset_far: { x: 80, y: 368, w: 64, h: 32, anchor: { x: 0, y: 0 }, category: "drive" },
  sunset_near: { x: 144, y: 368, w: 64, h: 32, anchor: { x: 0, y: 0 }, category: "drive" },
};

/** 16×16 arrow, drawn once pointing up and rotated into the other three rects. */
const ARROW_UP = [
  "................",
  ".......dd.......",
  "......dddd......",
  ".....dddddd.....",
  "....dddddddd....",
  "...dddddddddd...",
  "..dddddddddddd..",
  ".dddddddddddddd.",
  "......dddd......",
  "......dddd......",
  "......dddd......",
  "......dddd......",
  "......dddd......",
  "......dddd......",
  "................",
  "................",
];

const rotateGrid = (grid, quarterTurns) => {
  let current = grid.map((row) => [...row]);
  for (let turn = 0; turn < quarterTurns; turn += 1) {
    const size = current.length;
    const next = Array.from({ length: size }, () => new Array(size).fill("."));
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) next[x][size - 1 - y] = current[y][x];
    current = next;
  }
  return current.map((row) => row.join(""));
};

const drawArrow = (surface, rect, quarterTurns, fill, highlight) => {
  const grid = rotateGrid(ARROW_UP, quarterTurns);
  for (let y = 0; y < 16; y += 1)
    for (let x = 0; x < 16; x += 1)
      if (grid[y][x] === "d") surface.put(rect.x + x, rect.y + y, fill);
  // one-pixel inner highlight so the glyph still reads at 1× on a dark lane
  for (let y = 0; y < 16; y += 1)
    for (let x = 0; x < 16; x += 1) {
      if (grid[y][x] !== "d") continue;
      const above = y > 0 && grid[y - 1][x] === "d";
      if (!above) surface.put(rect.x + x, rect.y + y, highlight);
    }
  surface.outline(rect.x, rect.y, 16, 16, C.ink);
};

const paint = (pixels, width) => {
  const s = createSurface(width, 512, pixels);

  // clear the whole extension band so re-runs are idempotent
  s.rect(0, 320, width, 80, C.none);

  /* DANCE — four lane arrows + the receptor ring */
  drawArrow(s, FRAMES.arrow_up, 0, C.amber, C.sand);
  drawArrow(s, FRAMES.arrow_right, 1, C.teal, C.cream);
  drawArrow(s, FRAMES.arrow_down, 2, C.pink, C.sand);
  drawArrow(s, FRAMES.arrow_left, 3, C.gold, C.sand);

  const ring = FRAMES.judgement_ring;
  s.ring(ring.x + 12, ring.y + 12, 11, C.pink);
  s.ring(ring.x + 12, ring.y + 12, 8, C.violet);
  for (const [dx, dy] of [
    [0, -11],
    [0, 11],
    [-11, 0],
    [11, 0],
  ]) {
    s.rect(ring.x + 11 + dx, ring.y + 11 + dy, 2, 2, C.cream);
  }

  /* SOCCER — two ball phases + the goal frame */
  for (const [name, offset] of [
    ["soccer_ball_0", 0],
    ["soccer_ball_1", 1],
  ]) {
    const rect = FRAMES[name];
    s.disc(rect.x + 8, rect.y + 8, 6, C.cream);
    // rotating patches: two phases, so a spin reads without a third frame
    const patches =
      offset === 0
        ? [
            [8, 5],
            [5, 10],
            [11, 10],
          ]
        : [
            [5, 6],
            [11, 7],
            [8, 11],
          ];
    for (const [px, py] of patches) {
      s.rect(rect.x + px - 1, rect.y + py - 1, 2, 2, C.ink);
    }
    s.rect(rect.x + 5, rect.y + 4, 2, 2, C.pink); // spin highlight
    s.outline(rect.x, rect.y, 16, 16, C.ink);
  }

  const goal = FRAMES.soccer_goal;
  s.rect(goal.x, goal.y, 32, 2, C.cream); // crossbar
  s.rect(goal.x, goal.y, 2, 24, C.cream); // posts
  s.rect(goal.x + 30, goal.y, 2, 24, C.cream);
  for (let x = 4; x < 30; x += 4) s.rect(goal.x + x, goal.y + 2, 1, 22, C.slate);
  for (let y = 5; y < 24; y += 5) s.rect(goal.x + 2, goal.y + y, 28, 1, C.slate);

  /* DRIVE — rear-view car, two road tiles, two sunset bands */
  const car = FRAMES.drive_car;
  s.rect(car.x + 4, car.y + 8, 40, 12, C.gold); // body
  s.rect(car.x + 4, car.y + 16, 40, 4, C.orange); // lower body shade
  s.rect(car.x + 12, car.y + 2, 24, 7, C.gold); // cabin
  s.rect(car.x + 14, car.y + 3, 20, 5, C.teal); // rear window
  s.rect(car.x + 2, car.y + 18, 44, 2, C.pink); // bumper
  s.rect(car.x + 5, car.y + 12, 6, 4, C.red); // tail lights
  s.rect(car.x + 37, car.y + 12, 6, 4, C.red);
  s.rect(car.x + 6, car.y + 13, 4, 2, C.pink); // lit filament
  s.rect(car.x + 38, car.y + 13, 4, 2, C.pink);
  s.rect(car.x + 6, car.y + 20, 8, 4, C.ink); // wheels
  s.rect(car.x + 34, car.y + 20, 8, 4, C.ink);
  s.rect(car.x + 20, car.y + 10, 8, 2, C.sand); // plate
  s.outline(car.x, car.y, 48, 24, C.ink);

  const solid = FRAMES.road_solid;
  s.rect(solid.x, solid.y, 16, 16, C.night);
  for (let y = 0; y < 16; y += 4) s.rect(solid.x, solid.y + y, 16, 1, C.violet);

  const dash = FRAMES.road_dash;
  s.rect(dash.x, dash.y, 16, 16, C.night);
  for (let y = 0; y < 16; y += 4) s.rect(dash.x, dash.y + y, 16, 1, C.violet);
  s.rect(dash.x + 7, dash.y + 2, 2, 12, C.amber);

  const far = FRAMES.sunset_far;
  const bands = [
    [0, 6, C.violet],
    [6, 5, C.night],
    [11, 6, C.pink],
    [17, 6, C.orange],
    [23, 9, C.gold],
  ];
  for (const [y, h, colour] of bands) s.rect(far.x, far.y + y, 64, h, colour);
  s.disc(far.x + 32, far.y + 20, 11, C.sand);
  s.rect(far.x, far.y + 30, 64, 2, C.amber);

  const near = FRAMES.sunset_near;
  s.rect(near.x, near.y, 64, 32, C.none);
  // skyline silhouette: deterministic block heights, flat colour, hard edges
  const heights = [10, 16, 8, 20, 12, 24, 9, 18, 14, 22, 11, 17, 7, 21, 13, 19];
  for (let index = 0; index < heights.length; index += 1) {
    const h = heights[index];
    s.rect(near.x + index * 4, near.y + 32 - h, 4, h, C.ink);
    if (h > 12) s.put(near.x + index * 4 + 1, near.y + 34 - h + 2, C.amber);
    if (h > 16) s.put(near.x + index * 4 + 2, near.y + 34 - h + 6, C.amber);
  }
};

/* ── run ─────────────────────────────────────────────────────────────────── */

const sourcePng = fs.readFileSync(pngPath);
const image = decode(sourcePng);
if (image.width !== 512 || image.height !== 512) {
  throw new Error(`unexpected atlas size ${image.width}x${image.height}`);
}

const atlas = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const existing = Object.entries(atlas.frames).filter(
  ([name]) => !(name in FRAMES),
);
const collisions = existing.filter(
  ([, value]) => value.frame.y + value.frame.h > 320,
);
if (collisions.length > 0) {
  throw new Error(
    `existing frames would be overwritten: ${collisions.map(([name]) => name).join(",")}`,
  );
}

paint(image.pixels, image.width);
const nextPng = encode(image);

/** Category counts stay in sync with `frames` — the runner ships them as `groups`. */
const groupsOf = (frames) => {
  const groups = {};
  for (const value of Object.values(frames)) {
    groups[value.category] = (groups[value.category] ?? 0) + 1;
  }
  return groups;
};

const nextAtlas = {
  ...atlas,
  meta: { ...atlas.meta, version: 2 },
  frames: {
    ...Object.fromEntries(existing),
    ...Object.fromEntries(
      Object.entries(FRAMES).map(([name, spec]) => [
        name,
        {
          frame: { x: spec.x, y: spec.y, w: spec.w, h: spec.h },
          anchor: spec.anchor,
          category: spec.category,
        },
      ]),
    ),
  },
  animations: {
    ...atlas.animations,
    soccer_ball_spin: {
      frames: ["soccer_ball_0", "soccer_ball_1"],
      msPerFrame: 120,
    },
    road_center: { frames: ["road_solid", "road_dash"], msPerFrame: 120 },
  },
};
nextAtlas.groups = groupsOf(nextAtlas.frames);
// The committed atlas JSON is minified on one line; keep that shape so the diff of
// a 13-frame addition stays a 13-frame addition.
const nextJson = JSON.stringify(nextAtlas);

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const pngChanged = sha(nextPng) !== sha(sourcePng);
const jsonChanged = nextJson !== fs.readFileSync(jsonPath, "utf8");

if (checkOnly) {
  const drift = [
    pngChanged ? "atlas-game.png" : null,
    jsonChanged ? "atlas-game.json" : null,
  ].filter(Boolean);
  if (drift.length > 0) {
    console.error(`atlas drift: ${drift.join(", ")} differ from the recipe`);
    process.exit(1);
  }
  console.log(
    `atlas up to date · ${Object.keys(nextAtlas.frames).length} frames · ${nextPng.length} B`,
  );
  process.exit(0);
}

fs.writeFileSync(pngPath, nextPng);
fs.writeFileSync(jsonPath, nextJson);
console.log(
  `atlas written · ${Object.keys(nextAtlas.frames).length} frames · png ${sourcePng.length} → ${nextPng.length} B`,
);
