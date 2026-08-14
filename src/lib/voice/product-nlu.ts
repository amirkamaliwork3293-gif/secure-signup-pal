/**
 * تحلیل‌گر محلی گفتار فارسی برای «ثبت صوتی محصولات».
 *
 * جمله‌ی محاوره‌ای (مثل «بیست عدد پیراهن مشکی دویست و پنجاه هزار تومن»)
 * به فیلدهای ساختاریافته تبدیل می‌شود: نام، موجودی/تعداد، واحد، قیمت (تومان).
 */

import { COUNT_UNIT, getUnitDefs, isWeightUnit, type UnitDef } from "@/lib/store";
import { normalizeFa } from "@/lib/voice/persian-nlu";

export type ParsedProductItem = {
  rawClause: string;
  name: string;
  stock: number;
  unit: string;
  /** قیمت فروش به تومان (همان واحد ذخیره‌سازی) */
  price?: number;
  /** آیا همه‌ی فیلدهای لازم برای افزودن خودکار پر شده؟ */
  confidence: "high" | "partial";
};

export type ParseProductResult = {
  items: ParsedProductItem[];
};

// ─── اعداد ────────────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  صفر: 0,
  یک: 1,
  یه: 1,
  دو: 2,
  سه: 3,
  چهار: 4,
  چار: 4,
  پنج: 5,
  پنح: 5,
  شش: 6,
  شیش: 6,
  هفت: 7,
  هشت: 8,
  نه: 9,
  ده: 10,
  یازده: 11,
  دوازده: 12,
  سیزده: 13,
  چهارده: 14,
  پانزده: 15,
  پونزده: 15,
  شانزده: 16,
  شونزده: 16,
  هفده: 17,
  هجده: 18,
  هیجده: 18,
  نوزده: 19,
  بیست: 20,
  سی: 30,
  چهل: 40,
  پنجاه: 50,
  شصت: 60,
  هفتاد: 70,
  هشتاد: 80,
  نود: 90,
  صد: 100,
  دویست: 200,
  سیصد: 300,
  چهارصد: 400,
  پانصد: 500,
  پونصد: 500,
  ششصد: 600,
  هفتصد: 700,
  هشتصد: 800,
  نهصد: 900,
};

const FRACTION_KG: Record<string, number> = {
  ربع: 0.25,
  چارک: 0.25,
  یکچارک: 0.25,
  نیم: 0.5,
  نص: 0.5,
  سهچارک: 0.75,
};

const COUNT_WORDS = new Set(["عدد", "تا", "دونه", "دانه", "بسته", "شیشه", "بطری", "عددی", "تایی"]);
const KILO_WORDS = new Set(["کیلو", "کیلوگرم", "کیلوگرام", "کیلگرم", "گیلو", "گیلوگرم"]);
const GRAM_WORDS = new Set(["گرم", "گرمی"]);

const CURRENCY_WORDS = new Set(["تومان", "تومن", "ریال", "ت", "ر"]);
const MULTIPLIERS: Record<string, number> = {
  هزار: 1000,
  هزارتا: 1000,
  k: 1000,
  K: 1000,
  میلیون: 1_000_000,
  م: 1_000_000,
};

const PRICE_STOPWORDS = new Set([
  "قیمت",
  "با",
  "قیمتش",
  "هر",
  "عدد",
  "تا",
  "دونه",
  "دانه",
  "کیلو",
  "کیلوگرم",
  "کیلوگرام",
  "گیلو",
  "گیلوگرم",
  "گرم",
  "گرمی",
  "تومان",
  "تومن",
  "ریال",
  "هزار",
  "هزارتا",
  "میلیون",
  "و",
]);

// ─── واحدهای سفارشی ───────────────────────────────────────────────────────────

