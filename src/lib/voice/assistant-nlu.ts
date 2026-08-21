/**
 * تحلیل‌گر نیت «دستیار هوشمند صوتی» — کاملاً محلی، قطعی (deterministic) و بدون
 * هیچ AI/API. سبک نگارش قواعد دقیقاً مثل `persian-nlu.ts` است: نرمال‌سازی متن،
 * جدول کلمات عددی، و امتیازدهی تطبیق رشته (همان `scoreProduct`).
 *
 * ورودی: متن رونویسی‌شده‌ی گفتار.
 * خروجی: یکی از نیت‌های زیر —
 *   customer_debt       بدهکار / طلبکار / تسویه مشتری
 *   expense             ثبت هزینه (با تاریخ شمسی اختیاری)
 *   product_add         افزودن کالا به فهرست محصولات
 *   product_price_edit  ویرایش قیمت کالا
 *   reminder            یادآوری با تاریخ شمسی و ساعت
 *   open_invoice        باز کردن فاکتورهای یک مشتری
 *   query               سؤال گزارشی (فقط خواندن)
 *   invoice_item        پیش‌فرض: همان رفتار فعلی «ثبت صوتی فاکتور»
 *   unknown             هیچ‌کدام
 *
 * قاعده‌ی مهم: دستورهای عملی (فاکتور، بدهی، هزینه، محصول، یادآوری) دست‌نخورده
 * می‌مانند. جمله‌ی نامرتبط یا سؤال نامشخص دیگر به «کالا پیدا نشد» نمی‌افتد.
 */

import {
  customerBalance,
  customerFullName,
  invoicesOfCustomer,
  jalaliToTimestamp,
  parseJalaliInput,
  toJalali,
  type Customer,
  type Expense,
  type Invoice,
  type Product,
} from "@/lib/store";
import {
  matchProducts,
  normalizeFa,
  parseVoiceText,
  scoreProduct,
  type ParseResult,
  type ParsedCandidate,
} from "@/lib/voice/persian-nlu";
import { parseProductVoiceText, type ParsedProductItem } from "@/lib/voice/product-nlu";
import { buildQueryAnswer, type QueryKind, type QueryRange, type QuerySpec } from "@/lib/voice/assistant-queries";

// ─── انواع ────────────────────────────────────────────────────────────────────

export type AssistantContext = {
  products: Product[];
  customers: Customer[];
  invoices: Invoice[];
  expenses: Expense[];
  /** «اکنون» — فقط برای تاریخ‌های نسبی و تست */
  now?: number;
};

export type CustomerCandidate = { customer: Customer; score: number };

/**
 * نقش حساب مشتری در زبان فروشنده:
 *   debtor   = مشتری به ما بدهکار است (مانده مثبت)
 *   creditor = مشتری از ما طلبکار است (مانده منفی)
 *   settle   = تسویه / پرداخت روی مانده‌ی موجود
 */
export type CustomerLedgerRole = "debtor" | "creditor" | "settle";

export type AssistantIntent =
  | {
      kind: "customer_debt";
      raw: string;
      /** نامی که از جمله استخراج شد (برای نمایش و ساخت مشتری جدید) */
      customerName: string;
      amount: number;
      role: CustomerLedgerRole;
      /** تسویه بدون مبلغ → کل مانده در لحظه‌ی اجرا */
      settleAll: boolean;
      /** اگر کاربر تاریخ گفته باشد، زمان تراکنش */
      at?: number;
      /** نزدیک‌ترین مشتری‌های موجود، مرتب بر اساس امتیاز */
      candidates: CustomerCandidate[];
      /** یک تطبیق واضح وجود دارد → بدون پرسیدن ثبت شود */
      clearWinner: boolean;
    }
  | {
      kind: "expense";
      raw: string;
      title: string;
      amount: number;
      /** دوره‌ی تکرار به روز (۳۰ = ماهانه، ۷ = هفتگی، ۳۶۵ = سالانه) */
      recurringDays?: number;
      /** اگر کاربر تاریخ گفته باشد، وگرنه «اکنون» */
      at: number;
      dateSpoken: boolean;
    }
  | {
      kind: "product_price_edit";
      raw: string;
      productPhrase: string;
      price: number;
      candidates: ParsedCandidate[];
      clearWinner: boolean;
      /** کاربر گفته «همه‌شون»/«هرچی …» → پیشنهاد اعمال روی همه‌ی موارد مشابه */
      applyAllHint: boolean;
    }
  | {
      kind: "reminder";
      raw: string;
      title: string;
      dueAt: number;
      /** ساعت گفته نشد و ۹ صبح فرض شد */
      timeDefaulted: boolean;
      /** تاریخ گفته نشد و «امروز» فرض شد */
      dateDefaulted: boolean;
      recurringDays?: number;
    }
  | { kind: "query"; raw: string; queryKind: QueryKind; answer: string }
  | {
      kind: "product_add";
      raw: string;
      items: ParsedProductItem[];
    }
  | {
      kind: "open_invoice";
      raw: string;
      customerName: string;
      candidates: CustomerCandidate[];
      invoices: Invoice[];
      clearWinner: boolean;
    }
  | { kind: "invoice_item"; raw: string; result: ParseResult }
  | { kind: "unknown"; raw: string; reason: string };

// ─── اعداد و مبالغ ────────────────────────────────────────────────────────────

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

const MULTIPLIERS: Record<string, number> = {
  هزار: 1000,
  هزارتا: 1000,
  میلیون: 1_000_000,
  ملیون: 1_000_000,
  میلیارد: 1_000_000_000,
  ملیارد: 1_000_000_000,
};

const CURRENCY_WORDS = new Set(["تومان", "تومن", "ریال"]);

