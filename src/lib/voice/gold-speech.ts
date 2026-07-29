import { normalizeFa } from "@/lib/voice/persian-nlu";

/**
 * تبدیل گفتار فارسی طلافروشی به وزن/عیار/اجرت.
 * نمونه‌ها: «دو گرم و دو سوت»، «۳ گرم عیار ۱۸ اجرت ۷ درصد»، «نیم گرم».
 * هر «سوت» = ۰.۰۰۱ گرم.
 */

const WORDS: Record<string, number> = {
  صفر: 0, یک: 1, یه: 1, دو: 2, سه: 3, چهار: 4, چار: 4, پنج: 5, شش: 6, شیش: 6,
  هفت: 7, هشت: 8, نه: 9, ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14,
  پانزده: 15, پونزده: 15, شانزده: 16, شونزده: 16, هفده: 17, هجده: 18, نوزده: 19,
  بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90,
  صد: 100, دویست: 200, سیصد: 300, چهارصد: 400, پانصد: 500, ششصد: 600,
  هفتصد: 700, هشتصد: 800, نهصد: 900, هزار: 1000,
  نیم: 0.5, ربع: 0.25,
};

/** عدد بلافاصله قبل از یک کلیدواژه را برمی‌گرداند (رقمی یا حرفی) */
function numberBefore(tokens: string[], idx: number): number | null {
  let total = 0;
  let found = false;
  for (let i = idx - 1; i >= 0 && i >= idx - 4; i--) {
    const t = tokens[i];
    if (t === "و") continue;
    if (/^\d+(\.\d+)?$/.test(t)) {
      total += parseFloat(t);
      found = true;
      continue;
    }
    if (t in WORDS) {
      total += WORDS[t];
      found = true;
      continue;
    }
    break;
  }
  return found ? total : null;
}

function numberAfter(tokens: string[], idx: number): number | null {
  for (let i = idx + 1; i <= idx + 3 && i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "درصد" || t === "عیار" || t === "و") continue;
    if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    if (t in WORDS) return WORDS[t];
  }
  return null;
}

export type GoldVoiceParse = {
  grams: number | null;
  suut: number | null;
  karat: number | null;
  wagePercent: number | null;
  raw: string;
};

export function parseGoldVoice(input: string): GoldVoiceParse {
  const text = normalizeFa(input);
  const tokens = text.split(" ").filter(Boolean);
  const out: GoldVoiceParse = { grams: null, suut: null, karat: null, wagePercent: null, raw: text };

  tokens.forEach((t, i) => {
    if (t === "گرم" || t === "گرمی") {
      const n = numberBefore(tokens, i);
      if (n !== null) out.grams = (out.grams ?? 0) + n;
    } else if (t === "سوت" || t === "سوط") {
      const n = numberBefore(tokens, i);
      if (n !== null) out.suut = (out.suut ?? 0) + n;
    } else if (t === "مثقال") {
      const n = numberBefore(tokens, i);
      if (n !== null) out.grams = (out.grams ?? 0) + n * 4.6083;
    } else if (t === "عیار") {
      const n = numberAfter(tokens, i) ?? numberBefore(tokens, i);
      if (n !== null && n >= 10 && n <= 24) out.karat = n;
    } else if (t === "اجرت" || t === "اجرات") {
      const n = numberAfter(tokens, i);
      if (n !== null) out.wagePercent = n;
    }
  });

  // «۲ و ۲ سوت» بدون کلمه گرم → عدد اول گرم است
  if (out.grams === null && out.suut !== null) {
    const first = tokens.find((t) => /^\d+(\.\d+)?$/.test(t) || t in WORDS);
    if (first) out.grams = /^\d/.test(first) ? parseFloat(first) : WORDS[first];
  }
  return out;
}