function buildUnitMaps(unitDefs: UnitDef[]) {
  const spokenToCanonical = new Map<string, string>();
  for (const u of unitDefs) {
    spokenToCanonical.set(u.name, u.name);
    if (u.name === "کیلوگرم") {
      for (const w of KILO_WORDS) spokenToCanonical.set(w, u.name);
    } else if (u.name === "گرم") {
      for (const w of GRAM_WORDS) spokenToCanonical.set(w, u.name);
    } else if (u.name === COUNT_UNIT) {
      for (const w of COUNT_WORDS) spokenToCanonical.set(w, COUNT_UNIT);
    } else {
      // واحد سفارشی — خود نام واحد (مثلاً «بسته»، «لیتر»، «متر»)
      spokenToCanonical.set(u.name, u.name);
    }
  }
  return spokenToCanonical;
}

function isUnitWord(t: string, unitMap: Map<string, string>): boolean {
  return unitMap.has(t) || KILO_WORDS.has(t) || GRAM_WORDS.has(t) || COUNT_WORDS.has(t);
}

function isMultiplierWord(t: string): boolean {
  return t in MULTIPLIERS;
}

function isPriceAnchor(t: string): boolean {
  return isMultiplierWord(t) || CURRENCY_WORDS.has(t);
}

// ─── پارس عدد فارسی ───────────────────────────────────────────────────────────

function tokenToNumber(t: string): number | undefined {
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  return undefined;
}

/** پارس عبارت عددی مثل «دویست و پنجاه» یا «250» از یک بازه توکن */
function parseNumberPhrase(tokens: string[], start: number, end: number): number | undefined {
  let total = 0;
  let current = 0;
  let i = start;
  while (i < end) {
    const t = tokens[i];
    if (t === "و") {
      i++;
      continue;
    }
    const n = tokenToNumber(t);
    if (n === undefined) return undefined;
    // «دویست و پنجاه» → جمع
    if (current > 0 && n < 100 && !/^\d+$/.test(t)) {
      current += n;
    } else if (current > 0) {
      total += current;
      current = n;
    } else {
      current = n;
    }
    i++;
  }
  return total + current;
}

// ─── استخراج قیمت ─────────────────────────────────────────────────────────────

type PriceExtract = { price?: number; restTokens: string[] };

function parsePriceFromTokens(
  tokens: string[],
  start: number,
  end: number,
): { price: number; from: number; to: number } | null {
  if (start >= end) return null;

  let s = start;
  let e = end;
  let currency: "toman" | "rial" | undefined;

  // واحد پول بلافاصله بعد از بازه عددی
  if (e <= tokens.length && e > s && CURRENCY_WORDS.has(tokens[e - 1])) {
    const w = tokens[e - 1];
    if (w === "ریال" || w === "ر") currency = "rial";
    else currency = "toman";
    e--;
  }

  let multiplier = 1;
  if (e > s && tokens[e - 1] in MULTIPLIERS) {
    multiplier = MULTIPLIERS[tokens[e - 1]];
    e--;
  }

  let numStart = e;
  for (let back = 1; back <= 6 && e - back >= s; back++) {
    const t = tokens[e - back];
    if (t === "و" || tokenToNumber(t) !== undefined) numStart = e - back;
    else if (t === "قیمت" || t === "با") {
      numStart = e - back + 1;
      break;
    } else break;
  }

  if (numStart >= e) return null;
  const rawNum = parseNumberPhrase(tokens, numStart, e);
  if (rawNum === undefined || rawNum <= 0) return null;

  let price = rawNum * multiplier;
  if (currency === "rial") price = price / 10;

  return { price, from: numStart, to: end };
}