function tokenToNumber(t: string): number | undefined {
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  return undefined;
}

function isNumberToken(t: string): boolean {
  return tokenToNumber(t) !== undefined || t in MULTIPLIERS;
}

type AmountRun = {
  amount: number;
  /** ایندکس اولین توکن عددی */
  from: number;
  /** ایندکس بعد از آخرین توکن مصرف‌شده (شامل واحد پول) */
  to: number;
  /** واحد پول یا ضریب (هزار/میلیون) دیده شد → این عدد به‌احتمال زیاد «مبلغ» است */
  hasAnchor: boolean;
};

/** همه‌ی عبارت‌های عددی یک جمله («۲۵۰ هزار تومان»، «۴۵ میلیون»، «۴۵۰۰۰») */
function collectAmountRuns(tokens: string[]): AmountRun[] {
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
      // «دویست و پنجاه» — «و» بین دو عدد بخشی از همان مبلغ است
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
    // مبالغ همیشه به تومان ذخیره می‌شوند؛ ریال تقسیم بر ۱۰
    if (rial) amount = Math.round(amount / 10);
    if (amount > 0) runs.push({ amount, from: i, to: end, hasAnchor });
    i = Math.max(end, i + 1);
  }
  return runs;
}

/**
 * انتخاب «مبلغ» از میان عبارت‌های عددی جمله: اولویت با عبارتی که واحد پول یا
 * ضریب (هزار/میلیون) دارد؛ در نبودش آخرین عبارت عددی. بقیه‌ی توکن‌ها برگردانده
 * می‌شوند تا از آن‌ها نام/عنوان ساخته شود (اعداد داخل نام کالا حفظ می‌شوند).
 */
function extractAmount(tokens: string[]): { amount: number; restTokens: string[] } {
  const runs = collectAmountRuns(tokens);
  if (runs.length === 0) return { amount: 0, restTokens: tokens };
  const anchored = runs.filter((r) => r.hasAnchor);
  const pool = anchored.length > 0 ? anchored : runs;
  const chosen = pool[pool.length - 1];
  const restTokens = [...tokens.slice(0, chosen.from), ...tokens.slice(chosen.to)];
  return { amount: chosen.amount, restTokens };
}

// ─── ابزارهای متن ─────────────────────────────────────────────────────────────

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

/**
 * نرمال‌سازی «نیمه‌کامل» — مثل normalizeFa است ولی «/» و «:» را نگه می‌دارد،
 * چون تاریخ شمسی («۴/۴/۱۴۰۵») و ساعت («۱۳:۳۰») بدون آن‌ها از دست می‌روند.
 * normalizeFa عمداً دست نمی‌خورد؛ این تابع فقط برای نیت «یادآوری» است.
 */
