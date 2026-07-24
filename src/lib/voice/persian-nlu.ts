/**
 * تحلیل‌گر محلی گفتار فارسیِ بازاری برای «ثبت صوتی فاکتور».
 *
 * هدف: تبدیل جمله‌ی محاوره‌ای فروشنده (مثل «دو عدد ربع گوجه و نیم کیلو پنیر»)
 * به آیتم‌های ساختاریافته: محصول واقعی موجود در انبار + مقدار عددی + واحد.
 *
 * این تحلیل‌گر کاملاً آفلاین و قطعی (deterministic) است و به‌عنوان موتور اصلی
 * استفاده می‌شود. در صورت پایین‌بودن اطمینان و وجود کلید LLM، می‌توان از
 * `parseVoiceInvoiceLLM` به‌عنوان جایگزین کمکی استفاده کرد.
 */

import { COUNT_UNIT, isWeightUnit, type Product, type PaymentMethod } from "@/lib/store";

export type ParsedCandidate = { product: Product; score: number };

export type ParsedItem = {
  /** متن خام این بخش از جمله (برای نمایش «شنیده شد») */
  rawClause: string;
  /** عبارت محصول که از جمله استخراج شده */
  productPhrase: string;
  /** مقدار نهایی به واحد محصول منتخب */
  quantity: number;
  /** واحد نهایی (عدد / کیلوگرم / گرم) */
  unit: string;
  /** بهترین تطبیق‌ها در انبار، مرتب‌شده بر اساس امتیاز */
  candidates: ParsedCandidate[];
  /**
   * سطح اطمینان:
   *  - high: یک تطبیق واضح → افزودن مستقیم
   *  - low: چند تطبیق نزدیک یا واحد نامطمئن → نیاز به تایید کاربر
   *  - none: محصولی یافت نشد
   */
  confidence: "high" | "low" | "none";
  /** کسر وزنی برای محصول عددی گفته شده (مثلاً «ربع» برای کالای عددی) → نیاز به تایید واحد */
  needsUnitConfirm?: boolean;
};

export type ParseResult = {
  items: ParsedItem[];
  customerName?: string;
  paymentMethod?: PaymentMethod;
};

// ─── نرمال‌سازی متن ───────────────────────────────────────────────────────────

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** ارقام فارسی/عربی → انگلیسی */
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

/** نرمال‌سازی کامل: حروف عربی→فارسی، حذف نیم‌فاصله/اعراب، یکسان‌سازی فاصله‌ها */
export function normalizeFa(input: string): string {
  let s = digitsToLatin(input);
  s = s
    .replace(/‌/g, " ") // نیم‌فاصله → فاصله
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ی")
    .replace(/[ةه]/g, "ه")
    .replace(/[ً-ْ]/g, "") // اعراب
    .replace(/[^؀-ۿ0-9a-zA-Z\s.]/g, " ") // علائم → فاصله
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

// ─── اعداد و کسرها ────────────────────────────────────────────────────────────

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
  // صدگان — برای مقادیر گرمی مثل «سیصد گرم» یا «هفتصد گرم» ضروری است
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
  هزار: 1000,
};

/** کلمات کسری وزنی → مقدار به کیلوگرم */
const FRACTION_KG: Record<string, number> = {
  ربع: 0.25,
  چارک: 0.25,
  یکچارک: 0.25,
  نیم: 0.5,
  نص: 0.5,
  سهچارک: 0.75,
};

/** واحدهای شمارشی (همگی به «عدد» نگاشت می‌شوند) */
const COUNT_WORDS = new Set(["عدد", "تا", "دونه", "دانه", "بسته", "شیشه", "بطری", "عددی", "تایی"]);
/** کلمات واحد کیلوگرم */
const KILO_WORDS = new Set(["کیلو", "کیلوگرم", "کیلوگرام", "کیلگرم"]);
/** کلمات واحد گرم */
const GRAM_WORDS = new Set(["گرم", "گرمی"]);