function extractPrice(tokens: string[]): PriceExtract {
  if (tokens.length === 0) return { restTokens: [] };

  // اول از انتها
  const fromEnd = parsePriceFromTokens(tokens, 0, tokens.length);
  if (fromEnd) {
    const rest = tokens.slice(0, fromEnd.from).filter(
      (t, i, arr) => !(i === arr.length - 1 && (t === "قیمت" || t === "با")),
    );
    return { price: fromEnd.price, restTokens: rest };
  }

  // سپس از ابتدا (مثلاً «5000 ریال آب معدنی»)
  if (tokenToNumber(tokens[0]) !== undefined) {
    let numEnd = 1;
    while (numEnd < tokens.length && (tokens[numEnd] === "و" || tokenToNumber(tokens[numEnd]) !== undefined)) {
      numEnd++;
    }
    let multEnd = numEnd;
    let multiplier = 1;
    if (multEnd < tokens.length && tokens[multEnd] in MULTIPLIERS) {
      multiplier = MULTIPLIERS[tokens[multEnd]];
      multEnd++;
    }
    let curEnd = multEnd;
    let currency: "toman" | "rial" | undefined;
    if (curEnd < tokens.length && CURRENCY_WORDS.has(tokens[curEnd])) {
      const w = tokens[curEnd];
      currency = w === "ریال" || w === "ر" ? "rial" : "toman";
      curEnd++;
    }
    const rawNum = parseNumberPhrase(tokens, 0, numEnd);
    if (rawNum !== undefined && rawNum > 0 && (currency || multiplier > 1 || curEnd > numEnd)) {
      let price = rawNum * multiplier;
      if (currency === "rial") price = price / 10;
      return { price, restTokens: tokens.slice(curEnd) };
    }
  }

  return { restTokens: tokens };
}

// ─── استخراج مقدار/واحد/نام از باقی‌مانده ─────────────────────────────────────

type BodyParse = {
  stock: number;
  unit: string;
  name: string;
};

function parseBody(tokens: string[], unitMap: Map<string, string>): BodyParse {
  let stock = 0;
  let unit = COUNT_UNIT;
  let hasStock = false;
  let fractionKg: number | undefined;
  let gramAmount: number | undefined;
  let count: number | undefined;
  const nameTokens: string[] = [];
  let spokenWeightUnit: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = parseFloat(t);
      const next = tokens[i + 1];
      if (next && GRAM_WORDS.has(next)) {
        gramAmount = (gramAmount ?? 0) + n;
        i++;
        continue;
      }
      if (next && (KILO_WORDS.has(next) || unitMap.has(next))) {
        if (KILO_WORDS.has(next)) {
          fractionKg = (fractionKg ?? 0) + n;
          spokenWeightUnit = unitMap.get("کیلوگرم") ?? "کیلوگرم";
        } else {
          count = n;
          unit = unitMap.get(next) ?? next;
          hasStock = true;
          i++;
          continue;
        }
        i++;
        continue;
      }
      // اگر بعد از نام محصول آمده (سایز/شماره) → بخشی از نام
      if (nameTokens.length > 0 && !(next && isUnitWord(next, unitMap))) {
        nameTokens.push(t);
        continue;
      }
      count = n;
      hasStock = true;
      continue;
    }

    if (t in NUMBER_WORDS) {
      const n = NUMBER_WORDS[t];
      const next = tokens[i + 1];
      if (next && GRAM_WORDS.has(next)) {
        gramAmount = (gramAmount ?? 0) + n;
        i++;
        continue;
      }
      if (next && KILO_WORDS.has(next)) {
        fractionKg = (fractionKg ?? 0) + n;
        spokenWeightUnit = unitMap.get("کیلوگرم") ?? "کیلوگرم";
        i++;
        continue;
      }
      if (next && unitMap.has(next) && !KILO_WORDS.has(next) && !GRAM_WORDS.has(next)) {
        count = n;
        unit = unitMap.get(next)!;
        hasStock = true;
        i++;
        continue;
      }
      count = count === undefined ? n : count * n;
      hasStock = true;
      continue;
    }

    if (t in FRACTION_KG) {
      fractionKg = (fractionKg ?? 0) + FRACTION_KG[t];
      spokenWeightUnit = unitMap.get("کیلوگرم") ?? "کیلوگرم";
      continue;
    }

    if (KILO_WORDS.has(t)) {
      spokenWeightUnit = unitMap.get("کیلوگرم") ?? "کیلوگرم";
      continue;
    }
    if (GRAM_WORDS.has(t)) {
      spokenWeightUnit = unitMap.get("گرم") ?? "گرم";
      continue;
    }
    if (COUNT_WORDS.has(t) || (unitMap.has(t) && t !== COUNT_UNIT)) {
      if (unitMap.has(t)) unit = unitMap.get(t)!;
      continue;
    }
    if (unitMap.has(t)) {
      unit = unitMap.get(t)!;
      continue;
    }

    if (!PRICE_STOPWORDS.has(t)) nameTokens.push(t);
  }

  // محاسبه موجودی وزنی
  if (gramAmount !== undefined || fractionKg !== undefined) {
    let weightKg = 0;
    if (gramAmount !== undefined) weightKg += gramAmount / 1000;
    if (fractionKg !== undefined) weightKg += (count ?? 1) * fractionKg;
    else if (count !== undefined && spokenWeightUnit) weightKg += count;

    if (spokenWeightUnit === "گرم" || unit === "گرم") {
      stock = gramAmount ?? Math.round(weightKg * 1000);
      unit = "گرم";
    } else {
      stock = weightKg || count || 0;
      unit = spokenWeightUnit ?? "کیلوگرم";
    }
    hasStock = stock > 0;
  } else if (count !== undefined) {
    stock = count;
    hasStock = true;
  }

  if (!hasStock && isWeightUnit(unit)) {
    stock = 0;
  }

  return {
    stock,
    unit,
    name: nameTokens.join(" ").trim(),
  };
}

