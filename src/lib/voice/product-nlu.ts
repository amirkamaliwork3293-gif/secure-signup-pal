/**
 * تحلیل‌گر محلی گفتار فارسی برای «ثبت صوتی محصولات».
 *
 * جمله‌ی محاوره‌ای (مثل «بیست عدد پیراهن مشکی دویست و پنجاه هزار تومن»)
 * به فیلدهای ساختاریافته تبدیل می‌شود: نام، موجودی/تعداد، واحد، قیمت (تومان).
 */

import { COUNT_UNIT, getUnitDefs, isWeightUnit, type UnitDef } from "@/lib/store";
import { normalizeFa } from "@/lib/voice/persian-nlu";
import {
  CURRENCY_WORDS,
  MULTIPLIERS,
  NUMBER_WORDS,
  extractLastAnchoredAmount,
  isCurrencyWord,
  isMultiplierWord,
  tokenToNumber,
} from "@/lib/voice/fa-amount";

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

function isPriceAnchor(t: string): boolean {
  return isMultiplierWord(t) || isCurrencyWord(t);
}

// ─── استخراج قیمت ─────────────────────────────────────────────────────────────

type PriceExtract = { price?: number; restTokens: string[] };

function extractPrice(tokens: string[]): PriceExtract {
  if (tokens.length === 0) return { restTokens: [] };
  const hit = extractLastAnchoredAmount(tokens);
  if (!hit) return { restTokens: tokens };
  const rest = [...tokens.slice(0, hit.from), ...tokens.slice(hit.to)].filter(
    (t, i, arr) => !(t === "قیمت" || t === "هر" || (t === "با" && i === arr.length - 1)),
  );
  return { price: hit.amount, restTokens: rest };
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
function isProductSeparatorAnd(tokens: string[], andIdx: number, _unitMap: Map<string, string>): boolean {
  const prev = tokens[andIdx - 1];
  const next = tokens[andIdx + 1];
  if (!prev || !next) return false;
  // «دویست و پنجاه هزار» / «یک میلیون و پانصد هزار» — و داخل مبلغ
  if (tokenToNumber(prev) !== undefined && tokenToNumber(next) !== undefined) return false;
  if (tokenToNumber(prev) !== undefined && isPriceAnchor(next)) return false;
  if (isMultiplierWord(prev) && (tokenToNumber(next) !== undefined || isPriceAnchor(next))) return false;
  if (prev in NUMBER_WORDS && (next in NUMBER_WORDS || isPriceAnchor(next))) return false;
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