/** کلماتی که در عبارت محصول بی‌اهمیت‌اند و حذف می‌شوند */
const STOPWORDS = new Set([
  "و",
  "از",
  "یه",
  "یک",
  "تا",
  "عدد",
  "عددی",
  "تایی",
  "دونه",
  "دانه",
  "کیلو",
  "کیلوگرم",
  "کیلوگرام",
  "گرم",
  "گرمی",
  "بسته",
  "شیشه",
  "بطری",
  "ربع",
  "چارک",
  "نیم",
  "نص",
  "سهچارک",
  "یکچارک",
  "لطفا",
  "بده",
  "بزن",
  "اضافه",
  "کن",
  "میخوام",
  "خواستم",
]);

// ─── استخراج مشتری و روش پرداخت ───────────────────────────────────────────────

function extractPaymentMethod(s: string): { method?: PaymentMethod; rest: string } {
  let rest = s;
  let method: PaymentMethod | undefined;
  if (/نسیه/.test(rest)) {
    method = "credit";
    rest = rest.replace(/نسیه/g, " ");
  } else if (/کارتخوان|کارت/.test(rest)) {
    method = "card";
    rest = rest.replace(/کارتخوان|کارت/g, " ");
  } else if (/(^|\s)نقد(ی|ا)?(\s|$)/.test(rest)) {
    method = "cash";
    rest = rest.replace(/(^|\s)نقد(ی|ا)?(\s|$)/g, " ");
  }
  return { method, rest: rest.replace(/\s+/g, " ").trim() };
}

function extractCustomer(s: string): { name?: string; rest: string } {
  // «برای رضا» / «واسه آقای رضایی» — حداکثر دو توکن بعد از «برای/واسه»
  const m = s.match(/(?:برای|واسه|به اسم)\s+(\S+(?:\s+\S+)?)/);
  if (!m) return { rest: s };
  const name = m[1].trim();
  const rest = (s.slice(0, m.index) + " " + s.slice((m.index ?? 0) + m[0].length))
    .replace(/\s+/g, " ")
    .trim();
  return { name, rest };
}

// ─── تجزیه‌ی یک بخش (clause) به مقدار/واحد/عبارت محصول ────────────────────────

type ClauseParse = {
  count?: number; // تعداد عددی
  weightKg?: number; // مقدار وزنی محاسبه‌شده به کیلوگرم
  spokenUnit?: "kg" | "gram" | "count";
  usedFraction: boolean;
  productPhrase: string;
};

