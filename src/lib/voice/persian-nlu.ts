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
import {
  NUMBER_WORDS,
  isCurrencyWord,
  isMultiplierWord,
  peelUnitPrice,
  tokenToNumber,
} from "@/lib/voice/fa-amount";

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
   *  - none: محصولی در فهرست نبود — می‌توان به‌صورت ردیف آزاد ثبت کرد
   */
  confidence: "high" | "low" | "none";
  /** قیمت واحد گفته‌شده («هر عدد یک میلیون») — اگر نباشد از قیمت کالا استفاده می‌شود */
  unitPrice?: number;
  /** کسر وزنی برای محصول عددی گفته شده (مثلاً «ربع» برای کالای عددی) → نیاز به تایید واحد */
  needsUnitConfirm?: boolean;
};

export type ParseResult = {
  items: ParsedItem[];
  customerName?: string;
  /** موبایل ایرانی نرمال‌شده (۰۹xxxxxxxxx) اگر در جمله گفته شده باشد */
  customerPhone?: string;
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
const KILO_WORDS = new Set(["کیلو", "کیلوگرم", "کیلوگرام", "کیلگرم", "گیلو", "گیلوگرم"]);
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
  "گیلو",
  "گیلوگرم",
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
  "قیمت",
  "تومان",
  "تومن",
  "ریال",
  "هر",
  "میلیون",
  "ملیون",
  "هزار",
  "میلیارد",
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

const NAME_HONORIFICS = new Set([
  "اقا",
  "اقای",
  "خانم",
  "خانوم",
  "جناب",
  "حاج",
  "حاجی",
  "مهندس",
  "دکتر",
  "سید",
  "استاد",
  "سرکار",
]);

const CUSTOMER_STOP = new Set([
  "با",
  "شماره",
  "تلفن",
  "موبایل",
  "همراه",
  "نسیه",
  "نقد",
  "نقدی",
  "کارت",
  "کارتخوان",
  "و",
]);

/** موبایل ایرانی → ۰۹xxxxxxxxx (ارقام جمله قبلاً لاتین شده‌اند) */
function compactIranMobile(raw: string): string | undefined {
  const d = raw.replace(/\s+/g, "");
  let national = d;
  if (d.startsWith("98") && d.length === 12) national = "0" + d.slice(2);
  else if (/^9\d{9}$/.test(d)) national = "0" + d;
  return /^09\d{9}$/.test(national) ? national : undefined;
}

function extractPhone(s: string): { phone?: string; rest: string } {
  const keyword = s.match(
    /(?:با\s+)?(?:شماره\s+)?(?:تلفن|موبایل|همراه)(?:\s+شماره)?\s*((?:98|0)?9(?:\s*\d){9})/,
  );
  const withNumber = keyword
    ? null
    : s.match(/با\s+شماره\s*((?:98|0)?9(?:\s*\d){9})/);
  const hit = keyword || withNumber;
  if (hit) {
    const phone = compactIranMobile(hit[1]);
    if (phone) {
      const rest = (s.slice(0, hit.index) + " " + s.slice((hit.index ?? 0) + hit[0].length))
        .replace(/\s+/g, " ")
        .trim();
      return { phone, rest };
    }
  }
  if (/(برای|واسه|به اسم|به نام|اقای|اقا|خانم|خانوم|شماره|تلفن)/.test(s)) {
    const end = s.match(/((?:98|0)?9(?:\s*\d){9})\s*$/);
    if (end) {
      const phone = compactIranMobile(end[1]);
      if (phone) return { phone, rest: s.slice(0, end.index).replace(/\s+/g, " ").trim() };
    }
  }
  return { rest: s };
}

/** موبایل گفته‌شده در جمله، نرمال به ۰۹xxxxxxxxx */
export function extractSpokenMobile(input: string): string | undefined {
  return extractPhone(normalizeFa(input)).phone;
}

export function stripSpokenMobile(input: string): string {
  const phone = extractSpokenMobile(input);
  let s = normalizeFa(input);
  s = s.replace(/(?:با\s+)?(?:شماره\s+)?(?:تلفن|موبایل|همراه)(?:\s+شماره)?/g, " ");
  if (phone) {
    const bare = phone.replace(/^0/, "");
    s = s.replace(new RegExp(`(?:98|0)?${bare}`, "g"), " ");
  } else {
    s = s.replace(/(?:98|0)?9\d{9}/g, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function hasQuantityCue(s: string): boolean {
  if (/\d+(\.\d+)?\s*(تا|عدد|کیلو|گرم|دونه|دونا)/.test(s)) return true;
  const tokens = s.split(" ").filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!(tokens[i] in NUMBER_WORDS) && !/^\d+(\.\d+)?$/.test(tokens[i])) continue;
    if (COUNT_WORDS.has(tokens[i + 1]) || KILO_WORDS.has(tokens[i + 1]) || GRAM_WORDS.has(tokens[i + 1]))
      return true;
  }
  return false;
}

function isNameStop(t: string): boolean {
  if (t in NUMBER_WORDS) return true;
  if (/^\d+(\.\d+)?$/.test(t)) return true;
  if (COUNT_WORDS.has(t) || KILO_WORDS.has(t) || GRAM_WORDS.has(t)) return true;
  if (t in FRACTION_KG) return true;
  return CUSTOMER_STOP.has(t);
}

function takePersonName(tokens: string[]): { name: string; used: number } {
  let i = 0;
  while (i < tokens.length && NAME_HONORIFICS.has(tokens[i])) i++;
  const start = i;
  while (i < tokens.length && i - start < 4) {
    if (NAME_HONORIFICS.has(tokens[i])) {
      i++;
      continue;
    }
    if (isNameStop(tokens[i])) break;
    i++;
  }
  const name = tokens
    .slice(start, i)
    .filter((t) => !NAME_HONORIFICS.has(t))
    .join(" ")
    .trim();
  return { name, used: i };
}

function findCustomerMarker(tokens: string[]): { index: number; length: number } | null {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "برای" || tokens[i] === "واسه") return { index: i, length: 1 };
    if (tokens[i] === "به" && (tokens[i + 1] === "اسم" || tokens[i + 1] === "نام")) {
      return { index: i, length: 2 };
    }
  }
  return null;
}

