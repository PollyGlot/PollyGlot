#!/usr/bin/env node
// Generates assets/banner.svg: a dithered landscape whose foreground hills are
// the last year of GitHub contributions. No dependencies; needs `gh` (or --data).
//   node scripts/banner.mjs [--login NAME] [--data calendar.json] [--out path]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const login = arg("login", "PollyGlot");
const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", arg("out", "assets/banner.svg"));

const W = 1280, H = 300, CELL = 4, DOT = 3;
const COLS = W / CELL, ROWS = H / CELL;

// Palette of social/assets/DA-kit.md (red on red, validated 2026-11-24).
const PALETTE = {
  paper: "#FFE4DE",
  ink: "#4A0F12",
  back: "#F6A397",
  sun: "#E8281E",
  hillTop: "#E8281E",
  hillLow: "#4A0F12",
};

function loadCalendar() {
  const file = arg("data");
  if (file) return JSON.parse(readFileSync(file, "utf8"));
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount}}}}}}`;
  const raw = execFileSync("gh", ["api", "graphql", "-f", `login=${login}`, "-f", `query=${query}`], { encoding: "utf8" });
  return JSON.parse(raw).data.user.contributionsCollection.contributionCalendar;
}

const calendar = loadCalendar();
const days = calendar.weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount));
const total = calendar.totalContributions;

// ---- data -> column heights (0..1) ------------------------------------------
function resample(values, n) {
  const res = [];
  for (let i = 0; i < n; i++) {
    const a = (i * values.length) / n, b = ((i + 1) * values.length) / n;
    let sum = 0, w = 0;
    for (let j = Math.floor(a); j < Math.ceil(b) && j < values.length; j++) {
      const overlap = Math.min(b, j + 1) - Math.max(a, j);
      sum += values[j] * overlap; w += overlap;
    }
    res.push(sum / w);
  }
  return res;
}
const cols = resample(days, COLS);
const sorted = [...cols].sort((a, b) => a - b);
const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
const clipped = cols.map((v) => Math.min(1, v / p95));
const norm = clipped.map((_, i) => {
  const w = [0.25, 0.5, 1, 0.5, 0.25];
  let s = 0, t = 0;
  w.forEach((k, j) => { const v = clipped[i + j - 2]; if (v !== undefined) { s += v * k; t += k; } });
  return Math.pow(s / t, 0.75);
});

// ---- helpers ----------------------------------------------------------------
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function bayer(n) {
  if (n === 1) return [[0]];
  const m = bayer(n / 2), s = n / 2, r = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const v = 4 * m[y][x];
    r[y][x] = v; r[y][x + s] = v + 2; r[y + s][x] = v + 3; r[y + s][x + s] = v + 1;
  }
  return r;
}
const B = bayer(8);
const threshold = (x, y) => (B[y % 8][x % 8] + 0.5) / 64;

// grid[y][x] = palette key or null
const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
const solid = Array.from({ length: ROWS }, () => Array(COLS).fill(false));

// ---- sun and halo -----------------------------------------------------------
const sx = 250, sy = 27, SR = 7;
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  const d = Math.hypot(x - sx, y - sy);
  if (d <= SR) { grid[y][x] = "sun"; solid[y][x] = true; continue; }
  const halo = 1 - (d - SR) / 22;
  if (halo > 0 && halo * halo * 0.9 > threshold(x, y)) grid[y][x] = "sun";
}

// ---- back range (dithered crosshatch) ---------------------------------------
const noise = (x) => 0.5 + 0.22 * Math.sin(x * 0.045 + 1.3) + 0.16 * Math.sin(x * 0.11 + 0.4) + 0.12 * Math.sin(x * 0.27 + 2.1);
for (let x = 0; x < COLS; x++) {
  const h = 8 + 11 * noise(x) + 22 * smooth(140, 290, x);
  const top = Math.round(ROWS - h);
  for (let y = top; y < ROWS; y++) {
    solid[y][x] = true; grid[y][x] = null;
    const depth = (y - top) / (ROWS - top);
    if (0.3 + 0.35 * depth > threshold(x, y) || (y === top && (x + y) % 2 === 0)) grid[y][x] = "back";
  }
}

// ---- front hills (contributions) --------------------------------------------
for (let x = 0; x < COLS; x++) {
  const hmax = 20 + 14 * smooth(110, 270, x);
  const h = 3 + norm[x] * (hmax - 3);
  const top = Math.round(ROWS - h);
  for (let y = top; y < ROWS; y++) {
    solid[y][x] = true;
    const depth = (y - top) / Math.max(1, ROWS - top);
    const density = 0.4 + 0.6 * depth;
    grid[y][x] = null;
    if (y === top || density > threshold(x, y)) grid[y][x] = depth < 0.35 ? "hillTop" : "hillLow";
  }
}

// ---- pixel text -------------------------------------------------------------
const GLYPHS = {
  A: "01110,10001,10001,11111,10001,10001,10001", B: "11110,10001,10001,11110,10001,10001,11110",
  C: "01110,10001,10000,10000,10000,10001,01110", D: "11110,10001,10001,10001,10001,10001,11110",
  E: "11111,10000,10000,11110,10000,10000,11111", F: "11111,10000,10000,11110,10000,10000,10000",
  G: "01110,10001,10000,10111,10001,10001,01111", H: "10001,10001,10001,11111,10001,10001,10001",
  I: "01110,00100,00100,00100,00100,00100,01110", J: "00111,00010,00010,00010,00010,10010,01100",
  K: "10001,10010,10100,11000,10100,10010,10001", L: "10000,10000,10000,10000,10000,10000,11111",
  M: "10001,11011,10101,10101,10001,10001,10001", N: "10001,11001,10101,10011,10001,10001,10001",
  O: "01110,10001,10001,10001,10001,10001,01110", P: "11110,10001,10001,11110,10000,10000,10000",
  Q: "01110,10001,10001,10001,10101,10010,01101", R: "11110,10001,10001,11110,10100,10010,10001",
  S: "01111,10000,10000,01110,00001,00001,11110", T: "11111,00100,00100,00100,00100,00100,00100",
  U: "10001,10001,10001,10001,10001,10001,01110", V: "10001,10001,10001,10001,10001,01010,00100",
  W: "10001,10001,10001,10101,10101,11011,10001", X: "10001,10001,01010,00100,01010,10001,10001",
  Y: "10001,10001,01010,00100,00100,00100,00100", Z: "11111,00001,00010,00100,01000,10000,11111",
  0: "01110,10001,10011,10101,11001,10001,01110", 1: "00100,01100,00100,00100,00100,00100,01110",
  2: "01110,10001,00001,00010,00100,01000,11111", 3: "11110,00001,00001,01110,00001,00001,11110",
  4: "00010,00110,01010,10010,11111,00010,00010", 5: "11111,10000,11110,00001,00001,10001,01110",
  6: "00110,01000,10000,11110,10001,10001,01110", 7: "11111,00001,00010,00100,01000,01000,01000",
  8: "01110,10001,10001,01110,10001,10001,01110", 9: "01110,10001,10001,01111,00001,00010,01100",
  ",": "00000,00000,00000,00000,01100,00100,01000", "-": "00000,00000,00000,11111,00000,00000,00000",
  ":": "00000,00100,00100,00000,00100,00100,00000", " ": "00000,00000,00000,00000,00000,00000,00000",
};
function textPath(str, x0, y0, p) {
  let d = "", x = x0;
  for (const ch of str.toUpperCase()) {
    const g = GLYPHS[ch];
    if (!g) throw new Error(`no glyph for ${JSON.stringify(ch)}`);
    g.split(",").forEach((row, ry) => {
      for (let rx = 0; rx < 5; rx++) if (row[rx] === "1") d += `M${x + rx * p} ${y0 + ry * p}h${p}v${p}h-${p}z`;
    });
    x += 6 * p;
  }
  return d;
}

// ---- compose svg ------------------------------------------------------------
const byColor = {};
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  const c = grid[y][x];
  if (c) (byColor[c] ||= []).push(`M${x * CELL} ${y * CELL}h${DOT}v${DOT}h-${DOT}z`);
}
const formatted = total.toLocaleString("en-US");
const lines = [
  { text: "Pavlo Trinko", y: 40, p: 8, fill: PALETTE.ink },
  { text: "Senior Product Engineer", y: 112, p: 4, fill: PALETTE.ink },
  { text: `${formatted} contributions in the last year`, y: 170, p: 3, fill: PALETTE.ink },
];
const label = `Pavlo Trinko, Senior Product Engineer. ${formatted} contributions in the last year.`;
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">`,
  `<rect width="${W}" height="${H}" rx="20" fill="${PALETTE.paper}"/>`,
  `<g shape-rendering="crispEdges">`,
  ...["sun", "back", "hillLow", "hillTop"].filter((k) => byColor[k]).map((k) => `<path fill="${PALETTE[k]}" d="${byColor[k].join("")}"/>`),
  ...lines.map((l) => `<path fill="${l.fill}" d="${textPath(l.text, 64, l.y, l.p)}"/>`),
  `</g>`,
  `</svg>`,
  "",
].join("\n");
writeFileSync(out, svg);
console.log(`${out}: ${(svg.length / 1024).toFixed(0)} KiB, ${total} contributions, ${days.length} days`);