function parseClause(clause: string): ClauseParse {
  const tokens = clause.split(" ").filter(Boolean);
  let count: number | undefined;
  let fractionKg: number | undefined;
  let spokenUnit: "kg" | "gram" | "count" | undefined;
  let gramAmount: number | undefined;
  const productTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // عدد به‌صورت رقم
    if (/^\d+(\.\d+)?$/.test(t)) {
      const n = parseFloat(t);
      // اگر بلافاصله بعدش «گرم» بیاید → مقدار گرمی
      const next = tokens[i + 1];
      if (next && GRAM_WORDS.has(next)) {
        gramAmount = n;
        spokenUnit = "gram";
        i++;
        continue;
      }
      if (next && KILO_WORDS.has(next)) {
        fractionKg = (fractionKg ?? 0) + n;
        spokenUnit = "kg";
        i++;
        continue;
      }
      count = (count ?? 1) * n;
      continue;
    }

    // عدد به‌صورت کلمه
    if (t in NUMBER_WORDS) {
      const n = NUMBER_WORDS[t];
      // اگر بلافاصله بعدش «گرم» بیاید → مقدار گرمی (مثلاً «هفتصد گرم»)
      const next = tokens[i + 1];
      if (next && GRAM_WORDS.has(next)) {
        gramAmount = (gramAmount ?? 0) + n;
        spokenUnit = spokenUnit ?? "gram";
        i++;
        continue;
      }
      // اگر بلافاصله بعدش «کیلو» بیاید → مقدار کیلویی (مثلاً «یک کیلو»، «دو کیلو»)
      // این حالت باید دقیقاً مثل حالت رقمی («2 کیلو») در fractionKg جمع شود، وگرنه
      // وقتی با یک مقدار گرمی ترکیب شود (مثلاً «یک کیلو و 100 گرم») بخش کیلویی گم
      // می‌شود چون در انتها فقط به‌عنوان count باقی می‌ماند و هرگز با وزن جمع نمی‌شود.
      if (next && KILO_WORDS.has(next)) {
        fractionKg = (fractionKg ?? 0) + n;
        spokenUnit = "kg";
        i++;
        continue;
      }
      count = count === undefined ? n : count * n;
      continue;
    }

    // کسر وزنی
    if (t in FRACTION_KG) {
      fractionKg = (fractionKg ?? 0) + FRACTION_KG[t];
      spokenUnit = "kg";
      continue;
    }

    // واحدها
    if (KILO_WORDS.has(t)) {
      spokenUnit = "kg";
      continue;
    }
    if (GRAM_WORDS.has(t)) {
      spokenUnit = "gram";
      continue;
    }
    if (COUNT_WORDS.has(t)) {
      if (!spokenUnit) spokenUnit = "count";
      continue;
    }

    // «و نیم» بعد از کیلو (یک و نیم) — نیم به‌عنوان کسر بالا گرفته می‌شود
    if (!STOPWORDS.has(t)) productTokens.push(t);
  }

  // محاسبه‌ی وزن نهایی به کیلوگرم
  let weightKg: number | undefined;
  if (gramAmount !== undefined) {
    weightKg = (weightKg ?? 0) + gramAmount / 1000;
    spokenUnit = spokenUnit ?? "gram";
  }
  if (fractionKg !== undefined) {
    // «دو ربع» → 2 × 0.25 ؛ ضرب تعداد در کسر
    const mult = count ?? 1;
    weightKg = (weightKg ?? 0) + mult * fractionKg;
    spokenUnit = "kg";
    // تعداد در این حالت بخشی از وزن است، نه شمارش جداگانه
    if (count !== undefined && fractionKg !== undefined) count = undefined;
  } else if (spokenUnit === "kg" && count !== undefined) {
    // «دو کیلو» → عدد به‌عنوان وزن؛ اگر مقدار گرمی هم گفته شده باشد
    // (مثلاً «دو کیلو و هفتصد گرم») با آن جمع می‌شود، نه جایگزین آن
    weightKg = (weightKg ?? 0) + count;
    count = undefined;
  }

  return {
    count,
    weightKg,
    spokenUnit,
    usedFraction: fractionKg !== undefined,
    productPhrase: productTokens.join(" ").trim(),
  };
}

// ─── تطبیق محصول با انبار ─────────────────────────────────────────────────────

function scoreProduct(phrase: string, productName: string): number {
  const a = normalizeFa(phrase);
  const b = normalizeFa(productName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.85;

  const at = a.split(" ").filter(Boolean);
  const bt = b.split(" ").filter(Boolean);
  if (at.length === 0 || bt.length === 0) return 0;
  let hits = 0;
  for (const tok of at) {
    if (bt.some((x) => x === tok || x.includes(tok) || tok.includes(x))) hits++;
  }
  const overlap = hits / Math.max(at.length, bt.length);
  return overlap >= 0.5 ? 0.5 + overlap * 0.3 : overlap * 0.6;
}

function matchProducts(phrase: string, products: Product[]): ParsedCandidate[] {
  const scored = products
    .map((product) => ({ product, score: scoreProduct(phrase, product.name) }))
    .filter((c) => c.score > 0.25)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 4);
}

// ─── جمع‌بندی واحد و مقدار بر اساس محصول منتخب ────────────────────────────────

