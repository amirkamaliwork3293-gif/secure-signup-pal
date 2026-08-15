/**
 * تحلیل‌گر نیت «دستیار هوشمند صوتی» — کاملاً محلی، قطعی (deterministic) و بدون
 * هیچ AI/API. سبک نگارش قواعد دقیقاً مثل `persian-nlu.ts` است: نرمال‌سازی متن،
 * جدول کلمات عددی، و امتیازدهی تطبیق رشته (همان `scoreProduct`).
 *
 * ورودی: متن رونویسی‌شده‌ی گفتار.
 * خروجی: یکی از نیت‌های زیر —
 *   customer_debt       بدهی/پرداخت مشتری
 *   expense             ثبت هزینه (با تشخیص تکرارشونده)
 *   product_price_edit  ویرایش قیمت کالا
 *   reminder            یادآوری با تاریخ شمسی و ساعت
 *   query               سؤال گزارشی (فقط خواندن)
 *   invoice_item        پیش‌فرض: همان رفتار فعلی «ثبت صوتی فاکتور»
 *   unknown             هیچ‌کدام
 *
 * قاعده‌ی مهم: هر جمله‌ای که به هیچ‌یک از نیت‌های بالا نخورد، دست‌نخورده به
 * `parseVoiceText` (موتور فعلی فاکتور) سپرده می‌شود؛ پس این لایه هیچ قابلیتی را
 * از بین نمی‌برد و فقط رویش اضافه می‌شود.
 */

import {
  customerFullName,
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
import { buildQueryAnswer, type QueryKind } from "@/lib/voice/assistant-queries";

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

export type AssistantIntent =
  | {
      kind: "customer_debt";
      raw: string;
      /** نامی که از جمله استخراج شد (برای نمایش و ساخت مشتری جدید) */
      customerName: string;
      amount: number;
      /** debt = بدهی جدید، payment = پرداخت/تسویه */
      txType: "debt" | "payment";
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

const RE_REMINDER = /یاداور|یادم بنداز|یادم باشه|به یادم/;
const RE_PRICE_EDIT =
  /ویرایش قیمت|تغییر قیمت|قیمت جدید|قیمتش? ?(رو|را)? ?(عوض|اصلاح|تغییر)|قیمت.*(بشه|بشود|بکن|کن|بذار|بزن)|قیمتش? ?(بشه|بشود)/;
const RE_DEBT = /طلبکار|بدهکار|بدهی|طلب|نسیه اش|تسویه|پرداخت کرد|واریز کرد/;
const RE_EXPENSE = /هزینه|اجاره|قبض|حقوق|فیش|خرج/;
const RE_PAYMENT = /پرداخت کرد|تسویه|واریز کرد|صاف کرد|حساب ?(رو|را)? ?داد|پس داد/;
const RE_APPLY_ALL = /همه|همشون|همه شون|تمام|هرچی|هر چی|هرچه/;

const QUERY_PATTERNS: { kind: QueryKind; re: RegExp }[] = [
  { kind: "most_profitable", re: /پرسود|پر سود|بیشترین سود|سود اورترین|سوداورترین/ },
  { kind: "least_profitable", re: /کم سود|کمسود|کمترین سود|بی سود|بیسود/ },
  { kind: "best_customers", re: /بهترین مشتری|مشتری برتر|وفادارترین مشتری|بیشترین خرید/ },
  { kind: "top_selling", re: /پرفروش|پر فروش|بیشترین فروش|بیشتر فروش رفته/ },
  {
    kind: "debtors",
    re: /چند تا بدهکار|چندتا بدهکار|تعداد بدهکار|بدهکارها|بدهکارانم|چقدر طلب|طلبم چقدر|جمع بدهی/,
  },
  { kind: "today_sales", re: /امروز چقدر فروخت|فروش امروز|چقدر فروش داشتم|فروش امروزم/ },
  {
    kind: "month_expenses",
    re: /چقدر هزینه|جمع هزینه|هزینه ها?ی این ماه|هزینه این ماه|هزینه ها?ی ماه/,
  },
];

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
  if (HONORIFICS.has(t) || DEBT_NOISE.has(t)) return true;
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
  if (EXPENSE_NOISE.has(t)) return true;
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
  if (REMINDER_NOISE.has(t)) return true;
  return /^(یاداور|یادم|یاد|بنداز|باشه)/.test(t) || /^\d+$/.test(t);
}

// ─── تکرارشونده ───────────────────────────────────────────────────────────────

function detectRecurringDays(norm: string): number | undefined {
  if (/ماهانه|ماهیانه|هرماه|هر ماه/.test(norm)) return 30;
  if (/هفتگی|هر هفته/.test(norm)) return 7;
  if (/سالانه|هر سال/.test(norm)) return 365;
  if (/روزانه|هر روز/.test(norm)) return 1;
  return undefined;
}

// ─── تاریخ و ساعت (فقط برای یادآوری) ─────────────────────────────────────────

type TimePart = { h: number; min: number; matched: string };

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

  // «ساعت ۹»، «ساعت ۸ و نیم»
  const bare = semi.match(/ساعت\s*(\d{1,2})(\s*و\s*نیم)?/);
  if (bare) {
    const h = applyPeriod(parseInt(bare[1], 10));
    const min = bare[2] ? 30 : 0;
    if (h >= 0 && h <= 23) return { h, min, matched: bare[0] };
  }
  return null;
}