// ─── تقسیم جمله به چند محصول ───────────────────────────────────────────────────

function isQuantityOnlyBuffer(part: string): boolean {
  const tokens = part.split(" ").filter(Boolean);
  return tokens.every(
    (t) =>
      /^\d+(\.\d+)?$/.test(t) ||
      t in NUMBER_WORDS ||
      t in FRACTION_KG ||
      KILO_WORDS.has(t) ||
      GRAM_WORDS.has(t) ||
      COUNT_WORDS.has(t) ||
      t === "و",
  );
}

function isQuantityStarter(tokens: string[], idx: number, unitMap: Map<string, string>): boolean {
  const t = tokens[idx];
  // «هزار»/«میلیون» ضریب قیمت است، نه شروع قلم جدید
  if (isMultiplierWord(t) || CURRENCY_WORDS.has(t)) return false;
  if (t in FRACTION_KG) return true;
  if (t in NUMBER_WORDS) {
    // اگر بعدش نشانه‌ی قیمت است (مثلاً «دویست و پنجاه هزار») شروع قلم جدید نیست
    for (let j = idx + 1; j < tokens.length; j++) {
      const next = tokens[j];
      if (next === "و") continue;
      if (isPriceAnchor(next)) return false;
      if (tokenToNumber(next) !== undefined) continue;
      break;
    }
    return true;
  }
  if (/^\d+(\.\d+)?$/.test(t)) {
    const next = tokens[idx + 1];
    if (next && isPriceAnchor(next)) return false;
    if (next && isUnitWord(next, unitMap)) return true;
    // عدد کوچک در ابتدا → تعداد
    const n = parseFloat(t);
    return n < 1000;
  }
  return false;
}

function splitByQuantityBoundaries(segment: string, unitMap: Map<string, string>): string[] {
  const tokens = segment.split(" ").filter(Boolean);
  const clauses: string[] = [];
  let current: string[] = [];
  let sawNameToken = false;
  let sawQuantity = false;

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];
    if (isQuantityStarter(tokens, idx, unitMap) && sawNameToken && sawQuantity && current.length > 0) {
      clauses.push(current.join(" "));
      current = [];
      sawNameToken = false;
      sawQuantity = false;
    }
    current.push(t);
    if (isQuantityStarter(tokens, idx, unitMap)) sawQuantity = true;
    if (
      !isQuantityStarter(tokens, idx, unitMap) &&
      !isUnitWord(t, unitMap) &&
      t !== "و" &&
      !PRICE_STOPWORDS.has(t) &&
      !(t in MULTIPLIERS) &&
      !CURRENCY_WORDS.has(t) &&
      tokenToNumber(t) === undefined
    ) {
      sawNameToken = true;
    }
  }
  if (current.length > 0) clauses.push(current.join(" "));
  return clauses;
}

