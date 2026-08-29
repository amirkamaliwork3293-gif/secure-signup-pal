/**
 * طبقه‌بندی DEVICE_TIER باید گوشی ۳/۶ گیگ را low نکند.
 * اجرا: node --experimental-strip-types scripts/test-device-tier.mjs
 */
import assert from "node:assert/strict";
import { classifyDeviceTier } from "../src/lib/device-tier.ts";

const cases = [
  { name: "3GB octa (Chrome reports mem=2)", mem: 2, cores: 8, expect: "mid" },
  { name: "4GB octa (reports mem=4)", mem: 4, cores: 8, expect: "high" },
  { name: "6GB octa (reports mem=4)", mem: 4, cores: 8, expect: "high" },
  { name: "8GB octa (reports mem=8)", mem: 8, cores: 8, expect: "high" },
  { name: "2GB quad", mem: 2, cores: 4, expect: "low" },
  { name: "1GB dual", mem: 1, cores: 2, expect: "low" },
  { name: "Safari iPhone (mem=0, 6 cores)", mem: 0, cores: 6, expect: "mid" },
  { name: "Safari iPhone octa (mem=0)", mem: 0, cores: 8, expect: "high" },
  { name: "desktop 16GB quad", mem: 16, cores: 4, expect: "mid" },
];

// رگرسیون dc14f20: mem<=2 ⇒ low و mem<=4 ⇒ mid
function classifyDc14f20(mem, cores) {
  if (mem > 0 && mem <= 2) return "low";
  if (mem > 0 && mem <= 4) return "mid";
  if (cores >= 8 && (mem === 0 || mem >= 6)) return "high";
  if (cores >= 4) return "mid";
  return "low";
}

for (const c of cases) {
  const got = classifyDeviceTier({ deviceMemory: c.mem, hardwareConcurrency: c.cores });
  assert.equal(got, c.expect, `${c.name}: got ${got}, expected ${c.expect}`);
}

assert.equal(
  classifyDc14f20(2, 8),
  "low",
  "سند رگرسیون: الگوریتم قبلی گوشی ۳گیگ هشت‌هسته‌ای را low می‌کرد",
);
assert.notEqual(
  classifyDeviceTier({ deviceMemory: 2, hardwareConcurrency: 8 }),
  "low",
  "الگوریتم جدید همان گوشی را low نمی‌کند",
);

assert.equal(classifyDc14f20(4, 8), "mid");
assert.equal(
  classifyDeviceTier({ deviceMemory: 4, hardwareConcurrency: 8 }),
  "high",
  "۴–۸ گیگ + هشت هسته باید high باشد (کروم ۴ گزارش می‌کند)",
);

console.log("device-tier: ok");