type DatePart = { jy: number; jm: number; jd: number; matched: string };

/**
 * تاریخ شمسی از متن. هم «۱۴۰۵/۴/۴» و هم «۴/۴/۱۴۰۵» پشتیبانی می‌شود: هر بخشی که
 * ۳–۴ رقمی باشد سال است. تبدیل نهایی با `parseJalaliInput` موجود در store انجام
 * می‌شود تا اعتبارسنجی یکسان بماند.
 */
function extractJalaliDate(semi: string): DatePart | null {
  const m = semi.match(/(\d{1,4})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{1,4})/);
  if (!m) return null;
  const a = m[1];
  const c = m[3];
  let ymd: string | null = null;
  if (a.length >= 3) ymd = `${a}/${m[2]}/${c}`;
  else if (c.length >= 3) ymd = `${c}/${m[2]}/${a}`;
  if (!ymd) return null;
  const parsed = parseJalaliInput(ymd);
  if (!parsed) return null;
  if (parsed.jy < 1300 || parsed.jy > 1500) return null;
  return { ...parsed, matched: m[0] };
}

function relativeDayOffset(norm: string): number | null {
  if (/پس فردا|پسفردا/.test(norm)) return 2;
  if (/فردا/.test(norm)) return 1;
  if (/هفته (دیگه|بعد|اینده)/.test(norm)) return 7;
  if (/ماه (دیگه|بعد|اینده)/.test(norm)) return 30;
  if (/امروز/.test(norm)) return 0;
  return null;
}

// ─── نیت‌ها ───────────────────────────────────────────────────────────────────

function parseCustomerDebt(raw: string, norm: string, ctx: AssistantContext): AssistantIntent {
  const { amount, restTokens } = extractAmount(tokensOf(norm));
  if (amount <= 0) {
    return {
      kind: "unknown",
      raw,
      reason: "مبلغ را نفهمیدم. مثلاً بگویید «آقای شهریاری ۲۵۰ هزار تومان بدهکار است».",
    };
  }
  const name = joinClean(restTokens, isDebtNoise);
  if (!name) {
    return { kind: "unknown", raw, reason: "نام مشتری را نفهمیدم. نام را همراه مبلغ بگویید." };
  }
  const candidates = matchCustomers(name, ctx.customers);
  return {
    kind: "customer_debt",
    raw,
    customerName: name,
    amount,
    txType: RE_PAYMENT.test(norm) ? "payment" : "debt",
    candidates,
    clearWinner: isClearWinner(candidates.map((c) => c.score)),
  };
}