function reconcile(
  clause: ClauseParse,
  product: Product,
): { quantity: number; unit: string; needsUnitConfirm: boolean } {
  const productUnit = product.unit && product.unit.trim() ? product.unit : COUNT_UNIT;
  const productIsWeight = isWeightUnit(productUnit);

  // محصول وزنی
  if (productIsWeight) {
    if (clause.weightKg !== undefined) {
      const qty = productUnit === "گرم" ? Math.round(clause.weightKg * 1000) : clause.weightKg;
      return { quantity: qty, unit: productUnit, needsUnitConfirm: false };
    }
    if (clause.count !== undefined) {
      // عدد بدون واحد برای کالای وزنی → فرض کیلوگرم ولی با تایید
      const qty = productUnit === "گرم" ? clause.count : clause.count;
      return { quantity: qty, unit: productUnit, needsUnitConfirm: true };
    }
    return { quantity: 1, unit: productUnit, needsUnitConfirm: true };
  }

  // محصول عددی
  if (clause.count !== undefined) {
    return { quantity: clause.count, unit: COUNT_UNIT, needsUnitConfirm: false };
  }
  if (clause.weightKg !== undefined || clause.usedFraction) {
    // کسر/وزن برای کالای عددی منطقی نیست → تایید لازم است (طبق نیازمندی)
    return { quantity: 1, unit: COUNT_UNIT, needsUnitConfirm: true };
  }
  // فقط نام کالا گفته شده → پیش‌فرض ۱
  return { quantity: 1, unit: COUNT_UNIT, needsUnitConfirm: false };
}

// ─── تابع اصلی ────────────────────────────────────────────────────────────────

/**
 * آیا این توکن، شروع یک عبارت مقداری جدید است (رقم، عدد نوشتاری، یا کسر وزنی)؟
 * برای تشخیص مرز بین دو قلم کالا وقتی فروشنده بدون «و» پشت سر هم می‌گوید
 * (مثلاً «۲ تا شیر ۳ تا پنیر صبا ۴ تا دستمال»).
 */
function isQuantityStarter(t: string): boolean {
  return /^\d+(\.\d+)?$/.test(t) || t in NUMBER_WORDS || t in FRACTION_KG;
}

function isUnitOrCountWord(t: string): boolean {
  return COUNT_WORDS.has(t) || KILO_WORDS.has(t) || GRAM_WORDS.has(t);
}

/**
 * یک بخش را در مرزهای «قلم جدید» می‌شکند: هر بار که بعد از دیدن حداقل یک
 * کلمه‌ی محصول، دوباره یک عدد/کسر جدید شروع شود، یعنی قلم بعدی شروع شده —
 * حتی اگر فروشنده هیچ «و»ی بین دو قلم نگفته باشد.
 */
function splitByQuantityBoundaries(segment: string): string[] {
  const tokens = segment.split(" ").filter(Boolean);
  const clauses: string[] = [];
  let current: string[] = [];
  let sawProductToken = false;

  for (const t of tokens) {
    if (isQuantityStarter(t) && sawProductToken && current.length > 0) {
      clauses.push(current.join(" "));
      current = [];
      sawProductToken = false;
    }
    current.push(t);
    if (!isQuantityStarter(t) && !isUnitOrCountWord(t) && t !== "و" && !STOPWORDS.has(t)) {
      sawProductToken = true;
    }
  }
  if (current.length > 0) clauses.push(current.join(" "));
  return clauses;
}

/**
 * تقسیم کل جمله به بخش‌های قلم‌به‌قلم — قوی‌تر از یک split ساده:
 *  ۱) ابتدا با «،»/«,» جدا می‌شود (جداکننده‌ی قطعی).
 *  ۲) سپس با « و » جدا می‌شود، مگر وقتی «و» بخشی از اصطلاح کسری باشد
 *     («یک کیلو و نیم») که در این حالت با بخش قبلی ادغام می‌ماند.
 *  ۳) در نهایت هر بخش با تشخیص مرز مقدار/کسر جدید، دوباره شکسته می‌شود تا
 *     فهرست پشت‌سرهم بدون «و» هم درست جدا شود.
 */
/**
 * آیا این بخش («part») تا این‌جا فقط شامل عدد/واحد است و هنوز هیچ نام کالایی
 * در آن گفته نشده؟ برای تشخیص اینکه آیا هنوز داریم مقدار را کامل می‌کنیم
 * (مثلاً «دو کیلو») یا کالا شروع شده است.
 */