function hasProductNameTokens(segment: string, unitMap: Map<string, string>): boolean {
  const tokens = segment.split(" ").filter(Boolean);
  return tokens.some(
    (t) =>
      tokenToNumber(t) === undefined &&
      t !== "و" &&
      !isUnitWord(t, unitMap) &&
      !isPriceAnchor(t) &&
      !PRICE_STOPWORDS.has(t) &&
      !(t in FRACTION_KG),
  );
}

/** آیا «و» بین این دو توکن، جداکننده‌ی دو محصول است (نه «دویست و پنجاه») */
function isProductSeparatorAnd(tokens: string[], andIdx: number, unitMap: Map<string, string>): boolean {
  const prev = tokens[andIdx - 1];
  const next = tokens[andIdx + 1];
  if (!prev || !next) return false;
  // «دویست و پنجاه هزار» — و بین اعداد
  if (tokenToNumber(prev) !== undefined && tokenToNumber(next) !== undefined) return false;
  if (tokenToNumber(prev) !== undefined && isPriceAnchor(next)) return false;
  if (prev in NUMBER_WORDS && (next in NUMBER_WORDS || isPriceAnchor(next))) return false;
  // «یک کیلو و نیم»
  if (next in FRACTION_KG) return false;
  return true;
}

function splitIntoClauses(body: string, unitMap: Map<string, string>): string[] {
  const hardSegments = body
    .split(/،|,/)
    .map((s) => s.trim())
    .filter(Boolean);

  const clauses: string[] = [];
  for (const seg of hardSegments) {
    const tokens = seg.split(" ").filter(Boolean);
    const parts: string[] = [];
    let current: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === "و" && isProductSeparatorAnd(tokens, i, unitMap) && current.length > 0) {
        parts.push(current.join(" "));
        current = [];
        continue;
      }
      if (t === "و" && !isProductSeparatorAnd(tokens, i, unitMap)) {
        current.push(t);
        continue;
      }
      current.push(t);
    }
    if (current.length > 0) parts.push(current.join(" "));

    for (const m of parts) clauses.push(...splitByQuantityBoundaries(m, unitMap));
  }
  return clauses.map((c) => c.trim()).filter(Boolean);
}

// ─── تابع اصلی ────────────────────────────────────────────────────────────────

function parseProductClause(clause: string, unitMap: Map<string, string>): ParsedProductItem | null {
  const tokens = clause.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  const { price, restTokens } = extractPrice(tokens);
  const body = parseBody(restTokens, unitMap);

  if (!body.name && !price) return null;

  const confidence: ParsedProductItem["confidence"] =
    body.name.trim() && price !== undefined && price > 0 ? "high" : "partial";

  return {
    rawClause: clause,
    name: body.name.trim() || clause.trim(),
    stock: body.stock,
    unit: body.unit,
    price,
    confidence,
  };
}

export function parseProductVoiceText(
  rawTranscript: string,
  unitDefs?: UnitDef[],
): ParseProductResult {
  const normalized = normalizeFa(rawTranscript);
  if (!normalized) return { items: [] };

  const defs = unitDefs ?? getUnitDefs();
  const unitMap = buildUnitMaps(defs);
  const clauses = splitIntoClauses(normalized, unitMap);

  const items: ParsedProductItem[] = [];
  for (const clause of clauses) {
    const parsed = parseProductClause(clause, unitMap);
    if (parsed) items.push(parsed);
  }

  // اگر هیچ بخشی جدا نشد، کل متن را یک محصول فرض کن
  if (items.length === 0 && normalized) {
    const parsed = parseProductClause(normalized, unitMap);
    if (parsed) items.push(parsed);
  }

  return { items };
}