function parseExpense(raw: string, norm: string): AssistantIntent {
  const { amount, restTokens } = extractAmount(tokensOf(norm));
  if (amount <= 0) {
    return {
      kind: "unknown",
      raw,
      reason: "مبلغ هزینه را نفهمیدم. مثلاً بگویید «ماهانه ۴۵ میلیون هزینه اجاره خانه».",
    };
  }
  const cleaned = joinClean(restTokens, isExpenseNoise);
  const title = cleaned || "هزینه";
  return { kind: "expense", raw, title, amount, recurringDays: detectRecurringDays(norm) };
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
  const semi = normalizeKeepSeparators(raw);

  const date = extractJalaliDate(semi);
  const time = extractTime(semi);

  // متن باقی‌مانده برای عنوان — تاریخ و ساعت از آن حذف می‌شوند
  let rest = semi;
  if (date) rest = rest.replace(date.matched, " ");
  if (time) rest = rest.replace(time.matched, " ");
  const title = joinClean(tokensOf(normalizeFa(rest)), isReminderNoise) || "یادآوری";

  const offset = date ? null : relativeDayOffset(norm);
  const today = toJalali(now);
  const h = time ? time.h : 9;
  const min = time ? time.min : 0;

  let dueAt = now;
  try {
    if (date) {
      dueAt = jalaliToTimestamp(date.jy, date.jm, date.jd, h, min);
    } else if (today) {
      dueAt = jalaliToTimestamp(today.jy, today.jm, today.jd, h, min) + (offset ?? 0) * 86_400_000;
    }
  } catch {
    // تاریخ شمسی نامعتبر (سال خارج از بازه‌ی تقویم) → امروز با ساعت گفته‌شده
    dueAt = now;
  }

  return {
    kind: "reminder",
    raw,
    title,
    dueAt,
    timeDefaulted: !time,
    dateDefaulted: !date && offset === null,
    recurringDays: detectRecurringDays(norm),
  };
}

function detectQueryKind(norm: string): QueryKind | null {
  for (const q of QUERY_PATTERNS) if (q.re.test(norm)) return q.kind;
  return null;
}

// ─── تابع اصلی ────────────────────────────────────────────────────────────────

/**
 * تشخیص نیت یک دستور صوتی. ترتیب بررسی مهم است:
 *   ۱) یادآوری   — کلیدواژه‌ی اختصاصی، هیچ تداخلی ندارد
 *   ۲) سؤال گزارشی — پیش از «بدهی»، چون «چند تا بدهکار دارم؟» فقط یک سؤال است
 *   ۳) ویرایش قیمت — پیش از هزینه/بدهی، چون جمله‌اش مبلغ‌دار است
 *   ۴) بدهی مشتری
 *   ۵) هزینه
 *   ۶) در نهایت: همان موتور فعلی فاکتور (رفتار پیش‌فرض دست‌نخورده)
 */
export function parseAssistantCommand(text: string, context: AssistantContext): AssistantIntent {
  const raw = (text ?? "").trim();
  const norm = normalizeFa(raw);
  if (!norm) return { kind: "unknown", raw, reason: "چیزی شنیده نشد." };

  if (RE_REMINDER.test(norm)) return parseReminder(raw, norm, context);

  const queryKind = detectQueryKind(norm);
  if (queryKind) {
    return {
      kind: "query",
      raw,
      queryKind,
      answer: buildQueryAnswer(queryKind, {
        products: context.products,
        invoices: context.invoices,
        customers: context.customers,
        expenses: context.expenses,
        now: context.now,
      }),
    };
  }

  if (RE_PRICE_EDIT.test(norm)) return parseProductPriceEdit(raw, norm, context);
  if (RE_DEBT.test(norm)) return parseCustomerDebt(raw, norm, context);
  if (RE_EXPENSE.test(norm)) return parseExpense(raw, norm);

  // پیش‌فرض: افزودن کالا به فاکتور — دقیقاً همان موتور صفحه‌ی /voice
  const result = parseVoiceText(raw, context.products);
  if (result.items.length > 0) return { kind: "invoice_item", raw, result };

  return {
    kind: "unknown",
    raw,
    reason: "متوجه نشدم. می‌توانید متن را ویرایش کنید و دوباره بفرستید.",
  };
}