/**
 * نام مشتری و تلفن را از جمله جدا می‌کند تا وارد تجزیه‌ی کالا نشوند.
 * «برای آقای امیر احمدی با شماره تلفن ۰۹۱۲…» → نام «امیر احمدی» + تلفن.
 * «برای رضا دو تا نان» همچنان فقط «رضا» را برمی‌دارد (عدد/تا مرز نام است).
 */
function extractCustomer(s: string): { name?: string; phone?: string; rest: string } {
  const ph = extractPhone(s);
  const tokens = ph.rest.split(" ").filter(Boolean);
  const marker = findCustomerMarker(tokens);
  if (marker) {
    const after = tokens.slice(marker.index + marker.length);
    const taken = takePersonName(after);
    const rest = [
      ...tokens.slice(0, marker.index),
      ...after.slice(Math.max(taken.used, 0)),
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return { name: taken.name || undefined, phone: ph.phone, rest };
  }

  // دنباله‌ی فقط مشتری: «آقای امیر احمدی با شماره …» بدون «برای»
  const honIdx = tokens.findIndex((t) => NAME_HONORIFICS.has(t));
  if (honIdx >= 0 && (ph.phone || !hasQuantityCue(ph.rest))) {
    const taken = takePersonName(tokens.slice(honIdx));
    if (taken.name) {
      const rest = [...tokens.slice(0, honIdx), ...tokens.slice(honIdx + taken.used)]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return { name: taken.name, phone: ph.phone, rest };
    }
  }

  return { phone: ph.phone, rest: ph.rest };
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
      // اگر این رقم بعد از حداقل یک کلمه‌ی محصول آمده (مثلاً «روژلب شماره ۱۷» یا
      // «شلوار سایز ۴۲») و بلافاصله بعدش هیچ واحد شمارشی (تا/عدد/بسته/...) نیامده،
      // این عدد به‌احتمال زیاد بخشی از نام/کد/سایز محصول است، نه یک مقدار تازه —
      // پس آن را به عبارت محصول اضافه می‌کنیم تا محصول درست (با همان شماره) تشخیص
      // داده شود، نه یک قلم جدید با تعداد اشتباه.
      if (productTokens.length > 0 && !(next && COUNT_WORDS.has(next))) {
        productTokens.push(t);
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

/** استخراج توالی ارقام از یک متن نرمال‌شده (برای مقایسه‌ی شماره/سایز/کد) */
function extractNumbers(s: string): string[] {
  return s.match(/\d+/g) || [];
}

export function scoreProduct(phrase: string, productName: string): number {
  const a = normalizeFa(phrase);
  const b = normalizeFa(productName);
  if (!a || !b) return 0;

  const at = a.split(" ").filter(Boolean);
  const bt = b.split(" ").filter(Boolean);

  let score: number;
  if (a === b) {
    // کل عبارت دقیقاً همان نام محصول است
    score = 1;
  } else if (b.startsWith(a)) {
    // نام محصول با کل عبارت گفته‌شده شروع می‌شود (مثلاً «گلس آیفون ۱۳»)
    score = 0.96;
  } else if (b.includes(a)) {
    // کل عبارت به‌صورت پیوسته در نام محصول هست — حتی اگر کلمه‌ی دوم/سوم باشد
    score = 0.9;
  } else {
    if (at.length === 0 || bt.length === 0) return 0;
    const tokenHit = (tok: string) =>
      bt.some((x) => x === tok || x.includes(tok) || tok.includes(x));
    let hits = 0;
    let laterHits = 0;
    at.forEach((tok, i) => {
      if (tokenHit(tok)) {
        hits++;
        if (i > 0) laterHits++;
      }
    });
    if (hits === 0) return 0;

    const allPresent = hits === at.length;
    const inOrder = (() => {
      let pos = 0;
      for (const tok of at) {
        const i = bt.findIndex((x, idx) => idx >= pos && (x === tok || x.includes(tok) || tok.includes(x)));
        if (i < 0) return false;
        pos = i + 1;
      }
      return true;
    })();

    if (allPresent && at.length > 1) {
      score = inOrder ? 0.82 : 0.72;
    } else if (allPresent) {
      score = 0.7;
    } else {
      const overlap = hits / Math.max(at.length, bt.length);
      // تطبیق فقط کلمه‌ی اول در عبارت چندکلمه‌ای نباید برنده‌ی جستجو باشد
      const firstOnly = at.length > 1 && hits === 1 && laterHits === 0;
      score = firstOnly ? overlap * 0.35 : overlap >= 0.5 ? 0.5 + overlap * 0.25 : overlap * 0.5;
    }
  }

  // اگر عبارتِ گفته‌شده شامل عدد باشد (مثلاً «شماره ۱۷» یا «سایز ۴۲»)، همان عدد
  // باید دقیقاً در نام محصول هم باشد؛ وگرنه حتی تطبیق نسبی/زیررشته‌ای هم به‌شدت
  // کم‌امتیاز می‌شود — تا بین محصولات مشابه با شماره‌ی متفاوت (مثلاً «سایز ۱» و
  // «سایز ۱۷») با اطمینان بالا اشتباه انتخاب نشود.
  const aNums = extractNumbers(a);
  if (aNums.length > 0 && a !== b) {
    const bNums = extractNumbers(b);
    const allNumsMatch = aNums.every((n) => bNums.includes(n));
    if (!allNumsMatch) score *= 0.2;
  }

  return score;
}

export function matchProducts(phrase: string, products: Product[]): ParsedCandidate[] {
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
function isInsideMoneyPhrase(tokens: string[], idx: number): boolean {
  const from = Math.max(0, idx - 3);
  const to = Math.min(tokens.length, idx + 4);
  for (let i = from; i < to; i++) {
    if (isMultiplierWord(tokens[i]) || isCurrencyWord(tokens[i]) || tokens[i] === "قیمت") return true;
  }
  return false;
}

function isQuantityStarter(tokens: string[], idx: number): boolean {
  const t = tokens[idx];
  if (isInsideMoneyPhrase(tokens, idx)) return false;
  if (t in NUMBER_WORDS || t in FRACTION_KG) return true;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const next = tokens[idx + 1];
    return !!(next && isUnitOrCountWord(next));
  }
  return false;
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

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];
    if (isQuantityStarter(tokens, idx) && sawProductToken && current.length > 0) {
      clauses.push(current.join(" "));
      current = [];
      sawProductToken = false;
    }
    current.push(t);
    if (!isQuantityStarter(tokens, idx) && !isUnitOrCountWord(t) && t !== "و" && !STOPWORDS.has(t)) {
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
      const prev = merged[merged.length - 1];
      const isWeightContinuation =
        merged.length > 0 &&
        isQuantityOnlyBuffer(prev) &&
        (/^\d+(\.\d+)?$/.test(firstWord) || firstWord in NUMBER_WORDS);
      const isMoneyContinuation =
        merged.length > 0 &&
        (() => {
          const prevToks = prev.split(" ").filter(Boolean);
          const last = prevToks[prevToks.length - 1];
          return (
            (isMultiplierWord(last) || tokenToNumber(last) !== undefined || isCurrencyWord(last)) &&
            (tokenToNumber(firstWord) !== undefined ||
              isMultiplierWord(firstWord) ||
              isCurrencyWord(firstWord))
          );
        })();
      if (isFractionContinuation || isWeightContinuation || isMoneyContinuation) {
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
    const tokens = clause.split(" ").filter(Boolean);
    const peeled = peelUnitPrice(tokens);
    const parsed = parseClause(peeled.rest.join(" "));
    if (!parsed.productPhrase) continue;

    const candidates = matchProducts(parsed.productPhrase, products);
    const quantity = parsed.count ?? parsed.weightKg ?? 1;
    const unit =
      parsed.spokenUnit === "kg"
        ? "کیلوگرم"
        : parsed.spokenUnit === "gram"
          ? "گرم"
          : COUNT_UNIT;

    if (candidates.length === 0) {
      items.push({
        rawClause: clause,
        productPhrase: parsed.productPhrase,
        quantity,
        unit,
        candidates: [],
        confidence: "none",
        unitPrice: peeled.unitPrice,
      });
      continue;
    }

    const best = candidates[0];
    const rec = reconcile(parsed, best.product);

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
      unitPrice: peeled.unitPrice,
    });
  }

  return {
    items,
    customerName: cust.name,
    customerPhone: cust.phone,
    paymentMethod: pay.method,
  };
}
