/**
 * چاپ مستقیم فوممو — ساخت دستورها و تبدیل تصویر به بیت.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-phomemo.ts
 */
import assert from "node:assert/strict";
import { buildPhomemoJob, buildPrintSteps, packBitmap } from "../src/lib/phomemo.ts";

// 10×2 pixels: row 0 = black at x=0 and x=9, row 1 = all white (and one transparent pixel)
const w = 10;
const h = 2;
const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
const black = (x: number, y: number) => rgba.set([0, 0, 0, 255], (y * w + x) * 4);
black(0, 0);
black(9, 0);
rgba.set([0, 0, 0, 0], (1 * w + 3) * 4); // fully transparent → white
const { bits, widthBytes } = packBitmap(rgba, w, h);
assert.equal(widthBytes, 2, "rows rounded up to whole bytes");
assert.deepEqual([...bits], [0b10000000, 0b01000000, 0, 0], "MSB = leftmost dot, 1 = black");

const job = buildPhomemoJob(bits, widthBytes, h, { density: 10, speed: 3, media: "continuous" });
assert.deepEqual(
  [...job.subarray(0, 19)],
  [
    0x1b,
    0x4e,
    0x0d,
    3, // speed
    0x1b,
    0x4e,
    0x04,
    10, // density
    0x1f,
    0x11,
    0x0b, // continuous paper
    0x1d,
    0x76,
    0x30,
    0x00,
    2,
    0,
    2,
    0, // GS v 0: 2 bytes/line, 2 lines (LE16)
  ],
);
assert.deepEqual([...job.subarray(19, 23)], [...bits], "bitmap follows header");
assert.deepEqual([...job.subarray(23)], [0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00]);
assert.equal(job.length, 19 + 4 + 8);

// whole receipt = exactly ONE raster command (M220 gaps ~6mm between raster commands)
const tall = new Uint8Array(72 * 1700);
const big = buildPhomemoJob(tall, 72, 1700, { density: 10, speed: 3, media: "continuous" });
let rasterCmds = 0;
for (let i = 0; i < 19; i++) if (big[i] === 0x1d && big[i + 1] === 0x76) rasterCmds++;
assert.equal(rasterCmds, 1);
assert.deepEqual([...big.subarray(15, 19)], [72, 0, 1700 & 0xff, 1700 >> 8]);

// gap labels code, clamped settings, invalid sizes rejected
const gap = buildPhomemoJob(bits, 2, 2, { density: 99, speed: -4, media: "gap" });
assert.equal(gap[10], 0x0a);
assert.equal(gap[7], 15, "density clamped to 15");
assert.equal(gap[3], 1, "speed clamped to 1");
assert.throws(() => buildPhomemoJob(bits, 2, 3, { density: 8, speed: 3, media: "gap" }));
assert.throws(() =>
  buildPhomemoJob(new Uint8Array(0), 0, 0, { density: 8, speed: 3, media: "gap" }),
);

// ── ESC/POS steps (phomymo M200/M220 path) ──
{
  const steps = buildPrintSteps("escpos", bits, 2, 2, {
    density: 15,
    speed: 3,
    media: "continuous",
    feedDots: 32,
  });
  const hex = steps.map((st) => (st.chunked ? "DATA" : [...st.bytes].join(",")));
  assert.deepEqual(hex, [
    "27,64", // ESC @
    "27,55,7,200,2", // ESC 7: max dots 7, heat 200 (darkest), interval 2
    "29,124,8", // GS | 8
    "29,118,48,0,2,0,2,0", // GS v 0, 2 bytes/line, 2 lines
    "DATA",
    "27,74,32", // ESC J 32 dots
  ]);
  assert.equal(steps.filter((st) => st.bytes[0] === 0x1d && st.bytes[1] === 0x76).length, 1);
  assert.deepEqual([...steps[4].bytes], [...bits], "image data untouched");
  assert.ok(steps[0].waitMs >= 100, "pause after init");
  const light = buildPrintSteps("escpos", bits, 2, 2, {
    density: 1,
    speed: 3,
    media: "gap",
    feedDots: 999,
  });
  assert.equal(light[1].bytes[3], 40, "lightest heat");
  assert.equal(light[5].bytes[2], 255, "feed clamped to one byte");
  const m110 = buildPrintSteps("m110", bits, 2, 2, {
    density: 10,
    speed: 3,
    media: "continuous",
    feedDots: 0,
  });
  assert.equal(m110.length, 1);
  assert.deepEqual(
    [...m110[0].bytes],
    [...buildPhomemoJob(bits, 2, 2, { density: 10, speed: 3, media: "continuous" })],
  );
}

console.log("phomemo tests passed");