function normalizeKeepSeparators(input: string): string {
  return digitsToLatin(input)
    .replace(/‌/g, " ")
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ی")
    .replace(/[ً-ْ]/g, "")
    .replace(/[^؀-ۿ0-9a-zA-Z\s.:/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(s: string): string[] {
  return s.split(" ").filter(Boolean);
}

function joinClean(tokens: string[], isNoise: (t: string) => boolean): string {
  return tokens
    .filter((t) => !isNoise(t))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── تطبیق مشتری (همان امتیازدهی رشته‌ای محصولات) ─────────────────────────────

/**
 * امتیاز تطبیق نام گفته‌شده با یک مشتری. از همان `scoreProduct` استفاده می‌شود
 * (تابع کاملاً عمومی روی دو رشته است) تا رفتار fuzzy در کل برنامه یکسان بماند.
 */
function scoreCustomer(phrase: string, c: Customer): number {
  const full = customerFullName(c);
  return Math.max(
    scoreProduct(phrase, full),
    scoreProduct(phrase, c.firstName || ""),
    c.lastName ? scoreProduct(phrase, c.lastName) : 0,
  );
}

function matchCustomers(phrase: string, list: Customer[]): CustomerCandidate[] {
  if (!phrase.trim()) return [];
  return list
    .map((customer) => ({ customer, score: scoreCustomer(phrase, customer) }))
    .filter((c) => c.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

/** یک برنده‌ی واضح: امتیاز بالا و فاصله‌ی کافی از نفر دوم (مثل persian-nlu) */
function isClearWinner(scores: number[]): boolean {
  const [best, second] = scores;
  if (best === undefined) return false;
  return best >= 0.6 && (second === undefined || best - second >= 0.2);
}

// ─── الگوهای تشخیص نیت ────────────────────────────────────────────────────────
// همه‌ی الگوها روی متنِ نرمال‌شده نوشته شده‌اند (آ→ا، ي→ی، بدون نیم‌فاصله).

const RE_REMINDER = /یاداور|یادم بنداز|یادم باشه|به یادم|یادآوری|الارم|یادم نره/;
const RE_PRICE_EDIT =
  /ویرایش قیمت|تغییر قیمت|قیمت جدید|قیمتش? ?(رو|را)? ?(عوض|اصلاح|تغییر)|قیمت.*(بشه|بشود|بکن|کن|بذار|بزن)|قیمتش? ?(بشه|بشود)/;
/** طلبکار = مشتری از ما طلب دارد (مانده منفی). جدا از «بدهکار». */
const RE_CREDITOR = /طلبکار|(بهش|به او|بهشون) بدهکارم|بدهکارم به|به .{1,40} بدهکارم|از من طلب/;
const RE_DEBTOR = /بدهکار|بدهی|طلب داره|طلب دارد|نسیه اش|نسیه/;
const RE_SETTLE = /تسویه|پرداخت کرد|واریز کرد|صاف کرد|حساب ?(رو|را)? ?داد|پس داد/;
const RE_LEDGER = /طلبکار|بدهکار|بدهی|طلب|نسیه اش|تسویه|پرداخت کرد|واریز کرد/;
const RE_EXPENSE = /هزینه|اجاره|قبض|حقوق|فیش|خرج/;
const RE_APPLY_ALL = /همه|همشون|همه شون|تمام|هرچی|هر چی|هرچه/;
/** افزودن کالا به فهرست محصولات — نه به فاکتور جاری */
const RE_PRODUCT_ADD =
  /ثبت محصول|محصول جدید|به محصولات|تو محصولات|در محصولات|موجودی .*اضافه|اضافه شود|اضافه بشه|اضافه کن|اضافه بکن/;
const RE_TO_INVOICE = /به فاکتور|روی فاکتور|تو فاکتور/;
const RE_OPEN_INVOICE =
  /فاکتور.{0,48}(باز کن|بازکن|نشون بده|نشان بده|بیار|بده ببینم|پیدا کن|چیه|چیست|کجاست)|باز کن.{0,24}فاکتور|(برو( به)?|ببر( به)?) فاکتور/;

/** نشانه‌ی سؤال / گزارش — برای جدا کردن پرسش از دستور ثبت */
function looksLikeQuestion(norm: string): boolean {
  return /(چقدر|چقد|چند\s*تا|چندتا|چنده|چیه|چیست|کیه|کیست|گزارش|بگو\b|داشتم|کردم|فروختم|درآوردم|در اوردم|گیرم|وضعیت حساب|حسابش|بدهکاره|طلبکاره)/.test(
    norm,
  );
}

function extractQueryRange(norm: string): QueryRange | undefined {
  if (/دیروز/.test(norm)) return "yesterday";
  if (/امروز/.test(norm)) return "today";
  if (/این\s*هفته|هفته\s*(ی\s*)?(جاری|الان)/.test(norm)) return "week";
  if (/این\s*ماه|ماه\s*(جاری|الان)|ماه\s*چقدر/.test(norm)) return "month";
  if (/امسال|این\s*سال|سال\s*(جاری|الان)/.test(norm)) return "year";
  if (/(از\s*اول|از\s*ابتدا|تا\s*الان|کل\s*(سود|فروش|هزینه)|همه\s*(ی\s*)?(سود|فروش))/.test(norm))
    return "all";
  return undefined;
}

const QUERY_NAME_NOISE = new Set([
  "است",
  "هست",
  "هستش",
  "شد",
  "شده",
  "چقدر",
  "چقد",
  "چند",
  "چیه",
  "چیست",
  "کیه",
  "بگو",
  "گزارش",
  "وضعیت",
  "حساب",
  "حسابش",
  "مانده",
  "داره",
  "دارد",
  "دارم",
  "هست",
  "من",
  "رو",
  "را",
  "به",
  "از",
  "برای",
  "و",
]);

function extractQueryCustomerName(norm: string): string {
  return joinClean(tokensOf(norm), (t) => {
    if (HONORIFICS.has(t) || QUERY_NAME_NOISE.has(t) || isWhenNoise(t)) return true;
    return /^(بدهکار|طلبکار|بدهی|طلب|چقدر|چند)/.test(t);
  });
}

/**
 * تشخیص نیت پرسشی. الگوهای خاص‌تر اول می‌آیند تا «پرسودترین» با «چقدر سود»
 * قاطی نشود، و سؤال وضعیت مشتری قبل از دستور ثبت بدهی گرفته شود.
 */
function detectQuery(norm: string): QuerySpec | null {
  const range = extractQueryRange(norm);
  const q = looksLikeQuestion(norm);
  const reportCue = q || !!range || /^(سود|سودم|فروش|فروشم|گزارش)$/.test(norm);

  if (/(پرسود|پر سود|بیشترین سود|سود اورترین|سوداورترین)/.test(norm)) {
    return { kind: "most_profitable", range };
  }
  if (/(کم سود|کمسود|کمترین سود|بی سود|بیسود)/.test(norm)) {
    return { kind: "least_profitable", range };
  }
  if (/(بهترین مشتری|مشتری برتر|وفادارترین مشتری|بیشترین خرید)/.test(norm)) {
    return { kind: "best_customers", range };
  }
  if (/(پرفروش|پر فروش|بیشترین فروش|بیشتر فروش رفته)/.test(norm)) {
    return { kind: "top_selling", range };
  }
  if (/(کم\s*بود|رو\s*به\s*اتمام|موجودی\s*کم|کالاهای?\s*تمام|ته\s*کشید)/.test(norm) && reportCue) {
    return { kind: "low_stock" };
  }
  if (/(چند\s*(تا\s*)?فاکتور|تعداد فاکتور|چند فاکتور)/.test(norm)) {
    return { kind: "invoice_count", range };
  }

  const genericDebtors =
    /چند\s*تا\s*بدهکار|چندتا بدهکار|تعداد بدهکار|بدهکارها|بدهکاران|جمع بدهی|چقدر طلب|طلبم چقدر/.test(
      norm,
    );
  const genericCreditors = /چند\s*تا\s*طلبکار|چندتا طلبکار|طلبکارها|طلبکاران|جمع طلبکاری/.test(norm);
  if (genericDebtors) return { kind: "debtors" };
  if (genericCreditors) return { kind: "creditors" };

  if (
    (/(وضعیت حساب|حسابش|مانده حساب)/.test(norm) ||
      (/(بدهکار|طلبکار|بدهی)/.test(norm) && q)) &&
    !genericDebtors &&
    !genericCreditors
  ) {
    const customerName = extractQueryCustomerName(norm);
    if (customerName) return { kind: "customer_status", customerName };
    if (/(طلبکار)/.test(norm)) return { kind: "creditors" };
    if (/(بدهکار|بدهی)/.test(norm)) return { kind: "debtors" };
  }

  if (/(سود\s*خالص|سود\s*بعد|سود\s*واقعی|برام\s*موند|چقدر\s*برام)/.test(norm)) {
    return { kind: "net_profit", range };
  }
  if (/(سود|سودم|سوددهی|سوداوری|درآوردم|در اوردم|گیرم)/.test(norm) && reportCue) {
    return { kind: "profit", range };
  }

  if (
    /(فروش|فروختم|فروشم|درآمد)/.test(norm) &&
    !RE_PRODUCT_ADD.test(norm) &&
    reportCue
  ) {
    return { kind: "sales", range };
  }

  if (RE_EXPENSE.test(norm)) {
    const expenseQuestion = /(چقدر|جمع|گزارش|داشتم|کردم|چیه)/.test(norm);
    const money = collectAmountRuns(tokensOf(norm)).some((r) => r.hasAnchor || r.amount >= 1000);
    // «چقدر هزینه کردم» / «هزینه این ماه» سؤال است؛ «ماهانه ۴۵ میلیون هزینه اجاره» ثبت است
    if (expenseQuestion || (range && !money)) {
      return { kind: "expenses", range };
    }
  }

  if (/گزارش/.test(norm) && (q || range || /^گزارش/.test(norm))) {
    return { kind: "snapshot", range };
  }

  return null;
}

/** «۲ تا نون»، «سه عدد شیر»، «به فاکتور اضافه کن» — دستور ثبت فاکتور است */
function looksLikeInvoiceCommand(norm: string): boolean {
  if (RE_TO_INVOICE.test(norm)) return true;
  if (/\d+(\.\d+)?\s*(تا|عدد|کیلو|کیلوگرم|گرم|دونه|دونا|تاي)/.test(norm)) return true;
  const tokens = tokensOf(norm);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokenToNumber(tokens[i]) === undefined) continue;
    if (/^(تا|عدد|کیلو|کیلوگرم|گرم|دونه|دونا)$/.test(tokens[i + 1])) return true;
  }
  return false;
}

// ─── واژه‌های بی‌اثر هر نیت ───────────────────────────────────────────────────

const HONORIFICS = new Set([
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

/** ماه‌های شمسی بعد از normalizeFa (آ → ا) */
const JMONTH_INDEX: Record<string, number> = {
  فروردین: 1,
  اردیبهشت: 2,
  خرداد: 3,
  تیر: 4,
  مرداد: 5,
  شهریور: 6,
  مهر: 7,
  ابان: 8,
  اذر: 9,
  دی: 10,
  بهمن: 11,
  اسفند: 12,
};

const DAY_WORDS: Record<string, number> = {
  ...NUMBER_WORDS,
  اول: 1,
  یکم: 1,
  دوم: 2,
  سوم: 3,
  چهارم: 4,
  پنجم: 5,
  ششم: 6,
  هفتم: 7,
  هشتم: 8,
  نهم: 9,
  دهم: 10,
  یازدهم: 11,
  دوازدهم: 12,
  سیزدهم: 13,
  چهاردهم: 14,
  پانزدهم: 15,
  پونزدهم: 15,
  شانزدهم: 16,
  شونزدهم: 16,
  هفدهم: 17,
  هجدهم: 18,
  هیجدهم: 18,
  نوزدهم: 19,
  بیستم: 20,
  سیام: 30,
};

const DEBT_NOISE = new Set([
  "است",
  "هست",
  "شد",
  "شده",
  "میشه",
  "بشه",
  "بهش",
  "به",
  "از",
  "برای",
  "بابت",
  "من",
  "رو",
  "را",
  "هم",
  "حساب",
  "کرد",
  "کرده",
  "مبلغ",
  "دیگه",
  "ثبت",
  "کن",
  "بنویس",
  "بزن",
  "نسیه",
  "و",
]);

function isDebtNoise(t: string): boolean {
  if (HONORIFICS.has(t) || DEBT_NOISE.has(t) || isWhenNoise(t)) return true;
  return /^(بدهکار|طلبکار|بدهی|طلب|داره|دارد|دارم|پرداخت|تسویه|واریز|پس)/.test(t);
}

const EXPENSE_NOISE = new Set([
  "است",
  "هست",
  "شد",
  "شده",
  "میشه",
  "بشه",
  "برای",
  "بابت",
  "من",
  "رو",
  "را",
  "هم",
  "مبلغ",
  "ثبت",
  "کن",
  "بنویس",
  "بزن",
  "یه",
  "یک",
  "هر",
  "ماه",
  "هفته",
  "سال",
  "روز",
  "ماهانه",
  "ماهیانه",
  "هرماه",
  "هفتگی",
  "سالانه",
  "روزانه",
  "پرداخت",
  "و",
]);

function isExpenseNoise(t: string): boolean {
  if (EXPENSE_NOISE.has(t) || isWhenNoise(t)) return true;
  return /^(هزینه|خرج)/.test(t);
}

const PRICE_EDIT_NOISE = new Set([
  "ویرایش",
  "تغییر",
  "اصلاح",
  "عوض",
  "کن",
  "بکن",
  "بشه",
  "بشود",
  "شود",
  "بذار",
  "بگذار",
  "بزن",
  "به",
  "را",
  "رو",
  "جدید",
  "همه",
  "همشون",
  "شون",
  "تمام",
  "هرچی",
  "هرچه",
  "چی",
  "هر",
  "که",
  "داشت",
  "دارد",
  "داره",
  "بود",
  "باشه",
  "هست",
  "است",
  "میشه",
  "شد",
  "شده",
  "مبلغ",
  "بفروش",
  "از",
  "این",
  "اون",
  "و",
]);

function isPriceEditNoise(t: string): boolean {
  if (PRICE_EDIT_NOISE.has(t)) return true;
  return /^قیمت/.test(t);
}

const REMINDER_NOISE = new Set([
  "ساعت",
  "تاریخ",
  "دقیقه",
  "صبح",
  "عصر",
  "شب",
  "ظهر",
  "بعدازظهر",
  "بعد",
  "از",
  "فردا",
  "پس",
  "پسفردا",
  "امروز",
  "هفته",
  "ماه",
  "سال",
  "روز",
  "دیگه",
  "اینده",
  "هر",
  "نیم",
  "و",
  "برای",
  "را",
  "رو",
  "که",
  "به",
  "کن",
  "بکن",
  "بزن",
  "بذار",
  "یه",
  "یک",
  "ثبت",
  "هفتگی",
  "ماهانه",
  "ماهیانه",
  "سالانه",
  "روزانه",
]);

function isReminderNoise(t: string): boolean {
  if (REMINDER_NOISE.has(t) || isWhenNoise(t)) return true;
  return /^(یاداور|یادم|یاد|بنداز|باشه|الارم|نره)/.test(t) || /^\d+$/.test(t);
}

function isWhenNoise(t: string): boolean {
  if (t in JMONTH_INDEX) return true;
  return /^(تاریخ|ساعت|دقیقه|صبح|عصر|شب|ظهر|بعدازظهر|فردا|پسفردا|امروز|هفته|ماه|سال|روز|دیگه|اینده|نیم)$/.test(
    t,
  );
}

// ─── تکرارشونده ───────────────────────────────────────────────────────────────

function detectRecurringDays(norm: string): number | undefined {
  if (/ماهانه|ماهیانه|هرماه|هر ماه/.test(norm)) return 30;
  if (/هفتگی|هر هفته/.test(norm)) return 7;
  if (/سالانه|هر سال/.test(norm)) return 365;
  if (/روزانه|هر روز/.test(norm)) return 1;
  return undefined;
}

// ─── تاریخ و ساعت شمسی (روز، ماه، سال — به ترتیب ایرانی) ───────────────────────

type TimePart = { h: number; min: number; matched: string };
type DatePart = { jy: number; jm: number; jd: number; matched: string };

type WhenPart = {
  at: number;
  date: DatePart | null;
  time: TimePart | null;
  offset: number | null;
  dateSpoken: boolean;
  timeSpoken: boolean;
  /** متن بدون عبارت تاریخ/ساعت — برای استخراج نام/عنوان */
  restNorm: string;
};

function extractTime(semi: string): TimePart | null {
  const evening = /عصر|شب|بعد از ظهر|بعدازظهر/.test(semi);
  const noon = /ظهر/.test(semi) && !/بعد ?از ?ظهر|بعدازظهر/.test(semi);
  const applyPeriod = (h: number): number => {
    if ((evening || noon) && h < 12) return h + 12;
    if (/صبح/.test(semi) && h === 12) return 0;
    return h;
  };

  const colon = semi.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (colon) {
    const h = applyPeriod(parseInt(colon[1], 10));
    const min = parseInt(colon[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return { h, min, matched: colon[0] };
    }
  }

  const bare = semi.match(
    /ساعت\s*((?:\d{1,2})|(?:یک|یه|دو|سه|چهار|چار|پنج|شش|شیش|هفت|هشت|نه|ده|یازده|دوازده))(\s*و\s*نیم)?/,
  );
  if (bare) {
    const rawH = /^\d+$/.test(bare[1]) ? parseInt(bare[1], 10) : (NUMBER_WORDS[bare[1]] ?? -1);
    const h = applyPeriod(rawH);
    const min = bare[2] ? 30 : 0;
    if (h >= 0 && h <= 23) return { h, min, matched: bare[0] };
  }
  return null;
}

/**
 * تاریخ عددی. ترتیب ایرانی: روز / ماه / سال («۴/۴/۱۴۰۵»).
 * اگر بخش اول ۳–۴ رقمی باشد سال فرض می‌شود («۱۴۰۵/۴/۴»).
 */
function extractNumericJalali(semi: string): DatePart | null {
  const m = semi.match(/(?:تاریخ\s+)?(\d{1,4})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,4})/);
  if (m) {
    const a = m[1];
    const b = m[2];
    const c = m[3];
    const ymd = a.length >= 3 ? `${a}/${b}/${c}` : `${c}/${b}/${a}`;
    const parsed = parseJalaliInput(ymd);
    if (parsed && parsed.jy >= 1300 && parsed.jy <= 1500) {
      return { ...parsed, matched: m[0] };
    }
  }
  const spaced = semi.match(/تاریخ\s+(\d{1,2})\s+(\d{1,2})\s+(\d{3,4})/);
  if (spaced) {
    const parsed = parseJalaliInput(`${spaced[3]}/${spaced[2]}/${spaced[1]}`);
    if (parsed && parsed.jy >= 1300 && parsed.jy <= 1500) {
      return { ...parsed, matched: spaced[0] };
    }
  }
  return null;
}

function parseDayAtEnd(tokens: string[]): { day: number; used: number } | null {
  if (tokens.length === 0) return null;
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 3 && tokens[tokens.length - 2] === "و") {
    const tens = DAY_WORDS[tokens[tokens.length - 3]];
    const ones = DAY_WORDS[last];
    if (tens && ones && tens >= 20 && ones <= 9) {
      const n = tens + ones;
      if (n >= 1 && n <= 31) return { day: n, used: 3 };
    }
  }
  if (/^\d{1,2}$/.test(last)) {
    const n = parseInt(last, 10);
    if (n >= 1 && n <= 31) return { day: n, used: 1 };
  }
  const n = DAY_WORDS[last];
  if (n !== undefined && n >= 1 && n <= 31) return { day: n, used: 1 };
  return null;
}

function parseYearPhrase(tokens: string[], fallbackYear: number): { year: number; used: number } {
  let t = tokens;
  let usedPrefix = 0;
  if (t[0] === "سال") {
    t = t.slice(1);
    usedPrefix = 1;
  }
  if (t.length === 0) return { year: fallbackYear, used: 0 };
  if (/^\d{3,4}$/.test(t[0])) {
    const y = parseInt(t[0], 10);
    if (y >= 1300 && y <= 1500) return { year: y, used: usedPrefix + 1 };
  }
  const runs = collectAmountRuns(t);
  const y = runs[0]?.amount;
  if (y && y >= 1300 && y <= 1500) return { year: y, used: usedPrefix + runs[0].to };
  return { year: fallbackYear, used: 0 };
}

/**
 * «چهار تیر ۱۴۰۵»، «پانزدهم فروردین»، «تاریخ بیست اردیبهشت هزار و چهارصد و پنج»
 * ترتیب ایرانی: اول روز، بعد ماه، بعد سال (سال اگر گفته نشود سال جاری است).
 */
function extractSpokenJalali(norm: string, now: number): DatePart | null {
  const tokens = tokensOf(norm);
  const monthIdx = tokens.findIndex((t) => t in JMONTH_INDEX);
  if (monthIdx < 0) return null;

  const jm = JMONTH_INDEX[tokens[monthIdx]];
  const today = toJalali(now);
  const fallbackYear = today?.jy ?? 1405;

  const lookback = tokens.slice(Math.max(0, monthIdx - 4), monthIdx);
  const dayHit = parseDayAtEnd(lookback);
  if (!dayHit) return null;
  const jd = dayHit.day;

  const yearHit = parseYearPhrase(tokens.slice(monthIdx + 1, monthIdx + 8), fallbackYear);

  const dayTokenStart = monthIdx - dayHit.used;
  const historyToken = dayTokenStart > 0 && tokens[dayTokenStart - 1] === "تاریخ" ? 1 : 0;
  const from = dayTokenStart - historyToken;
  const to = monthIdx + 1 + yearHit.used;
  const matched = tokens.slice(from, to).join(" ");
  return { jy: yearHit.year, jm, jd, matched };
}

function relativeDayOffset(norm: string): { days: number; matched: string } | null {
  if (/پس فردا|پسفردا/.test(norm)) {
    return { days: 2, matched: /پس ?فردا/.exec(norm)?.[0] ?? "پسفردا" };
  }
  if (/فردا/.test(norm)) return { days: 1, matched: "فردا" };
  const week = norm.match(/هفته (دیگه|بعد|اینده)/);
  if (week) return { days: 7, matched: week[0] };
  const month = norm.match(/ماه (دیگه|بعد|اینده)/);
  if (month) return { days: 30, matched: month[0] };
  if (/امروز/.test(norm)) return { days: 0, matched: "امروز" };
  return null;
}

function toTimestamp(
  date: DatePart | null,
  time: TimePart | null,
  offset: number | null,
  now: number,
  defaultHour: number,
): number {
  const today = toJalali(now);
  const h = time ? time.h : defaultHour;
  const min = time ? time.min : 0;
  try {
    if (date) return jalaliToTimestamp(date.jy, date.jm, date.jd, h, min);
    if (today) {
      return jalaliToTimestamp(today.jy, today.jm, today.jd, h, min) + (offset ?? 0) * 86_400_000;
    }
  } catch {
    return now;
  }
  return now;
}

/**
 * استخراج تاریخ و ساعت از هر دستور (یادآوری، هزینه، تراکنش مشتری).
 * defaultHour: یادآوری ۹ صبح؛ هزینه/تراکنش اگر فقط تاریخ گفته شد ۱۲ ظهر.
 */
function extractWhen(raw: string, now: number, defaultHour: number): WhenPart {
  const semi = normalizeKeepSeparators(raw);
  const norm = normalizeFa(raw);
  const time = extractTime(semi);
  const date = extractNumericJalali(semi) ?? extractSpokenJalali(norm, now);
  const rel = date ? null : relativeDayOffset(norm);

  let rest = semi;
  if (date) rest = rest.replace(date.matched, " ");
  if (time) rest = rest.replace(time.matched, " ");
  if (rel) rest = rest.replace(rel.matched, " ");
  rest = rest.replace(/تاریخ/g, " ");

  return {
    at: toTimestamp(date, time, rel?.days ?? null, now, defaultHour),
    date,
    time,
    offset: rel?.days ?? null,
    dateSpoken: !!(date || rel),
    timeSpoken: !!time,
    restNorm: normalizeFa(rest),
  };
}

function detectLedgerRole(norm: string): CustomerLedgerRole {
  if (RE_SETTLE.test(norm)) return "settle";
  if (RE_CREDITOR.test(norm)) return "creditor";
  return "debtor";
}

// ─── نیت‌ها ───────────────────────────────────────────────────────────────────

function parseCustomerDebt(raw: string, norm: string, ctx: AssistantContext): AssistantIntent {
  const now = ctx.now ?? Date.now();
  const when = extractWhen(raw, now, 12);
  const role = detectLedgerRole(norm);
  const work = when.restNorm || norm;
  const { amount, restTokens } = extractAmount(tokensOf(work));
  const name = joinClean(restTokens, isDebtNoise);
  const settleAll = role === "settle" && amount <= 0;

  if (!settleAll && amount <= 0) {
    return {
      kind: "unknown",
      raw,
      reason:
        role === "settle"
          ? "مبلغ تسویه را نفهمیدم. مبلغ را بگویید یا بگویید «آقای … تسویه کرد» تا کل مانده صفر شود."
          : "مبلغ را نفهمیدم. مثلاً بگویید «آقای شهریاری ۲۵۰ هزار تومان بدهکار است».",
    };
  }
  if (!name) {
    return { kind: "unknown", raw, reason: "نام مشتری را نفهمیدم. نام را همراه مبلغ بگویید." };
  }
  const candidates = matchCustomers(name, ctx.customers);
  if (role === "settle" && candidates.length === 0) {
    return {
      kind: "unknown",
      raw,
      reason: `مشتری‌ای با نام «${name}» پیدا نشد؛ برای تسویه باید از قبل در فهرست باشد.`,
    };
  }
  return {
    kind: "customer_debt",
    raw,
    customerName: name,
    amount: settleAll ? 0 : amount,
    role,
    settleAll,
    at: when.dateSpoken || when.timeSpoken ? when.at : undefined,
    candidates,
    clearWinner: isClearWinner(candidates.map((c) => c.score)),
  };
}

function parseExpense(raw: string, norm: string, ctx: AssistantContext): AssistantIntent {
  const now = ctx.now ?? Date.now();
  const when = extractWhen(raw, now, 12);
  const work = when.restNorm || norm;
  const { amount, restTokens } = extractAmount(tokensOf(work));
  if (amount <= 0) {
    return {
      kind: "unknown",
      raw,
      reason: "مبلغ هزینه را نفهمیدم. مثلاً بگویید «ماهانه ۴۵ میلیون هزینه اجاره خانه».",
    };
  }
  const cleaned = joinClean(restTokens, isExpenseNoise);
  const title = cleaned || "هزینه";
  return {
    kind: "expense",
    raw,
    title,
    amount,
    recurringDays: detectRecurringDays(norm),
    at: when.dateSpoken || when.timeSpoken ? when.at : now,
    dateSpoken: when.dateSpoken,
  };
}

function parseProductPriceEdit(raw: string, norm: string, ctx: AssistantContext): AssistantIntent {
  const { amount, restTokens } = extractAmount(tokensOf(norm));
  if (amount <= 0) {
    return {
      kind: "unknown",
      raw,
      reason: "قیمت جدید را نفهمیدم. مثلاً بگویید «تیشرت مشکی ویرایش قیمت ۴۵ هزار تومان».",
    };
  }
  const phrase = joinClean(restTokens, isPriceEditNoise);
  const candidates = phrase ? matchProducts(phrase, ctx.products) : [];
  return {
    kind: "product_price_edit",
    raw,
    productPhrase: phrase,
    price: amount,
    candidates,
    clearWinner: isClearWinner(candidates.map((c) => c.score)),
    applyAllHint: RE_APPLY_ALL.test(norm),
  };
}

function parseReminder(raw: string, norm: string, ctx: AssistantContext): AssistantIntent {
  const now = ctx.now ?? Date.now();
  const when = extractWhen(raw, now, 9);
  const title = joinClean(tokensOf(when.restNorm), isReminderNoise) || "یادآوری";
  return {
    kind: "reminder",
    raw,
    title,
    dueAt: when.at,
    timeDefaulted: !when.timeSpoken,
    dateDefaulted: !when.dateSpoken,
    recurringDays: detectRecurringDays(norm),
  };
}

const PRODUCT_ADD_NOISE =
  /ثبت محصول|محصول جدید|به محصولات|تو محصولات|در محصولات|موجودی|اضافه شود|اضافه بشه|اضافه کن|اضافه بکن|اضافه/g;

function parseProductAdd(raw: string, norm: string): AssistantIntent {
  const cleaned = norm.replace(PRODUCT_ADD_NOISE, " ").replace(/\s+/g, " ").trim();
  const result = parseProductVoiceText(cleaned || raw);
  const items = result.items.filter((i) => i.name.trim());
  if (items.length === 0) {
    return {
      kind: "unknown",
      raw,
      reason:
        "مشخصات محصول را نفهمیدم. مثلاً بگویید «۱۵۰ عدد پیراهن با قیمت ۲۰۰ هزار تومان اضافه شود».",
    };
  }
  return { kind: "product_add", raw, items };
}

const OPEN_INVOICE_NOISE = new Set([
  "فاکتور",
  "فاکتورش",
  "فاکتورها",
  "فاکتورهای",
  "باز",
  "کن",
  "بازکن",
  "نشون",
  "نشان",
  "بده",
  "ببینم",
  "بیار",
  "برام",
  "برایم",
  "برو",
  "ببر",
  "پیدا",
  "رو",
  "را",
  "به",
  "از",
  "تو",
  "در",
  "اون",
  "این",
  "مربوط",
  "مال",
  "چیه",
  "چیست",
  "کجاست",
  "و",
]);

function isOpenInvoiceNoise(t: string): boolean {
  return HONORIFICS.has(t) || OPEN_INVOICE_NOISE.has(t);
}

function invoicesMatchingName(name: string, ctx: AssistantContext): Invoice[] {
  const seen = new Set<string>();
  const out: Invoice[] = [];
  const add = (inv: Invoice) => {
    if (seen.has(inv.id)) return;
    seen.add(inv.id);
    out.push(inv);
  };
  const customers = matchCustomers(name, ctx.customers);
  for (const c of customers) {
    for (const inv of invoicesOfCustomer(c.customer, ctx.invoices)) add(inv);
  }
  for (const inv of ctx.invoices) {
    const c = inv.customer;
    if (!c) continue;
    const score = Math.max(
      scoreProduct(name, [c.firstName, c.lastName].filter(Boolean).join(" ")),
      scoreProduct(name, c.firstName || ""),
      scoreProduct(name, c.lastName || ""),
    );
    if (score > 0.45) add(inv);
  }
  return out;
}

function parseOpenInvoice(raw: string, norm: string, ctx: AssistantContext): AssistantIntent {
  const name = joinClean(tokensOf(norm), isOpenInvoiceNoise);
  if (!name) {
    return {
      kind: "unknown",
      raw,
      reason: "نام مشتری را نفهمیدم. مثلاً بگویید «فاکتور آقای کمالی را باز کن».",
    };
  }
  const candidates = matchCustomers(name, ctx.customers);
  const invoices = invoicesMatchingName(name, ctx);
  return {
    kind: "open_invoice",
    raw,
    customerName: name,
    candidates,
    invoices,
    clearWinner: isClearWinner(candidates.map((c) => c.score)) || invoices.length > 0,
  };
}

// ─── تابع اصلی ────────────────────────────────────────────────────────────────

/**
 * تشخیص نیت یک دستور صوتی. ترتیب بررسی مهم است:
 *   ۱) یادآوری
 *   ۲) باز کردن فاکتور — پیش از بدهی، چون «فاکتور آقای …» نام مشتری دارد
 *   ۳) سؤال گزارشی — پیش از «بدهی»، چون «چند تا بدهکار دارم؟» / «چقدر سود داشتم» فقط سؤال است
 *   ۴) ویرایش قیمت
 *   ۵) افزودن محصول به فهرست کالاها
 *   ۶) بدهی / طلبکاری / تسویه مشتری
 *   ۷) هزینه
 *   ۸) فاکتور فقط اگر کالا تطبیق شد یا جمله واقعاً دستور ثبت کالا باشد
 *   ۹) وگرنه unknown با راهنما — نه «کالایی پیدا نشد»
 */
export function parseAssistantCommand(text: string, context: AssistantContext): AssistantIntent {
  const raw = (text ?? "").trim();
  const norm = normalizeFa(raw);
  if (!norm) return { kind: "unknown", raw, reason: "چیزی شنیده نشد." };

  if (RE_REMINDER.test(norm)) return parseReminder(raw, norm, context);
  if (RE_OPEN_INVOICE.test(norm)) return parseOpenInvoice(raw, norm, context);

  const query = detectQuery(norm);
  if (query) {
    return {
      kind: "query",
      raw,
      queryKind: query.kind,
      answer: buildQueryAnswer(query, {
        products: context.products,
        invoices: context.invoices,
        customers: context.customers,
        expenses: context.expenses,
        now: context.now,
      }),
    };
  }

  if (RE_PRICE_EDIT.test(norm)) return parseProductPriceEdit(raw, norm, context);
  if (RE_PRODUCT_ADD.test(norm) && !RE_TO_INVOICE.test(norm)) return parseProductAdd(raw, norm);
  if (
    RE_LEDGER.test(norm) ||
    RE_CREDITOR.test(norm) ||
    RE_SETTLE.test(norm) ||
    RE_DEBTOR.test(norm)
  ) {
    return parseCustomerDebt(raw, norm, context);
  }
  if (RE_EXPENSE.test(norm)) return parseExpense(raw, norm, context);

  const result = parseVoiceText(raw, context.products);
  const anyProductHit = result.items.some((i) => i.candidates.length > 0);
  if (anyProductHit || looksLikeInvoiceCommand(norm)) {
    return { kind: "invoice_item", raw, result };
  }

  if (looksLikeQuestion(norm)) {
    return {
      kind: "unknown",
      raw,
      reason:
        "سؤال را شنیدم، ولی نوع گزارش را تشخیص ندادم. مثلاً بگویید «امروز چقدر سود داشتم»، «این ماه چقدر فروختم»، یا «چند تا بدهکار دارم».",
    };
  }

  return {
    kind: "unknown",
    raw,
    reason:
      "متوجه نشدم. می‌توانید دستور ثبت بدهید (مثل «۲ تا نون» یا «آقای … بدهکار است») یا سؤال بپرسید (مثل «امروز چقدر سود داشتم»).",
  };
}

/**
 * تبدیل نقش زبانی به نوع تراکنش store:
 *   بدهکار → debt (مانده مثبت)
 *   طلبکار → payment (مانده منفی، یعنی ما به مشتری بدهکاریم)
 *   تسویه روی ماندهٔ مثبت → payment ؛ روی ماندهٔ منفی → debt
 */
export function resolveCustomerTx(
  role: CustomerLedgerRole,
  amount: number,
  settleAll: boolean,
  customer?: Customer,
): { type: "debt" | "payment"; amount: number; note: string } | { error: string } {
  if (role === "debtor") {
    if (amount <= 0) return { error: "مبلغ بدهی نامعتبر است." };
    return { type: "debt", amount, note: "ثبت طلب (دستیار صوتی)" };
  }
  if (role === "creditor") {
    if (amount <= 0) return { error: "مبلغ طلبکاری نامعتبر است." };
    return { type: "payment", amount, note: "بدهی ما به مشتری (دستیار صوتی)" };
  }
  if (!customer) return { error: "برای تسویه باید مشتری از قبل در فهرست باشد." };
  const balance = customerBalance(customer);
  if (settleAll) {
    if (balance > 0) return { type: "payment", amount: balance, note: "تسویه کامل (دستیار صوتی)" };
    if (balance < 0)
      return { type: "debt", amount: -balance, note: "تسویه طلب مشتری (دستیار صوتی)" };
    return { error: `حساب «${customerFullName(customer)}» از قبل تسویه است.` };
  }
  if (amount <= 0) return { error: "مبلغ تسویه نامعتبر است." };
  if (balance < 0) return { type: "debt", amount, note: "تسویه طلب مشتری (دستیار صوتی)" };
  return { type: "payment", amount, note: "تسویه / پرداخت (دستیار صوتی)" };
}
