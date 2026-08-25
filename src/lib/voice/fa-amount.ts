/**
 * پارس مبلغ فارسی — مشترک بین دستیار، ثبت محصول و ثبت فاکتور.
 *
 * «یک میلیون و پانصد هزار تومان» باید یک مبلغ ۱٬۵۰۰٬۰۰۰ باشد، نه دو عدد جدا.
 */

export const NUMBER_WORDS: Record<string, number> = {
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

export const MULTIPLIERS: Record<string, number> = {
  هزار: 1000,
  هزارتا: 1000,
  میلیون: 1_000_000,
  ملیون: 1_000_000,
  میلیارد: 1_000_000_000,
  ملیارد: 1_000_000_000,
};

export const CURRENCY_WORDS = new Set(["تومان", "تومن", "ریال"]);

export function tokenToNumber(t: string): number | undefined {
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  return undefined;
}

export function isMultiplierWord(t: string): boolean {
  return t in MULTIPLIERS;
}

export function isCurrencyWord(t: string): boolean {
  return CURRENCY_WORDS.has(t);
}

export function isNumberToken(t: string): boolean {
  return tokenToNumber(t) !== undefined || isMultiplierWord(t);
}

/** این توکن بخشی از عبارت مبلغ است (عدد، ضریب، واحد پول، «و») */
export function isAmountToken(t: string): boolean {
  return t === "و" || isNumberToken(t) || isCurrencyWord(t) || t === "قیمت" || t === "هر";
}

export type AmountRun = {
  amount: number;
  from: number;
  to: number;
  hasAnchor: boolean;
};

/**
 * همه‌ی عبارت‌های عددی یک جمله.
 * «یک میلیون و پانصد هزار تومان» → یک run با amount=1500000
 */
export function collectAmountRuns(tokens: string[]): AmountRun[] {
  const runs: AmountRun[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isNumberToken(tokens[i])) {
      i++;
      continue;
    }
    let j = i;
    let total = 0;
    let current = 0;
    let hasAnchor = false;
    while (j < tokens.length) {
      const t = tokens[j];
      if (t === "و" && j + 1 < tokens.length && isNumberToken(tokens[j + 1])) {
        j++;
        continue;
      }
      if (t in MULTIPLIERS) {
        total += (current || 1) * MULTIPLIERS[t];
        current = 0;
        hasAnchor = true;
        j++;
        continue;
      }
      const n = tokenToNumber(t);
      if (n === undefined) break;
      current += n;
      j++;
    }
    let end = j;
    let rial = false;
    if (end < tokens.length && CURRENCY_WORDS.has(tokens[end])) {
      rial = tokens[end] === "ریال";
      hasAnchor = true;
      end++;
    }
    let amount = total + current;
    if (rial) amount = Math.round(amount / 10);
    if (amount > 0) runs.push({ amount, from: i, to: end, hasAnchor });
    i = Math.max(end, i + 1);
  }
  return runs;
}

/** آخرین مبلغ «لنگر‌دار» (هزار/میلیون/تومان) — معمولاً قیمت واحد */
export function extractLastAnchoredAmount(
  tokens: string[],
): { amount: number; from: number; to: number } | null {
  const runs = collectAmountRuns(tokens);
  const anchored = runs.filter((r) => r.hasAnchor);
  const pool = anchored.length > 0 ? anchored : runs.filter((r) => r.amount >= 1000);
  const chosen = pool[pool.length - 1];
  if (!chosen) return null;
  return { amount: chosen.amount, from: chosen.from, to: chosen.to };
}

/**
 * قیمت واحد را از انتهای جمله جدا می‌کند («هر عدد یک میلیون و پانصد هزار تومان»).
 * تعداد (۲۰ تا) در rest می‌ماند.
 */
export function peelUnitPrice(tokens: string[]): { unitPrice?: number; rest: string[] } {
  const hit = extractLastAnchoredAmount(tokens);
  if (!hit) return { rest: tokens };
  const before = tokens.slice(Math.max(0, hit.from - 3), hit.from);
  const marked = before.some((t) => t === "هر" || t === "قیمت" || t === "عدد" || t === "کدوم" || t === "کدام");
  if (!marked && !collectAmountRuns(tokens).some((r) => r.hasAnchor && r.from === hit.from)) {
    return { rest: tokens };
  }
  const rest = [...tokens.slice(0, hit.from), ...tokens.slice(hit.to)].filter(
    (t) => t !== "قیمت" && t !== "هر" && t !== "کدوم" && t !== "کدام",
  );
  return { unitPrice: hit.amount, rest };
}
