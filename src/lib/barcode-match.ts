/**
 * barcode-match.ts — نرمال‌سازی و تطبیق کد اسکن‌شده با بارکد ذخیره‌شده.
 *
 * فقط lookup است؛ هیچ دادهٔ کاربری را نمی‌نویسد یا عوض نمی‌کند.
 * UPC-A (۱۲ رقم) و EAN-13 با صفر پیشوند همان کالاست.
 */

export function normalizeScannedCode(raw: string): string {
  const s = String(raw ?? "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 32 && c !== 127) out += s[i];
  }
  return out.replace(/^\s*][A-Za-z0-9]{2}/, "").trim();
}

export function scannedCodeCandidates(raw: string): string[] {
  const t = normalizeScannedCode(raw);
  if (!t) return [];
  const out: string[] = [];
  const add = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };
  add(t);
  const digits = t.replace(/\D/g, "");
  add(digits);
  if (digits.length === 12) add(`0${digits}`);
  if (digits.length === 13 && digits.startsWith("0")) add(digits.slice(1));
  return out;
}

export function scannedCodesMatch(a: string, b: string): boolean {
  const left = scannedCodeCandidates(a);
  if (left.length === 0) return false;
  const right = new Set(scannedCodeCandidates(b));
  return left.some((c) => right.has(c));
}

export function findProductByCode<T extends { code?: string | null }>(
  list: T[],
  code: string,
): T | undefined {
  const candidates = scannedCodeCandidates(code);
  if (candidates.length === 0) return undefined;

  const exact = list.find((p) => p.code != null && p.code !== "" && candidates.includes(p.code));
  if (exact) return exact;

  const digitKeys = new Set(candidates.map((c) => c.replace(/\D/g, "")).filter(Boolean));
  if (digitKeys.size === 0) return undefined;
  return list.find((p) => digitKeys.has(String(p.code || "").replace(/\D/g, "")));
}
