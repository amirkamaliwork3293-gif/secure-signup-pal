/**
 * تحلیل‌گر سبک متن/گفتار فارسی مخصوص محاسبه‌گر طلا.
 * کاملاً مستقل از lib/voice/persian-nlu.ts (که برای اقلام فاکتور است) — هیچ فایل دیگری را تغییر نمی‌دهد.
 *
 * نمونه‌های قابل تشخیص:
 *   «پنج گرم و دویست طلای هجده عیار با ده درصد اجرت»
 *   «سه مثقال طلای بیست و یک عیار دست دوم»
 *   «یک ربع سکه»
 */

import { GRAMS_PER_MESGHAL, type CoinTypeId } from "./gold-calc";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function digitsToLatin(s: string): string {
  let out = "";
  for (const ch of s) {
    const fi = FA_DIGITS.indexOf(ch);
    const ai = AR_DIGITS.indexOf(ch);
    if (fi >= 0) out += String(fi);
    else if (ai >= 0) out += String(ai);
    else out += ch;
  }
  return out;
}

// اعداد نوشتاری فارسیِ پرکاربرد (فقط محدوده‌ای که در وزن/درصد رایج است)
const WORD_NUMBERS: Record<string, number> = {
  صفر: 0, یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10,
  یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, شانزده: 16, هفده: 17, هجده: 18, نوزده: 19,
  بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90,
  صد: 100, دویست: 200, سیصد: 300,
  نیم: 0.5, ربع: 0.25,
};

function wordNumbersToDigits(text: string): string {
  // ترکیب‌های «بیست و یک» → 21 (ساده، فقط جمع دو واژه‌ی متوالی که هر دو عدد نوشتاری‌اند)
  const tokens = text.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/[،,]/g, "");
    if (t === "و" && i > 0 && i < tokens.length - 1) {
      const prev = WORD_NUMBERS[tokens[i - 1]];
      const next = WORD_NUMBERS[tokens[i + 1]];
      if (prev !== undefined && next !== undefined && prev >= 20 && next < 10) {
        out.pop();
        out.push(String(prev + next));
        i++; // از عدد بعدی هم صرف‌نظر کن، جایگزین شد
        continue;
      }
    }
    if (WORD_NUMBERS[t] !== undefined) out.push(String(WORD_NUMBERS[t]));
    else out.push(tokens[i]);
  }
  return out.join(" ");
}

function normalize(raw: string): string {
  let s = digitsToLatin(raw.trim());
  s = wordNumbersToDigits(s);
  return s;
}

export type ParsedGoldVoice = {
  weightGrams?: number;
  karat?: number;
  wagePercent?: number;
  profitPercent?: number;
  taxPercent?: number;
  secondHand?: boolean;
  coinType?: CoinTypeId;
  coinQuantity?: number;
};

const KARAT_WORDS: Record<string, number> = {
  "24": 24, "بيست و چهار": 24, "بیست و چهار": 24,
  "22": 22, "بیست و دو": 22,
  "21": 21, "بیست و یک": 21,
  "18": 18, "هجده": 18,
  "14": 14, "چهارده": 14,
};

export function parseGoldVoice(rawText: string): ParsedGoldVoice {
  const text = normalize(rawText);
  const result: ParsedGoldVoice = {};

  // سکه — چون واحد جداگانه‌ای دارد، اول بررسی می‌شود
  if (/امامی/.test(text)) result.coinType = "emami";
  else if (/بهار\s*آزادی/.test(text)) result.coinType = "bahar";
  else if (/نیم\s*سکه|0\.5\s*سکه/.test(text)) result.coinType = "half";
  else if (/ربع\s*سکه|0\.25\s*سکه/.test(text)) result.coinType = "quarter";
  else if (/سکه\s*گرمی|گرمی\s*سکه/.test(text)) result.coinType = "gerami";
  else if (/سکه/.test(text)) result.coinType = "emami"; // پیش‌فرض معقول وقتی فقط «سکه» گفته شود

  if (result.coinType) {
    const qtyMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:تا|عدد)?\s*سکه/);
    result.coinQuantity = qtyMatch ? Number(qtyMatch[1]) : 1;
  }

  // وزن: «X گرم» یا «X مثقال»
  const gramMatch = text.match(/(\d+(?:\.\d+)?)\s*گرم/);
  const mesghalMatch = text.match(/(\d+(?:\.\d+)?)\s*مثقال/);
  if (mesghalMatch) {
    result.weightGrams = Number(mesghalMatch[1]) * GRAMS_PER_MESGHAL;
  } else if (gramMatch) {
    result.weightGrams = Number(gramMatch[1]);
  }

  // عیار
  for (const [word, karat] of Object.entries(KARAT_WORDS)) {
    if (new RegExp(`${word}\\s*عیار`).test(text)) {
      result.karat = karat;
      break;
    }
  }

  // اجرت / سود / مالیات به‌صورت درصد
  const wageMatch = text.match(/(\d+(?:\.\d+)?)\s*درصد\s*اجرت|اجرت\s*(\d+(?:\.\d+)?)\s*درصد/);
  if (wageMatch) result.wagePercent = Number(wageMatch[1] ?? wageMatch[2]);

  const profitMatch = text.match(/(\d+(?:\.\d+)?)\s*درصد\s*سود|سود\s*(\d+(?:\.\d+)?)\s*درصد/);
  if (profitMatch) result.profitPercent = Number(profitMatch[1] ?? profitMatch[2]);

  const taxMatch = text.match(/(\d+(?:\.\d+)?)\s*درصد\s*مالیات|مالیات\s*(\d+(?:\.\d+)?)\s*درصد/);
  if (taxMatch) result.taxPercent = Number(taxMatch[1] ?? taxMatch[2]);

  // دست دوم / آب‌شده / بدون اجرت → اجرت صفر
  if (/دست\s*دوم|آب\s*شده|بدون\s*اجرت|بی\s*اجرت/.test(text)) {
    result.secondHand = true;
    result.wagePercent = 0;
  }

  return result;
}