function isQuantityOnlyBuffer(part: string): boolean {
  const tokens = part.split(" ").filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every(
    (t) =>
      /^\d+(\.\d+)?$/.test(t) ||
      t in NUMBER_WORDS ||
      t in FRACTION_KG ||
      KILO_WORDS.has(t) ||
      GRAM_WORDS.has(t) ||
      COUNT_WORDS.has(t),
  );
}

function splitIntoClauses(body: string): string[] {
  const hardSegments = body
    .split(/،|,/)
    .map((s) => s.trim())
    .filter(Boolean);

  const clauses: string[] = [];
  for (const seg of hardSegments) {
    const parts = seg.split(/\s+و\s+/).filter(Boolean);
    const merged: string[] = [];
    for (const part of parts) {
      const firstWord = part.split(" ")[0];
      const isFractionContinuation = merged.length > 0 && firstWord in FRACTION_KG;
      // ادامه‌ی مقدار وزنی مرکب («دو کیلو و هفتصد گرم گوجه») — وقتی بخش قبلی
      // هنوز فقط عدد/واحد بوده (نام کالایی نداشته) و بخش بعدی هم با یک عدد
      // شروع می‌شود، این دو باید یک قلم واحد به‌حساب بیایند.
      const isWeightContinuation =
        merged.length > 0 &&
        isQuantityOnlyBuffer(merged[merged.length - 1]) &&
        (/^\d+(\.\d+)?$/.test(firstWord) || firstWord in NUMBER_WORDS);
      if (isFractionContinuation || isWeightContinuation) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} و ${part}`;
      } else {
        merged.push(part);
      }
    }
    for (const m of merged) clauses.push(...splitByQuantityBoundaries(m));
  }
  return clauses.map((c) => c.trim()).filter(Boolean);
}

export function parseVoiceText(rawTranscript: string, products: Product[]): ParseResult {
  const normalized = normalizeFa(rawTranscript);
  if (!normalized) return { items: [] };

  // استخراج روش پرداخت و مشتری از کل جمله
  const pay = extractPaymentMethod(normalized);
  const cust = extractCustomer(pay.rest);
  const body = cust.rest;

  // تقسیم به بخش‌ها: جداکننده‌ی صریح («و»/«،») + تشخیص مرز قلم جدید حتی
  // بدون جداکننده (پشت‌سرهم گفتن چند قلم)
  const clauses = splitIntoClauses(body);

  const items: ParsedItem[] = [];
  for (const clause of clauses) {
    const parsed = parseClause(clause);
    if (!parsed.productPhrase) continue;

    const candidates = matchProducts(parsed.productPhrase, products);

    if (candidates.length === 0) {
      items.push({
        rawClause: clause,
        productPhrase: parsed.productPhrase,
        quantity: parsed.count ?? parsed.weightKg ?? 1,
        unit:
          parsed.spokenUnit === "kg"
            ? "کیلوگرم"
            : parsed.spokenUnit === "gram"
              ? "گرم"
              : COUNT_UNIT,
        candidates: [],
        confidence: "none",
      });
      continue;
    }

    const best = candidates[0];
    const rec = reconcile(parsed, best.product);

    // اطمینان: تطبیق واضح وقتی بهترین امتیاز بالا و به‌اندازه‌ی کافی جلوتر از دومی باشد
    const second = candidates[1];
    const clearWinner = best.score >= 0.6 && (!second || best.score - second.score >= 0.2);
    const confidence: ParsedItem["confidence"] =
      clearWinner && !rec.needsUnitConfirm ? "high" : "low";

    items.push({
      rawClause: clause,
      productPhrase: parsed.productPhrase,
      quantity: rec.quantity,
      unit: rec.unit,
      candidates,
      confidence,
      needsUnitConfirm: rec.needsUnitConfirm,
    });
  }

  return {
    items,
    customerName: cust.name,
    paymentMethod: pay.method,
  };
}
