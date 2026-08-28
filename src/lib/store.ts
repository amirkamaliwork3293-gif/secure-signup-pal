import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invoiceTotals, purchaseTotals } from "@/lib/invoice-math";
import { namesReferToSamePerson } from "@/lib/search";
import {
  catalogLooksVandalized,
  isProtectedCatalogField,
  preferCloudValue,
} from "@/lib/catalog-integrity";
import {
  stockDeltasForSoldItems,
  expandRecipeForQty,
  ingredientsUsedOnSale,
  type RecipeIngredient,
  type ProductionEvent,
} from "@/lib/production";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
  code: string;
  stock: number;
  description?: string;
  lowStockThreshold?: number;
  /** قیمت خرید — برای محاسبه سود و زیان (اختیاری) */
  buyPrice?: number;
  /** قیمت مصرف‌کننده (اختیاری) */
  consumerPrice?: number;
  /** قیمت فروشنده/همکار (اختیاری) */
  sellerPrice?: number;
  /** درصد تخفیف پیشنهادی (اختیاری) */
  discountPercent?: number;
  /** واحد فروش: «عدد» یا واحدهای وزنی وقتی فروش وزنی فعال باشد */
  unit?: string;
  /** قیمت عمده/کارتنی (اختیاری) — برای فروش تعداد بالا */
  wholesalePrice?: number;
  /** حداقل تعداد برای اعمال خودکار قیمت عمده (اختیاری) */
  wholesaleMinQty?: number;
  /** تاریخ انقضا (timestamp میلی‌ثانیه) — کاملاً اختیاری */
  expiryAt?: number;
  /**
   * فرمول تولید اختیاری: مواد لازم برای ساخت یک واحد از این محصول.
   * اگر خالی باشد، فروش فقط موجودی خود محصول را کم می‌کند.
   */
  recipe?: RecipeIngredient[];
};

export const COUNT_UNIT = "عدد";
export const WEIGHT_UNITS = ["کیلوگرم", "گرم"] as const;

/**
 * تعریف یک واحد فروش دلخواه (کیلوگرم، متر، متر مربع، متر مکعب، لیتر، بسته و...).
 * کاربر می‌تواند از میان واحدهای پیش‌فرض انتخاب کند یا واحد جدید تعریف کند.
 */
export type UnitDef = {
  /** نام یکتای واحد، مثلاً «کیلوگرم» یا «متر مربع» */
  name: string;
  /** آیا برای این واحد مقدار اعشاری مجاز است؟ (وزن/مساحت/حجم: بله — عدد/بسته: خیر) */
  allowDecimal: boolean;
};

export const DEFAULT_UNITS: UnitDef[] = [
  { name: COUNT_UNIT, allowDecimal: false },
  { name: "کیلوگرم", allowDecimal: true },
  { name: "گرم", allowDecimal: true },
];

/** فهرست واحدهای فعلی فروشگاه (پیش‌فرض‌ها + واحدهای سفارشی که کاربر اضافه کرده) */
export function getUnitDefs(): UnitDef[] {
  const custom = settings.get().units;
  if (!custom || custom.length === 0) return DEFAULT_UNITS;
  return custom.some((u) => u.name === COUNT_UNIT) ? custom : [DEFAULT_UNITS[0], ...custom];
}

/** ذخیره‌ی فهرست کامل واحدها (جایگزین می‌کند، نه اضافه) */
export function saveUnitDefs(list: UnitDef[]) {
  settings.save({ ...settings.get(), units: list });
}

/** افزودن یک واحد جدید (اگر نام تکراری نباشد) */
export function addUnitDef(u: UnitDef): UnitDef[] {
  const list = getUnitDefs();
  if (list.some((x) => x.name === u.name)) return list;
  const next = [...list, u];
  saveUnitDefs(next);
  return next;
}

/** حذف یک واحد از فهرست تعریف‌شده‌ها (واحد پایه‌ی «عدد» قابل حذف نیست) */
export function removeUnitDef(name: string): UnitDef[] {
  if (name === COUNT_UNIT) return getUnitDefs();
  const next = getUnitDefs().filter((u) => u.name !== name);
  saveUnitDefs(next);
  return next;
}

export function isWeightUnit(unit?: string): boolean {
  if (!unit || unit === COUNT_UNIT) return false;
  const def = getUnitDefs().find((u) => u.name === unit);
  if (def) return def.allowDecimal;
  // واحد سفارشیِ ناشناس (مثلاً داده‌ی قدیمی) — برای اطمینان، اعشار مجاز فرض می‌شود
  return true;
}

export type Category = {
  id: string;
  name: string;
  color?: string;
};

export type InvoiceItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  /** قیمت خرید در لحظه فروش — برای گزارش سود */
  buyPrice?: number;
  /** واحد فروش (عدد / کیلوگرم / گرم) */
  unit?: string;
  /** درصد تخفیفی که در لحظه‌ی فروش روی این کالا اعمال شده (در صورت وجود) */
  discountPercent?: number;
  /** قیمت اصلی قبل از تخفیف — فقط وقتی تخفیفی اعمال شده باشد */
  originalPrice?: number;
};

export type CustomerInfo = {
  firstName?: string;
  lastName?: string;
  phone?: string;
};

export type PaymentMethod = "cash" | "card" | "credit" | "check";

/**
 * یک برگ چک دریافتی — منطبق با روال صیادی ایران.
 * تاریخ سررسید به‌صورت ISO (YYYY-MM-DD) یا شمسی (YYYY/MM/DD) ذخیره می‌شود.
 */
export type InvoiceCheque = {
  id: string;
  /** مبلغ این برگ چک (تومان) */
  amount: number;
  /** شماره سریال چک (اختیاری) */
  serial?: string;
  /** شناسه صیادی ۱۶ رقمی */
  sayadi?: string;
  /** نام بانک عهده */
  bankName?: string;
  /** تاریخ سررسید */
  dueDate?: string;
  /** نام صادرکننده / عهده (معمولاً مشتری) */
  drawerName?: string;
  /** شماره حساب عهده (اختیاری) */
  accountNumber?: string;
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "نقد",
  card: "کارت",
  credit: "نسیه",
  check: "چک",
};

export type Invoice = {
  id: string;
  createdAt: number;
  items: InvoiceItem[];
  total: number;
  customer?: CustomerInfo;
  shopName?: string;
  /** آدرس فروشگاه — از تنظیمات، برای نمایش روی فاکتور */
  shopAddress?: string;
  /** شماره تماس فروشگاه — از تنظیمات، برای نمایش روی فاکتور */
  shopPhone?: string;
  /** لوگوی فروشگاه — از تنظیمات، برای نمایش روی فاکتور چاپی/PDF (اختیاری) */
  shopLogoUrl?: string;
  paymentMethod?: PaymentMethod;
  /** مبلغ نقد پرداخت‌شده (برای نسیهٔ جزئی یا فاکتور چک با پیش‌پرداخت نقدی) */
  paidAmount?: number;
  /** مبلغ چک صادرشده توسط مشتری (برای روش پرداخت «چک») — مجموع چک‌ها */
  checkAmount?: number;
  /** شماره چک — اختیاری؛ برای سازگاری با فاکتورهای قدیمیِ تک‌چکی */
  checkNumber?: string;
  /** تاریخ سررسید چک (ISO یا شمسی YYYY/MM/DD) — اختیاری؛ سررسیدِ زودترین چک */
  checkDueDate?: string;
  /**
   * فهرست چک‌های دریافتی برای یک خرید (سیستم صیادی ایران).
   * مشتری ممکن است چند برگ چک با سررسیدهای مختلف بدهد.
   * فیلدهای checkAmount / checkNumber / checkDueDate برای سازگاری نگه داشته شده‌اند.
   */
  cheques?: InvoiceCheque[];
  /** توضیحات اختیاری فاکتور — در صورت وجود، روی فاکتور چاپی/PDF/اشتراک‌گذاری هم نمایش داده می‌شود */
  notes?: string;
  /** جمع اقلام پیش از تخفیف کل فاکتور */
  subtotal?: number;
  /** درصد تخفیف روی کل فاکتور (۰ تا ۱۰۰) */
  discountPercent?: number;
  /** مبلغ تخفیف کل فاکتور (اگر درصد وارد شود، از روی آن محاسبه می‌شود) */
  discountAmount?: number;
  /** درصد مالیات روی کل فاکتور (۰ تا ۱۰۰) — روی «جمع اقلام − تخفیف» اعمال می‌شود (اختیاری) */
  taxPercent?: number;
  /**
   * مقدار خانه‌های سفارشی «طراح فاکتور» که کاربر هنگام ثبت فاکتور پر کرده است.
   * کلید = شناسه‌ی فیلد در قالب فاکتور.
   */
  customFields?: Record<string, string>;
  /**
   * عنوان سند چاپی — مثلاً «پیش‌فاکتور». خالی یعنی همان «فاکتور فروش».
   * روی فاکتور ثبت‌شده در تاریخچه ذخیره نمی‌شود.
   */
  documentTitle?: string;
};

/** عنوان نمایشی سند فاکتور (چاپ / پیش‌نمایش / PDF) */
export function invoiceDocumentTitle(inv: Pick<Invoice, "documentTitle">): string {
  const t = inv.documentTitle?.trim();
  return t || "فاکتور فروش";
}

// ─── Purchase invoices (خرید از تامین‌کننده) ─────────────────────────────────

export type PurchaseItem = {
  /** اگر کالا از قبل در انبار موجود بوده، شناسه‌اش؛ وگرنه خالی و با ثبت، کالای جدید ساخته می‌شود */
  productId: string;
  name: string;
  quantity: number;
  /** قیمت خرید واحد در این فاکتور — بعد از ثبت، قیمت خرید کالا به‌روزرسانی می‌شود */
  buyPrice: number;
  /** قیمت فروش پیشنهادی برای کالای جدید (اختیاری، فقط هنگام ساخت کالای جدید) */
  sellPrice?: number;
  unit?: string;
  category?: string;
};

export type Purchase = {
  id: string;
  createdAt: number;
  items: PurchaseItem[];
  total: number;
  supplierName?: string;
  supplierPhone?: string;
  note?: string;
  paymentMethod?: PaymentMethod;
  /** مبلغ نقد پرداخت‌شده از این فاکتور خرید (اگر نسیه/چک بود، باقی بدهی به تامین‌کننده است) */
  paidAmount?: number;
  /** نام فروشگاه — از تنظیمات، برای نمایش روی فاکتور چاپی */
  shopName?: string;
  /** لوگوی فروشگاه — از تنظیمات، برای نمایش روی فاکتور چاپی/PDF (اختیاری) */
  shopLogoUrl?: string;
  /** درصد تخفیف روی کل فاکتور خرید (۰ تا ۱۰۰) */
  discountPercent?: number;
  /** مبلغ تخفیف کل فاکتور خرید */
  discountAmount?: number;
};

export function emptyPurchase(): Purchase {
  return { id: cryptoId(), createdAt: Date.now(), items: [], total: 0, paymentMethod: "cash" };
}

export function recalcPurchase(p: Purchase): Purchase {
  return { ...p, total: purchaseTotals(p).total };
}

// ─── Customers / Debtors ─────────────────────────────────────────────────────

export type CustomerTx = {
  id: string;
  /** debt = بدهی جدید، payment = پرداخت/تسویه */
  type: "debt" | "payment";
  amount: number;
  note?: string;
  at: number;
  /** اگر بدهی از ثبت فاکتور نسیه ایجاد شده باشد */
  invoiceId?: string;
};

export type Customer = {
  id: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  note?: string;
  createdAt: number;
  txs: CustomerTx[];
  /**
   * تاریخ تسویه توافقی (اختیاری) به‌صورت شمسی YYYY/MM/DD.
   * اگر مانده بدهی صفر شود، هنگام ثبت پرداخت پاک می‌شود.
   */
  settlementDate?: string;
};

/** مانده حساب مشتری: مثبت یعنی بدهکار است */
export function customerBalance(c: Customer): number {
  return c.txs.reduce((s, t) => s + (t.type === "debt" ? t.amount : -t.amount), 0);
}

/** وضعیت هشدار موعد تسویه مشتری بدهکار */
export type SettlementAlertKind = "overdue" | "today" | "tomorrow";

/** فاصله روز تا تاریخ شمسی YYYY/MM/DD (منفی = گذشته). نامعتبر → null */
export function jalaliDaysFromToday(dateStr?: string): number | null {
  if (!dateStr) return null;
  const p = parseJalaliInput(dateStr);
  if (!p) return null;
  return Math.round((jalaliToTimestamp(p.jy, p.jm, p.jd, 0, 0) - todayStartTs()) / 86_400_000);
}

/**
 * اگر مشتری بدهکار باشد و تاریخ تسویه امروز، فردا یا عقب‌افتاده باشد،
 * نوع هشدار را برمی‌گرداند؛ در غیر این صورت null.
 */
export function settlementAlertKind(c: Customer): SettlementAlertKind | null {
  if (customerBalance(c) <= 0) return null;
  const days = jalaliDaysFromToday(c.settlementDate);
  if (days == null) return null;
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return null;
}

/** مشتریان بدهکاری که موعد تسویه‌شان امروز، فردا یا گذشته است */
export function dueSettlementCustomers(list: Customer[]): Array<{
  customer: Customer;
  kind: SettlementAlertKind;
}> {
  const rank: Record<SettlementAlertKind, number> = { overdue: 0, today: 1, tomorrow: 2 };
  return list
    .map((customer) => {
      const kind = settlementAlertKind(customer);
      return kind ? { customer, kind } : null;
    })
    .filter((x): x is { customer: Customer; kind: SettlementAlertKind } => x != null)
    .sort(
      (a, b) =>
        rank[a.kind] - rank[b.kind] || customerBalance(b.customer) - customerBalance(a.customer),
    );
}

/** متن آماده‌ی پیامک یادآور بدهی — قابل ویرایش قبل از ارسال نیمه‌دستی */
export function buildDebtReminderText(c: Customer, shopName: string): string {
  const amount = customerBalance(c);
  const due = c.settlementDate ? formatJalaliYmd(c.settlementDate) : "";
  const dueLine = due ? `\nموعد تسویه: ${due}` : "";
  return (
    `سلام ${customerFullName(c)} عزیز،\n` +
    `یادآور بدهی شما به ${shopName || "فروشگاه ما"}:\n` +
    `مبلغ: ${formatToman(amount)}${dueLine}\n` +
    `لطفاً در اولین فرصت نسبت به تسویه اقدام بفرمایید. با تشکر.`
  );
}

export function customerFullName(c: Customer): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
}

/** فاکتورهای فروشی که مشتری در آن‌ها (بر اساس تلفن یا نام/فامیل) طرف حساب بوده */
export function invoicesOfCustomer(customer: Customer, allInvoices: Invoice[]): Invoice[] {
  const phone = customer.phone?.trim();
  return allInvoices.filter((inv) => {
    const c = inv.customer;
    if (!c) return false;
    if (phone && c.phone?.trim() === phone) return true;
    return namesReferToSamePerson(customer, c);
  });
}

// ─── Storage Keys ────────────────────────────────────────────────────────────

const PRODUCTS_KEY = "acc.products.v2";
const CATEGORIES_KEY = "acc.categories.v1";
const INVOICE_KEY = "acc.currentInvoice.v2";
const HISTORY_KEY = "acc.invoices.v2";
const SETTINGS_KEY = "acc.settings.v1";
const CUSTOMERS_KEY = "acc.customers.v1";
const STUDENTS_KEY = "acc.students.v1";
const PURCHASES_KEY = "acc.purchases.v1";
const EXPENSES_KEY = "acc.expenses.v1";
const MANUAL_LEDGER_KEY = "acc.manual_ledger.v1";
const REMINDERS_KEY = "acc.reminders.v1";
const ACCOUNTS_KEY = "acc.accounts.v1";
const ACCOUNT_TXS_KEY = "acc.account_txs.v1";
const PRODUCTION_KEY = "acc.production.v1";
export const STORAGE_SCOPE_KEY = "kamali.auth.scope.v1";
// Persisted set of cloud field names that have local changes not yet confirmed
// synced to the server. Survives reloads so offline edits are never dropped.
const CLOUD_DIRTY_KEY = "acc.cloudDirty.v1";

// Mapping of localStorage key -> cloud column name in user_data
const CLOUD_FIELDS: Record<
  string,
  | "products"
  | "categories"
  | "invoices"
  | "current_invoice"
  | "settings"
  | "customers"
  | "students"
  | "purchases"
  | "expenses"
  | "manual_ledger"
  | "reminders"
  | "accounts"
  | "account_txs"
  | "production"
> = {
  [PRODUCTS_KEY]: "products",
  [CATEGORIES_KEY]: "categories",
  [HISTORY_KEY]: "invoices",
  [INVOICE_KEY]: "current_invoice",
  [SETTINGS_KEY]: "settings",
  [CUSTOMERS_KEY]: "customers",
  [STUDENTS_KEY]: "students",
  [PURCHASES_KEY]: "purchases",
  [EXPENSES_KEY]: "expenses",
  [MANUAL_LEDGER_KEY]: "manual_ledger",
  [REMINDERS_KEY]: "reminders",
  [ACCOUNTS_KEY]: "accounts",
  [ACCOUNT_TXS_KEY]: "account_txs",
  [PRODUCTION_KEY]: "production",
};

// Reverse map: cloud column name -> local storage key
const FIELD_TO_LOCAL_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(CLOUD_FIELDS).map(([k, v]) => [v, k]),
);

export type AppSettings = {
  invoiceFontSize: number;
  shopName: string;
  /** منسوخ‌شده — قبلاً برای فعال/غیرفعال کردن سراسری واحدهای وزنی استفاده می‌شد.
   *  حالا واحدها همیشه در فرم هر محصول در دسترس‌اند (به فیلد «units» زیر نگاه کنید).
   *  این فیلد فقط برای سازگاری با داده‌های قدیمی نگه داشته شده و در UI استفاده نمی‌شود. */
  weightUnits?: boolean;
  /** فهرست واحدهای فروش تعریف‌شده توسط کاربر (عدد/کیلوگرم/گرم/متر/... به‌همراه مجاز بودن اعشار) */
  units?: UnitDef[];
  // ─── پروفایل عمومی فروشگاه (اختیاری) — برای صفحه عمومی /store/[id] ───
  /** آدرس فروشگاه */
  storeAddress?: string;
  /** شماره تماس‌ها (یک یا چند شماره) */
  storePhones?: string[];
  /** ساعات کاری */
  businessHours?: string;
  /** آیدی/لینک اینستاگرام */
  instagram?: string;
  /** آیدی/لینک تلگرام */
  telegram?: string;
  /** شماره/لینک واتساپ بیزینس */
  whatsapp?: string;
  /** آیدی یا شماره روبیکا */
  rubika?: string;
  /** آیدی یا شماره ایتا */
  eitaa?: string;
  /** آیدی یا شماره بله */
  bale?: string;
  /** توضیح کوتاه فروشگاه */
  storeDescription?: string;
  /** آدرس لوگو یا تصویر فروشگاه */
  logoUrl?: string;
  /** نمایش گزینه «منو» در نوار پایین — پیش‌فرض غیرفعال (برای فروشگاه‌های عادی نیازی نیست) */
  showMenuFeature?: boolean;
  /** نمایش گزینه «هنرجویان/شهریه‌پرداز» در نوار پایین — پیش‌فرض غیرفعال */
  showStudentsFeature?: boolean;
  /** نمایش بخش «طلا» (نرخ لحظه‌ای + فاکتور طلا) در نوار پایین — پیش‌فرض غیرفعال */
  showGoldFeature?: boolean;
  /** نمایش بخش «یادآوری‌ها» (پیگیری مشتریان و وظایف) در نوار پایین — پیش‌فرض فعال */
  showRemindersFeature?: boolean;
  /**
   * نمایش بخش «تولید و فرمول» — پیش‌فرض غیرفعال تا برای فروشگاه‌هایی
   * که تولید ندارند برنامه شلوغ نشود.
   */
  showProductionFeature?: boolean;
  /**
   * پیگیری موجودی انبار. پیش‌فرض فعال است.
   * اگر false باشد موجودی هنگام ثبت فاکتور کم نمی‌شود و بخش انبار پنهان است.
   */
  trackInventory?: boolean;
  /** واحد نمایش و ورود مبالغ — پیش‌فرض تومان؛ ذخیره همیشه به تومان است */
  currencyUnit?: "toman" | "rial";
  /** چیدمان سفارشی فاکتور چاپی (طراح فاکتور) — ساختار در ‎@/lib/invoice-template‎ */
  invoiceTemplate?: { [key: string]: JsonValue };
  /** اندازه کاغذ چاپ فاکتور فروش — محتوا روی همین برگه مقیاس می‌شود تا دو صفحه نشود */
  invoicePaperSize?: "A4" | "A5" | "Letter";
  /** دسته‌بندی‌های هزینه‌ی سفارشی کاربر (علاوه بر EXPENSE_CATEGORIES پیش‌فرض) */
  expenseCategories?: string[];
  /** مرحله‌ی فعلی تور شروع کار (۰ = هنوز تصمیم گرفته نشده / شروع نشده) */
  onboardingStep?: number;
  /** اگر کاربر «رد کردن آموزش» را زده باشد، تور خودکار دیگر نشان داده نمی‌شود */
  onboardingDismissed?: boolean;
  /** شناسه‌ی مراحلی که قبلاً دیده شده‌اند تا با برگشت به همان صفحه تکرار نشوند */
  onboardingCompletedSteps?: string[];
  /** دستیار هوشمند حداقل یک‌بار باز شده — فقط برای چک‌لیست شروع کار */
  assistantOpened?: boolean;
  /**
   * آیا این کاربر مشمول تور/چک‌لیست شروع کار است؟
   * فقط برای ثبت‌نام‌های جدید (از زمان انتشار این قابلیت) true می‌شود.
   * کاربران قدیمی صریحاً false می‌شوند تا تور هیچ‌وقت برایشان باز نشود.
   */
  onboardingEligible?: boolean;
  /**
   * پنجره‌ی «دانلود اپ» قبل از آموزش برای کاربر تازه‌ثبت‌نام در سایت.
   * true یعنی دیده/بسته شده و دیگر نشان داده نشود.
   */
  apkWelcomeDismissed?: boolean;
};

/** مقدار سازگار با JSON — برای فیلدهای آزادِ ذخیره‌شده در ابر */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const DEFAULT_SETTINGS: AppSettings = {
  shopName: "فروشگاه من",
  invoiceFontSize: 13,
  invoicePaperSize: "A4",
  weightUnits: false,
  showMenuFeature: false,
  showStudentsFeature: false,
  showGoldFeature: false,
  showRemindersFeature: true,
  showProductionFeature: false,
  trackInventory: true,
};

function getStorageScope() {
  if (typeof window === "undefined") return "anon";
  return localStorage.getItem(STORAGE_SCOPE_KEY) || "anon";
}

function scopedKey(key: string, scope = getStorageScope()) {
  return `${key}:${scope}`;
}

export function setStorageScope(scope: string | null) {
  if (typeof window === "undefined") return;
  const nextScope = scope || "anon";
  localStorage.setItem(STORAGE_SCOPE_KEY, nextScope);
  window.dispatchEvent(
    new CustomEvent("store-change", { detail: { scopeChanged: true, scope: nextScope } }),
  );
}

// ─── Default categories ──────────────────────────────────────────────────────

const DEFAULT_CATEGORIES: Category[] = [
  { id: "cat-1", name: "مواد غذایی", color: "#22c55e" },
  { id: "cat-2", name: "نوشیدنی", color: "#3b82f6" },
  { id: "cat-3", name: "لبنیات", color: "#f59e0b" },
  { id: "cat-4", name: "لوازم تحریر", color: "#8b5cf6" },
  { id: "cat-5", name: "آرایشی", color: "#ec4899" },
  { id: "cat-6", name: "خدمات", color: "#6b7280" },
];

// ─── Core helpers ────────────────────────────────────────────────────────────

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(scopedKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalOnly<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  const keyWithScope = scopedKey(key);
  localStorage.setItem(keyWithScope, JSON.stringify(value));
  // مقدار تازه را داخل خود رویداد می‌فرستیم تا مشترک‌ها مجبور نباشند کل داده را
  // دوباره از localStorage بخوانند و JSON.parse کنند — این باعث می‌شود ثبت هر
  // تغییر (ثبت پرداخت، افزودن کالا، ...) و همچنین هیدریت اولیه‌ی ابری روان‌تر شود.
  window.dispatchEvent(
    new CustomEvent("store-change", { detail: { key: keyWithScope, baseKey: key, value } }),
  );
}

function write<T>(key: string, value: T) {
  writeLocalOnly(key, value);
  scheduleCloudPush(key, value);
}

// ─── Cloud sync ──────────────────────────────────────────────────────────────

let cloudUserId: string | null = null;
// Until the cloud row has been read for this session, we must not push local
// state up: a fresh/cleared browser could otherwise overwrite real cloud data
// with empty arrays. Restored offline edits are flushed explicitly after
// hydration finishes.
let cloudHydrated = false;

function markCloudHydrated() {
  cloudHydrated = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("store-hydrated"));
  }
}

/** آیا داده‌ی ابری این نشست خوانده شده (یا تلاش اول تمام شده) — برای تور شروع کار */
export function isCloudHydrated() {
  return cloudHydrated;
}
const pendingPush: Record<string, unknown> = {};
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 5000;

function readDirtySet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(scopedKey(CLOUD_DIRTY_KEY));
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeDirtySet(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    if (set.size === 0) localStorage.removeItem(scopedKey(CLOUD_DIRTY_KEY));
    else localStorage.setItem(scopedKey(CLOUD_DIRTY_KEY), JSON.stringify([...set]));
  } catch {}
}

function markDirty(fields: string[]) {
  const set = readDirtySet();
  for (const f of fields) set.add(f);
  writeDirtySet(set);
}

function clearDirty(fields: string[]) {
  const set = readDirtySet();
  for (const f of fields) set.delete(f);
  writeDirtySet(set);
}

// ─── وضعیت همگام‌سازی (برای نمایش به کاربر — خطای ذخیره هرگز بی‌صدا نماند) ──
export type SyncState = {
  /** تعداد بخش‌هایی که تغییرشان هنوز روی سرور ذخیره نشده */
  pending: number;
  /** آخرین تلاش ذخیره ناموفق بوده و در حال تلاش مجدد هستیم */
  failed: boolean;
  /** پیام خطای آخرین شکست (برای لاگ/نمایش) */
  lastError?: string;
  /** زمان آخرین ذخیره‌ی موفق روی سرور */
  lastOkAt?: number;
};

let syncState: SyncState = { pending: 0, failed: false };

function publishSyncState(patch: Partial<SyncState>) {
  syncState = { ...syncState, ...patch };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("store-sync", { detail: syncState }));
  }
}

export function getSyncState(): SyncState {
  return syncState;
}

/** هوک نمایش وضعیت همگام‌سازی (نوار هشدار بالای صفحه) */
export function useSyncState(): SyncState {
  const [s, setS] = useState<SyncState>(() => ({
    ...syncState,
    // تغییرات همگام‌نشده‌ی جامانده از نشست قبلی هم باید شمرده شوند
    pending: syncState.pending || readDirtySet().size,
  }));
  useEffect(() => {
    const onSync = (e: Event) => setS({ ...(e as CustomEvent<SyncState>).detail });
    window.addEventListener("store-sync", onSync);
    return () => window.removeEventListener("store-sync", onSync);
  }, []);
  return s;
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (cloudUserId && Object.keys(pendingPush).length > 0) {
      flushCloudPush();
    }
  }, retryDelay);
  // Exponential backoff, capped at 5 minutes
  retryDelay = Math.min(retryDelay * 2, 5 * 60 * 1000);
}

function scheduleCloudPush(key: string, value: unknown) {
  const field = CLOUD_FIELDS[key];
  if (!field) return;
  if (!cloudUserId) {
    // هنوز کاربر/همگام‌سازی آماده نیست (مثلاً درست بعد از باز شدن برنامه و پیش از
    // پایان hydrate). نشانه‌ی «تغییر همگام‌نشده» را همین‌جا ثبت می‌کنیم تا این
    // نوشتن در اولین hydrate بعدی از localStorage خوانده و به سرور فرستاده شود.
    markDirty([field]);
    return;
  }
  pendingPush[field] = value;
  // Persist dirty marker immediately so a page reload before the debounced
  // flush still knows this field has unsynced local changes.
  markDirty([field]);
  publishSyncState({ pending: readDirtySet().size });
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(flushCloudPush, 600);
}

function localValueForCloudField(field: string): unknown {
  if (field in pendingPush) return pendingPush[field];
  const localKey = FIELD_TO_LOCAL_KEY[field];
  if (!localKey) return null;
  try {
    const raw = localStorage.getItem(scopedKey(localKey));
    return raw != null ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function adoptCloudField(field: string, cloudValue: unknown) {
  const localKey = FIELD_TO_LOCAL_KEY[field];
  if (localKey && cloudValue != null) writeLocalOnly(localKey, cloudValue);
  delete pendingPush[field];
  clearDirty([field]);
}

/**
 * قبل از upsert: اگر کاتالوگ محلی خراب است و نسخهٔ زندهٔ ابر سالم/غنی‌تر است،
 * همان فیلد را از صف حذف می‌کنیم تا فحاشی دوباره روی سوپابیس نرود.
 */
async function dropVandalizedCatalogPushes(
  userId: string,
  fieldsToPush: Record<string, unknown>,
): Promise<void> {
  const protectedInPush = Object.keys(fieldsToPush).filter(isProtectedCatalogField);
  if (protectedInPush.length === 0) return;

  let live: Record<string, unknown> | null = null;
  let liveOk = false;
  try {
    const { data, error } = await supabase
      .from("user_data")
      .select(protectedInPush.join(","))
      .eq("user_id", userId)
      .maybeSingle();
    if (!error) {
      live = (data ?? null) as Record<string, unknown> | null;
      liveOk = true;
    }
  } catch {
    liveOk = false;
  }

  for (const field of protectedInPush) {
    const localVal = fieldsToPush[field];
    if (liveOk) {
      const cloudVal = live?.[field];
      if (preferCloudValue(localVal, cloudVal, field)) {
        adoptCloudField(field, cloudVal);
        delete fieldsToPush[field];
      }
      continue;
    }
    // نتوانستیم ابر را بخوانیم: کاتالوگ فحاشی‌شده را هرگز بالا نفرست.
    if (catalogLooksVandalized(localVal, field)) {
      delete fieldsToPush[field];
    }
  }
}

async function flushCloudPush() {
  pushTimer = null;
  if (!cloudUserId) return;
  if (!cloudHydrated) {
    // Keep everything queued; hydrateFromCloud() triggers the flush when done.
    return;
  }
  const fieldsToPush = { ...pendingPush };
  const userId = cloudUserId;
  await dropVandalizedCatalogPushes(userId, fieldsToPush);
  const fieldNames = Object.keys(fieldsToPush);
  if (fieldNames.length === 0) {
    publishSyncState({
      pending: readDirtySet().size,
      failed: false,
      lastError: undefined,
    });
    return;
  }
  const payload: Record<string, unknown> = {
    ...fieldsToPush,
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  try {
    let { error } = await supabase
      .from("user_data")
      .upsert(payload as never, { onConflict: "user_id" });
    // If the customers column doesn't exist yet in this deployment, retry without
    // it so syncing of products/invoices/settings is never blocked.
    if (error && /customers/.test(error.message) && "customers" in payload) {
      delete payload.customers;
      const retry = await supabase
        .from("user_data")
        .upsert(payload as never, { onConflict: "user_id" });
      error = retry.error;
    }
    if (error && /students/.test(error.message) && "students" in payload) {
      delete payload.students;
      const retry = await supabase
        .from("user_data")
        .upsert(payload as never, { onConflict: "user_id" });
      error = retry.error;
    }
    if (error && /purchases/.test(error.message) && "purchases" in payload) {
      delete payload.purchases;
      const retry = await supabase
        .from("user_data")
        .upsert(payload as never, { onConflict: "user_id" });
      error = retry.error;
    }
    if (error && /expenses/.test(error.message) && "expenses" in payload) {
      delete payload.expenses;
      const retry = await supabase
        .from("user_data")
        .upsert(payload as never, { onConflict: "user_id" });
      error = retry.error;
    }
    if (error && /reminders/.test(error.message) && "reminders" in payload) {
      delete payload.reminders;
      const retry = await supabase
        .from("user_data")
        .upsert(payload as never, { onConflict: "user_id" });
      error = retry.error;
    }
    if (error && /accounts/.test(error.message) && "accounts" in payload) {
      delete payload.accounts;
      const retry = await supabase
        .from("user_data")
        .upsert(payload as never, { onConflict: "user_id" });
      error = retry.error;
    }
    if (error && /account_txs/.test(error.message) && "account_txs" in payload) {
      delete payload.account_txs;
      const retry = await supabase
        .from("user_data")
        .upsert(payload as never, { onConflict: "user_id" });
      error = retry.error;
    }
    if (error && /production/.test(error.message) && "production" in payload) {
      delete payload.production;
      const retry = await supabase
        .from("user_data")
        .upsert(payload as never, { onConflict: "user_id" });
      error = retry.error;
    }
    if (error && /manual_ledger/.test(error.message) && "manual_ledger" in payload) {
      delete payload.manual_ledger;
      const retry = await supabase
        .from("user_data")
        .upsert(payload as never, { onConflict: "user_id" });
      error = retry.error;
    }
    if (error) throw error;
    // Success: clear only the field values we actually pushed, and only if
    // they haven't been re-written to a newer value while the upsert was in
    // flight. Any newer writes stay pending and will trigger another flush.
    const confirmed: string[] = [];
    for (const f of fieldNames) {
      if (pendingPush[f] === fieldsToPush[f]) {
        delete pendingPush[f];
        confirmed.push(f);
      }
    }
    clearDirty(confirmed);
    retryDelay = 5000;
    publishSyncState({
      pending: readDirtySet().size,
      failed: false,
      lastError: undefined,
      lastOkAt: Date.now(),
    });
  } catch (e) {
    console.error("[store] cloud push failed", { fields: fieldNames, error: e });
    // Failure: keep values in pendingPush and dirty markers persisted, then
    // retry with exponential backoff. The online listener also retries.
    for (const f of fieldNames) {
      if (!(f in pendingPush)) pendingPush[f] = fieldsToPush[f];
    }
    publishSyncState({
      pending: readDirtySet().size,
      failed: true,
      lastError: (e as { message?: string })?.message || String(e),
    });
    scheduleRetry();
  }
}

export async function hydrateFromCloud(userId: string) {
  cloudUserId = userId;
  cloudHydrated = false;
  // Restore any unsynced local changes from a previous session so they get
  // re-pushed and are never overwritten by cloud data below.
  const dirty = readDirtySet();
  for (const field of dirty) {
    const localKey = FIELD_TO_LOCAL_KEY[field];
    if (!localKey) continue;
    try {
      const raw = localStorage.getItem(scopedKey(localKey));
      if (raw != null) pendingPush[field] = JSON.parse(raw);
    } catch {}
  }
  try {
    const { data, error } = await supabase
      .from("user_data")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      // اولین دستگاه این کاربر: هر چیزی که به‌صورت محلی وجود دارد باید بالا برود.
      // به‌جای insert دستی (که قبلاً فقط ۵ فیلد را می‌فرستاد و مشتریان/هزینه‌ها/
      // خریدها/... را جا می‌انداخت) همه‌ی فیلدها را در صف push می‌گذاریم تا از
      // همان مسیر upsert معمولی — با همه‌ی fallbackهای ستون‌های قدیمی — ذخیره شوند.
      for (const [localKey, field] of Object.entries(CLOUD_FIELDS)) {
        try {
          const raw = localStorage.getItem(scopedKey(localKey));
          if (raw == null) continue;
          pendingPush[field] = JSON.parse(raw);
          markDirty([field]);
        } catch {
          /* مقدار خراب — نادیده */
        }
      }
      markCloudHydrated();
      return; // بلوک finally صف را flush می‌کند
    }
    // بازنویسی کش محلی از ابر. فیلدهای dirty (ویرایش آفلاین) حفظ می‌شوند مگر
    // اینکه کاتالوگ محلی خراب/فحاشی باشد یا خیلی فقیرتر از نسخهٔ ابری سالم.
    // نکته‌ی مهم: مجموعه‌ی dirty دوباره و همین‌الان خوانده می‌شود، چون ممکن است
    // کاربر در فاصله‌ی خواندن از سرور (چند صد میلی‌ثانیه) چیزی ثبت کرده باشد؛
    // با تکیه بر snapshot قدیمی، آن ثبت با داده‌ی سرور بازنویسی می‌شد و کاربر
    // «ناپدید شدن» آن را می‌دید.
    const dirtyNow = new Set<string>([...dirty, ...readDirtySet()]);
    const overwrite = (field: string, key: string, value: unknown) => {
      if (value == null) return;
      if (dirtyNow.has(field)) {
        if (
          isProtectedCatalogField(field) &&
          preferCloudValue(localValueForCloudField(field), value, field)
        ) {
          adoptCloudField(field, value);
        }
        return;
      }
      writeLocalOnly(key, value);
    };
    overwrite("products", PRODUCTS_KEY, data.products);
    overwrite("categories", CATEGORIES_KEY, data.categories);
    overwrite("invoices", HISTORY_KEY, data.invoices);
    overwrite("current_invoice", INVOICE_KEY, data.current_invoice);
    overwrite("settings", SETTINGS_KEY, data.settings);
    overwrite("customers", CUSTOMERS_KEY, (data as Record<string, unknown>).customers);
    overwrite("students", STUDENTS_KEY, (data as Record<string, unknown>).students);
    overwrite("purchases", PURCHASES_KEY, (data as Record<string, unknown>).purchases);
    overwrite("expenses", EXPENSES_KEY, (data as Record<string, unknown>).expenses);
    overwrite("reminders", REMINDERS_KEY, (data as Record<string, unknown>).reminders);
    overwrite("accounts", ACCOUNTS_KEY, (data as Record<string, unknown>).accounts);
    overwrite("account_txs", ACCOUNT_TXS_KEY, (data as Record<string, unknown>).account_txs);
    overwrite("production", PRODUCTION_KEY, (data as Record<string, unknown>).production);
    overwrite("manual_ledger", MANUAL_LEDGER_KEY, (data as Record<string, unknown>).manual_ledger);
    markCloudHydrated();
  } catch (e) {
    console.error("[store] hydrate failed", e);
    publishSyncState({
      pending: readDirtySet().size,
      failed: true,
      lastError: (e as { message?: string })?.message || String(e),
    });
    // Read failed: stay locked so local state can never overwrite cloud data.
    // Pending edits keep their dirty markers and retry after a successful read.
    setTimeout(() => {
      if (cloudUserId === userId && !cloudHydrated) void hydrateFromCloud(userId);
    }, 15000);
  } finally {
    // Flush any restored offline edits back to the cloud.
    if (cloudHydrated && Object.keys(pendingPush).length > 0) {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(flushCloudPush, 600);
    }
  }
}

export function stopCloudSync() {
  cloudUserId = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  for (const k of Object.keys(pendingPush)) delete pendingPush[k];
  // Do NOT clear the persisted dirty set here — it must survive sign-out /
  // reload so a subsequent sign-in can still resync offline edits.
}

// Re-flush pending changes when the browser regains connectivity
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (!cloudUserId) return;
    retryDelay = 5000;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (Object.keys(pendingPush).length > 0) {
      flushCloudPush();
    }
  });

  // بستن تب / رفتن اپ به پس‌زمینه: منتظر تایمر ۶۰۰ میلی‌ثانیه‌ای نمی‌مانیم و
  // همان لحظه تلاش می‌کنیم ذخیره کنیم. (اگر نرسد، نشانه‌ی dirty باقی می‌ماند و
  // اجرای بعدی برنامه دوباره می‌فرستد — پس در بدترین حالت هم چیزی گم نمی‌شود.)
  const flushNow = () => {
    if (!cloudUserId || Object.keys(pendingPush).length === 0) return;
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    void flushCloudPush();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
  window.addEventListener("pagehide", flushNow);
}

// ─── React hook ──────────────────────────────────────────────────────────────

export function useStore<T>(key: string, fallback: T): [T, (v: T | ((p: T) => T)) => void] {
  const [state, setState] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    const onChange = (e: Event) => {
      const currentKey = scopedKey(key);
      if (e instanceof StorageEvent) {
        if (e.key === STORAGE_SCOPE_KEY || e.key === currentKey || e.key === null) {
          setState(read(key, fallback));
        }
        return;
      }
      const detail = (
        e as CustomEvent<{
          key?: string;
          baseKey?: string;
          scopeChanged?: boolean;
          value?: unknown;
        }>
      ).detail;
      if (detail?.scopeChanged) {
        setState(read(key, fallback));
        return;
      }
      if (detail?.key === currentKey || detail?.baseKey === key) {
        // اگر مقدار تازه همراه رویداد آمده، مستقیم استفاده کن (بدون JSON.parse دوباره).
        // برای کامپوننتی که خودش نوشته، همان مرجع قبلی است و React رندر اضافه نمی‌کند.
        if (detail && "value" in detail) setState(detail.value as T);
        else setState(read(key, fallback));
      }
    };
    window.addEventListener("store-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("store-change", onChange);
      window.removeEventListener("storage", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (v: T | ((p: T) => T)) => {
    setState((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      write(key, next);
      return next;
    });
  };
  return [state, set];
}

// ─── Products ────────────────────────────────────────────────────────────────

export const products = {
  useAll: () => useStore<Product[]>(PRODUCTS_KEY, []),
  getAll: () => read<Product[]>(PRODUCTS_KEY, []),
  save: (list: Product[]) => write(PRODUCTS_KEY, list),
  findByCode: (code: string) => read<Product[]>(PRODUCTS_KEY, []).find((p) => p.code === code),
  findById: (id: string) => read<Product[]>(PRODUCTS_KEY, []).find((p) => p.id === id),
  update: (updated: Product) => {
    const list = read<Product[]>(PRODUCTS_KEY, []);
    write(
      PRODUCTS_KEY,
      list.map((p) => (p.id === updated.id ? updated : p)),
    );
  },
  decreaseStock: (productId: string, qty: number) => {
    const list = read<Product[]>(PRODUCTS_KEY, []);
    write(
      PRODUCTS_KEY,
      list.map((p) => (p.id === productId ? { ...p, stock: Math.max(0, p.stock - qty) } : p)),
    );
  },
};

// ─── Categories ──────────────────────────────────────────────────────────────

export const categories = {
  useAll: () => useStore<Category[]>(CATEGORIES_KEY, DEFAULT_CATEGORIES),
  getAll: () => {
    const stored = read<Category[] | null>(CATEGORIES_KEY, null);
    return stored ?? DEFAULT_CATEGORIES;
  },
  save: (list: Category[]) => write(CATEGORIES_KEY, list),
};

// ─── Invoice (multi-tab) ─────────────────────────────────────────────────────
// INVOICE_KEY now stores `{ open: Invoice[], activeId: string }`.
// Legacy data shape (single Invoice) is migrated on read.

type InvoiceBoard = { open: Invoice[]; activeId: string };

function normalizeBoard(raw: unknown): InvoiceBoard {
  if (raw && typeof raw === "object" && Array.isArray((raw as any).open)) {
    const b = raw as InvoiceBoard;
    if (b.open.length === 0) {
      const fresh = emptyInvoice();
      return { open: [fresh], activeId: fresh.id };
    }
    const activeId = b.open.some((i) => i.id === b.activeId) ? b.activeId : b.open[0].id;
    return { open: b.open, activeId };
  }
  // Legacy single invoice -> wrap
  if (raw && typeof raw === "object" && Array.isArray((raw as any).items)) {
    const inv = raw as Invoice;
    return { open: [inv], activeId: inv.id };
  }
  const fresh = emptyInvoice();
  return { open: [fresh], activeId: fresh.id };
}

function readBoard(): InvoiceBoard {
  const raw = read<unknown>(INVOICE_KEY, null as unknown);
  return normalizeBoard(raw);
}

function writeBoard(b: InvoiceBoard) {
  write(INVOICE_KEY, b);
}

function useBoard(): [
  InvoiceBoard,
  (v: InvoiceBoard | ((p: InvoiceBoard) => InvoiceBoard)) => void,
] {
  const [raw, setRaw] = useStore<unknown>(INVOICE_KEY, null);
  const board = normalizeBoard(raw);
  const set = (v: InvoiceBoard | ((p: InvoiceBoard) => InvoiceBoard)) => {
    setRaw((prev: unknown) => {
      const prevBoard = normalizeBoard(prev);
      return typeof v === "function" ? (v as (p: InvoiceBoard) => InvoiceBoard)(prevBoard) : v;
    });
  };
  return [board, set];
}

/**
 * وقتی یک فاکتور فروشِ ثبت‌شده در «تاریخچه» ویرایش می‌شود (مثلاً تعداد یک قلم از
 * ۴ به ۳ تغییر می‌کند، یا قلمی حذف/اضافه می‌شود)، موجودی انبار باید با این تغییر
 * هماهنگ شود؛ چون موجودی هنگام ثبت اولیه‌ی فاکتور یک‌بار کسر شده بود. اینجا فقط
 * اختلاف تعداد (جدید − قدیم) برای هر کالا محاسبه و از انبار کم/به انبار اضافه
 * می‌شود — نه کل مقدار از نو.
 */
function reconcileStockForInvoiceEdit(oldItems: InvoiceItem[], newItems: InvoiceItem[]) {
  const catalog = read<Product[]>(PRODUCTS_KEY, []);
  const oldDeltas = stockDeltasForSoldItems(oldItems, catalog);
  const newDeltas = stockDeltasForSoldItems(newItems, catalog);
  const ids = new Set([...oldDeltas.keys(), ...newDeltas.keys()]);
  if (ids.size === 0) return;
  let changed = false;
  const next = catalog.map((p) => {
    const delta = (newDeltas.get(p.id) || 0) - (oldDeltas.get(p.id) || 0);
    if (!delta) return p;
    changed = true;
    // delta مثبت یعنی فروش بیشتر شده → از انبار کم می‌شود
    return { ...p, stock: Math.max(0, (p.stock || 0) - delta) };
  });
  if (changed) products.save(next);
}

/**
 * ویرایش فاکتور خرید: موجودی انبار باید با اختلاف تعداد (جدید − قدیم) زیاد/کم شود
 * چون هنگام ثبت اولیه، موجودی اضافه شده بود.
 */
function reconcileStockForPurchaseEdit(oldItems: PurchaseItem[], newItems: PurchaseItem[]) {
  const deltaByProduct = new Map<string, number>();
  for (const it of oldItems) {
    if (!it.productId) continue;
    deltaByProduct.set(it.productId, (deltaByProduct.get(it.productId) || 0) - it.quantity);
  }
  for (const it of newItems) {
    if (!it.productId) continue;
    deltaByProduct.set(it.productId, (deltaByProduct.get(it.productId) || 0) + it.quantity);
  }
  if (deltaByProduct.size === 0) return;
  const list = read<Product[]>(PRODUCTS_KEY, []);
  let changed = false;
  const next = list.map((p) => {
    const delta = deltaByProduct.get(p.id);
    if (!delta) return p;
    changed = true;
    return { ...p, stock: Math.max(0, (p.stock || 0) + delta) };
  });
  if (changed) products.save(next);
}

export const invoice = {
  // Active (current) invoice — keeps legacy API surface
  useCurrent: (): [Invoice, (v: Invoice | ((p: Invoice) => Invoice)) => void] => {
    const [board, setBoard] = useBoard();
    const active = board.open.find((i) => i.id === board.activeId) ?? board.open[0];
    const set = (v: Invoice | ((p: Invoice) => Invoice)) => {
      setBoard((prev) => {
        const next =
          typeof v === "function"
            ? (v as (p: Invoice) => Invoice)(
                prev.open.find((i) => i.id === prev.activeId) ?? prev.open[0],
              )
            : v;
        return {
          activeId: next.id,
          open: prev.open.some((i) => i.id === next.id)
            ? prev.open.map((i) => (i.id === next.id ? next : i))
            : [...prev.open, next],
        };
      });
    };
    return [active, set];
  },
  getCurrent: (): Invoice => {
    const b = readBoard();
    return b.open.find((i) => i.id === b.activeId) ?? b.open[0];
  },
  save: (inv: Invoice) => {
    const b = readBoard();
    const open = b.open.some((i) => i.id === inv.id)
      ? b.open.map((i) => (i.id === inv.id ? inv : i))
      : [...b.open, inv];
    writeBoard({ open, activeId: inv.id });
  },

  // Tabs API
  useTabs: (): [
    InvoiceBoard,
    {
      openNew: () => void;
      switchTo: (id: string) => void;
      close: (id: string) => void;
    },
  ] => {
    const [board, setBoard] = useBoard();
    return [
      board,
      {
        openNew: () =>
          setBoard((prev) => {
            const fresh = emptyInvoice();
            return { open: [...prev.open, fresh], activeId: fresh.id };
          }),
        switchTo: (id: string) =>
          setBoard((prev) =>
            prev.open.some((i) => i.id === id) ? { ...prev, activeId: id } : prev,
          ),
        close: (id: string) =>
          setBoard((prev) => {
            const filtered = prev.open.filter((i) => i.id !== id);
            if (filtered.length === 0) {
              const fresh = emptyInvoice();
              return { open: [fresh], activeId: fresh.id };
            }
            const activeId = prev.activeId === id ? filtered[0].id : prev.activeId;
            return { open: filtered, activeId };
          }),
      },
    ];
  },

  useHistory: () => useStore<Invoice[]>(HISTORY_KEY, []),
  getHistory: () => read<Invoice[]>(HISTORY_KEY, []),
  archive: (inv: Invoice): Invoice => {
    const hist = read<Invoice[]>(HISTORY_KEY, []);
    // تاریخ/ساعت فاکتور را در لحظه‌ی ثبت نهایی می‌زنیم، نه در لحظه‌ی باز شدن تب
    // هم روی آبجکت اصلی می‌نویسیم تا فراخوان‌های بعدی (مثل ثبت بدهی مشتری) هم
    // همین تاریخ را ببینند و بین «تاریخچه» و «دفتر بدهی مشتری» اختلاف نیفتد.
    const finalizedAt = Date.now();
    inv.createdAt = finalizedAt;
    // بازمحاسبه‌ی نهایی: مبلغ ثبت‌شده در تاریخچه همیشه با اقلام و تخفیف همان
    // لحظه می‌خواند، حتی اگر فراخوان یادش رفته باشد recalc را صدا بزند.
    const stamped: Invoice = recalc({
      ...inv,
      createdAt: finalizedAt,
      documentTitle: undefined,
    });
    // لاگ تولید باید قبل از کسر موجودی باشد تا «موجودی ازپیش‌تولیدشده» درست تشخیص داده شود.
    logProductionSales(stamped);
    // کسر موجودی در یک نوشتن اتمی — تا تعداد در «محصولات» و «انبار» یکی بماند
    // و اگر یک کالا چند ردیف داشته باشد، موجودی دوبار از روی دادهٔ کهنه کم نشود.
    if (inventoryTrackingEnabled()) {
      reconcileStockForInvoiceEdit([], stamped.items);
    }
    write(HISTORY_KEY, [stamped, ...hist]);
    // Remove archived invoice from the open board (and ensure at least one tab remains)
    const b = readBoard();
    const filtered = b.open.filter((i) => i.id !== stamped.id);
    if (filtered.length === 0) {
      const fresh = emptyInvoice();
      writeBoard({ open: [fresh], activeId: fresh.id });
    } else {
      writeBoard({ open: filtered, activeId: filtered[0].id });
    }
    return stamped;
  },
  updateHistory: (updated: Invoice) => {
    const hist = read<Invoice[]>(HISTORY_KEY, []);
    const prev = hist.find((inv) => inv.id === updated.id);
    if (prev && inventoryTrackingEnabled()) reconcileStockForInvoiceEdit(prev.items, updated.items);
    // مثل archive: مبالغ همیشه از روی اقلام و تخفیفِ ویرایش‌شده بازمحاسبه می‌شوند
    const fixed = recalc(updated);
    write(
      HISTORY_KEY,
      hist.map((inv) => (inv.id === updated.id ? fixed : inv)),
    );
  },
  /**
   * حذف فاکتور از تاریخچه. اگر opts.restock=true باشد، کالاهای همان فاکتور به
   * انبار برمی‌گردند (چون هنگام ثبت فاکتور از موجودی کسر شده بودند). این کار
   * اختیاری است تا کاربر بتواند بین «فاکتور اشتباه بوده» و «کالا واقعاً رفته»
   * تفاوت بگذارد.
   */
  deleteFromHistory: (id: string, opts?: { restock?: boolean }) => {
    const hist = read<Invoice[]>(HISTORY_KEY, []);
    const target = hist.find((inv) => inv.id === id);
    if (opts?.restock && target && inventoryTrackingEnabled()) {
      reconcileStockForInvoiceEdit(target.items, []);
    }
    write(
      HISTORY_KEY,
      hist.filter((inv) => inv.id !== id),
    );
  },
};

// ─── Purchase invoices ───────────────────────────────────────────────────────

export const purchases = {
  useAll: () => useStore<Purchase[]>(PURCHASES_KEY, []),
  getAll: () => read<Purchase[]>(PURCHASES_KEY, []),
  save: (list: Purchase[]) => write(PURCHASES_KEY, list),
  /**
   * ثبت نهایی فاکتور خرید:
   *  - برای کالاهای موجود: موجودی را اضافه و قیمت خرید را به‌روزرسانی می‌کند.
   *  - برای اقلامی که productId ندارند (کالای جدید تایپ‌شده): یک کالای جدید در انبار می‌سازد.
   * سپس فاکتور را در تاریخچه‌ی خرید ذخیره می‌کند.
   * اگر opts.keepCreatedAt=true باشد، تاریخ ورودی p.createdAt حفظ می‌شود (برای ثبت با تاریخ دلخواه)؛
   * در غیر این صورت (پیش‌فرض قبلی) تاریخ لحظه‌ی ثبت است.
   */
  archive: (p: Purchase, opts?: { keepCreatedAt?: boolean }) => {
    const stamped: Purchase = { ...p, createdAt: opts?.keepCreatedAt ? p.createdAt : Date.now() };

    const list = read<Product[]>(PRODUCTS_KEY, []);
    const cats = read<Category[]>(CATEGORIES_KEY, DEFAULT_CATEGORIES);
    const nextProducts = [...list];
    const resolvedItems: PurchaseItem[] = [];

    for (const item of stamped.items) {
      const idx = item.productId ? nextProducts.findIndex((pr) => pr.id === item.productId) : -1;
      if (idx >= 0) {
        const prev = nextProducts[idx];
        nextProducts[idx] = {
          ...prev,
          stock: (prev.stock || 0) + item.quantity,
          buyPrice: item.buyPrice,
        };
        resolvedItems.push({ ...item, productId: prev.id, name: prev.name });
      } else {
        // کالای جدید — در انبار ساخته می‌شود تا از این پس در فروش هم قابل انتخاب باشد
        const category = item.category || cats[0]?.name || "";
        const newProduct: Product = {
          id: cryptoId(),
          name: item.name.trim() || "کالای بدون نام",
          price:
            item.sellPrice && item.sellPrice > 0 ? item.sellPrice : Math.round(item.buyPrice * 1.3),
          category,
          code: "",
          stock: item.quantity,
          buyPrice: item.buyPrice,
          unit: item.unit || COUNT_UNIT,
        };
        nextProducts.push(newProduct);
        resolvedItems.push({ ...item, productId: newProduct.id, name: newProduct.name });
      }
    }

    products.save(nextProducts);
    const hist = read<Purchase[]>(PURCHASES_KEY, []);
    write(PURCHASES_KEY, [{ ...stamped, items: resolvedItems }, ...hist]);
  },
  useHistory: () => useStore<Purchase[]>(PURCHASES_KEY, []),
  getHistory: () => read<Purchase[]>(PURCHASES_KEY, []),
  /**
   * ویرایش فاکتور خرید از تاریخچه. اختلاف تعداد اقلام روی موجودی انبار اعمال
   * می‌شود تا «محصولات» و «انبار» با فاکتور ویرایش‌شده هم‌خوان بمانند.
   */
  updateHistory: (updated: Purchase) => {
    const hist = read<Purchase[]>(PURCHASES_KEY, []);
    const prev = hist.find((p) => p.id === updated.id);
    if (prev) reconcileStockForPurchaseEdit(prev.items, updated.items);
    write(
      PURCHASES_KEY,
      hist.map((p) => (p.id === updated.id ? updated : p)),
    );
  },
  deleteFromHistory: (id: string) => {
    const hist = read<Purchase[]>(PURCHASES_KEY, []);
    write(
      PURCHASES_KEY,
      hist.filter((p) => p.id !== id),
    );
  },
};

// ─── Expenses (هزینه‌ها) ─────────────────────────────────────────────────────

export type Expense = {
  id: string;
  /** عنوان هزینه، مثلاً «اجاره مغازه» */
  title: string;
  amount: number;
  /** دسته‌بندی هزینه — از EXPENSE_CATEGORIES یا هر متن دلخواه */
  category: string;
  /** تاریخ ثبت/پرداخت هزینه (timestamp) */
  at: number;
  paymentMethod?: PaymentMethod;
  note?: string;
  /** هزینه‌ی تکرارشونده (مثل اجاره ماهانه) — تعداد روز دوره؛ خالی یعنی یک‌بار */
  recurringDays?: number;
  /**
   * حساب/کارتی که این هزینه از آن پرداخت شده است. اگر پر باشد، مبلغ هزینه
   * به‌صورت یک «برداشت» از موجودی همان حساب کم می‌شود و با ویرایش/حذف هزینه،
   * آن برداشت هم به‌روزرسانی یا حذف می‌شود.
   */
  accountId?: string;
  createdAt: number;
};

/**
 * دسته‌بندی هزینه کاملاً دست خود کاربر است؛ هیچ دسته‌ی از پیش تعیین‌شده‌ای وجود
 * ندارد. این آرایه فقط برای سازگاری با کدهای قدیمی خالی نگه داشته شده است.
 */
export const EXPENSE_CATEGORIES: readonly string[] = [];

/**
 * فهرست کامل دسته‌های هزینه: پیش‌فرض‌ها + دسته‌های سفارشی کاربر (در تنظیمات
 * ذخیره می‌شوند، پس مثل بقیه‌ی تنظیمات بین دستگاه‌ها همگام می‌شوند) + هر دسته‌ای
 * که در هزینه‌های موجود استفاده شده (تا داده‌ی قدیمی هیچ‌وقت بی‌دسته نشود).
 */
export function expenseCategoryList(list?: Expense[]): string[] {
  const custom = settings.get().expenseCategories ?? [];
  const used = (list ?? read<Expense[]>(EXPENSES_KEY, []))
    .map((e) => (e.category || "").trim())
    .filter(Boolean);
  return [...new Set([...custom, ...used])];
}

/** افزودن یک دسته‌ی هزینه‌ی سفارشی (تکراری/خالی نادیده گرفته می‌شود) */
export function addExpenseCategory(name: string): string[] {
  const clean = name.trim();
  if (!clean) return expenseCategoryList();
  const s = settings.get();
  const custom = s.expenseCategories ?? [];
  if (!custom.includes(clean)) {
    settings.save({ ...s, expenseCategories: [...custom, clean] });
  }
  return expenseCategoryList();
}

/**
 * حذف یک دسته‌ی سفارشی از فهرست. هزینه‌های ثبت‌شده با آن دسته دست نمی‌خورند
 * (دسته‌شان همان می‌ماند و در فهرست هم — چون استفاده شده — دیده می‌شود).
 * دسته‌های پیش‌فرض قابل حذف نیستند.
 */
export function removeExpenseCategory(name: string): string[] {
  const s = settings.get();
  const custom = s.expenseCategories ?? [];
  if (custom.includes(name)) {
    settings.save({ ...s, expenseCategories: custom.filter((c) => c !== name) });
  }
  return expenseCategoryList();
}

export function emptyExpense(): Expense {
  return {
    id: cryptoId(),
    title: "",
    amount: 0,
    category: "",
    at: Date.now(),
    paymentMethod: "cash",
    createdAt: Date.now(),
  };
}

/** سررسید بعدی یک هزینه‌ی تکرارشونده (اگر تکرارشونده نباشد null) */
export function expenseNextDue(e: Expense): number | null {
  if (!e.recurringDays || e.recurringDays <= 0) return null;
  const period = e.recurringDays * 86_400_000;
  let next = e.at + period;
  const now = Date.now();
  while (next < now - period) next += period;
  return next;
}

export function expensesInRange(list: Expense[], from: number, to: number): Expense[] {
  return list.filter((e) => e.at >= from && e.at <= to);
}

export function expensesTotal(list: Expense[]): number {
  return list.reduce((s, e) => s + (e.amount || 0), 0);
}

/** جمع هزینه‌ها به تفکیک دسته، مرتب‌شده از بیشترین به کمترین */
export function expensesByCategory(list: Expense[]): { category: string; total: number }[] {
  const map = new Map<string, number>();
  for (const e of list)
    map.set(e.category || "متفرقه", (map.get(e.category || "متفرقه") || 0) + (e.amount || 0));
  return [...map.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

export const expenses = {
  useAll: () => useStore<Expense[]>(EXPENSES_KEY, []),
  getAll: () => read<Expense[]>(EXPENSES_KEY, []),
  save: (list: Expense[]) => write(EXPENSES_KEY, list),
  add: (e: Expense) => {
    const list = read<Expense[]>(EXPENSES_KEY, []);
    const created = { ...e, id: e.id || cryptoId(), createdAt: e.createdAt || Date.now() };
    write(EXPENSES_KEY, [created, ...list]);
    syncExpenseAccountTx(created);
  },
  update: (updated: Expense) => {
    const list = read<Expense[]>(EXPENSES_KEY, []);
    write(
      EXPENSES_KEY,
      list.map((e) => (e.id === updated.id ? updated : e)),
    );
    syncExpenseAccountTx(updated);
  },
  remove: (id: string) => {
    const list = read<Expense[]>(EXPENSES_KEY, []);
    write(
      EXPENSES_KEY,
      list.filter((e) => e.id !== id),
    );
    removeExpenseAccountTx(id);
  },
};

/**
 * هزینه‌ای که از یک حساب/کارت پرداخت شده، باید از موجودی همان حساب کم شود.
 * برای هر هزینه حداکثر یک تراکنشِ «برداشت» با شناسه‌ی expenseId نگه داشته
 * می‌شود؛ با ویرایش هزینه همان تراکنش به‌روز و با تغییر حساب یا حذف هزینه،
 * تراکنش قبلی حذف می‌شود تا موجودی هیچ‌وقت دوبار کم/زیاد نشود.
 */
function syncExpenseAccountTx(e: Expense) {
  const txs = read<AccountTx[]>(ACCOUNT_TXS_KEY, []).filter((t) => t.expenseId !== e.id);
  if (e.accountId && e.amount > 0) {
    txs.unshift({
      id: cryptoId(),
      accountId: e.accountId,
      type: "withdraw",
      amount: e.amount,
      note: `هزینه: ${e.title || e.category || "بدون عنوان"}`,
      at: e.at,
      expenseId: e.id,
      createdAt: Date.now(),
    });
  }
  write(ACCOUNT_TXS_KEY, txs);
}

function removeExpenseAccountTx(expenseId: string) {
  const txs = read<AccountTx[]>(ACCOUNT_TXS_KEY, []);
  const next = txs.filter((t) => t.expenseId !== expenseId);
  if (next.length !== txs.length) write(ACCOUNT_TXS_KEY, next);
}

// ─── Manual ledger (فروش/سود/یادداشت روزانه بدون فاکتور) ─────────────────────

export type ManualLedgerKind = "sales" | "profit" | "note";

export const MANUAL_LEDGER_LABEL: Record<ManualLedgerKind, string> = {
  sales: "فروش دستی",
  profit: "سود دستی",
  note: "یادداشت",
};

/**
 * ثبت دستی فروش، سود یا یادداشت روز — برای روزهایی که فاکتور صادر نمی‌شود
 * یا کاربر می‌خواهد مبلغ جداگانه‌ای کنار فاکتورها در گزارش ماهانه ببیند.
 */
export type ManualLedgerEntry = {
  id: string;
  kind: ManualLedgerKind;
  /** مبلغ به تومان؛ برای یادداشت متنی می‌تواند صفر باشد */
  amount: number;
  /** عنوان کوتاه، مثلاً «فروش بازار» یا «سود نقدی» */
  title: string;
  note?: string;
  /** زمان این ثبت (معمولاً همان روز شمسی انتخاب‌شده) */
  at: number;
  source?: "manual" | "assistant";
  createdAt: number;
};

export function emptyManualLedger(kind: ManualLedgerKind = "sales"): ManualLedgerEntry {
  return {
    id: cryptoId(),
    kind,
    amount: 0,
    title: "",
    at: Date.now(),
    source: "manual",
    createdAt: Date.now(),
  };
}

export function manualLedgerInRange(
  list: ManualLedgerEntry[],
  from: number,
  to: number,
): ManualLedgerEntry[] {
  return list.filter((e) => e.at >= from && e.at <= to);
}

export function manualLedgerTotals(list: ManualLedgerEntry[]): {
  sales: number;
  profit: number;
  notes: number;
  count: number;
} {
  let sales = 0;
  let profit = 0;
  let notes = 0;
  for (const e of list) {
    const n = e.amount || 0;
    if (e.kind === "sales") sales += n;
    else if (e.kind === "profit") profit += n;
    else notes += n;
  }
  return { sales, profit, notes, count: list.length };
}

export const manualLedger = {
  useAll: () => useStore<ManualLedgerEntry[]>(MANUAL_LEDGER_KEY, []),
  getAll: () => read<ManualLedgerEntry[]>(MANUAL_LEDGER_KEY, []),
  save: (list: ManualLedgerEntry[]) => write(MANUAL_LEDGER_KEY, list),
  add: (e: ManualLedgerEntry) => {
    const list = read<ManualLedgerEntry[]>(MANUAL_LEDGER_KEY, []);
    const created: ManualLedgerEntry = {
      ...e,
      id: e.id || cryptoId(),
      createdAt: e.createdAt || Date.now(),
      title: (e.title || "").trim() || MANUAL_LEDGER_LABEL[e.kind],
      amount: Math.max(0, Math.round(e.amount || 0)),
    };
    write(MANUAL_LEDGER_KEY, [created, ...list]);
    return created;
  },
  update: (updated: ManualLedgerEntry) => {
    const list = read<ManualLedgerEntry[]>(MANUAL_LEDGER_KEY, []);
    write(
      MANUAL_LEDGER_KEY,
      list.map((e) =>
        e.id === updated.id ? { ...updated, title: (updated.title || "").trim() } : e,
      ),
    );
  },
  remove: (id: string) => {
    write(
      MANUAL_LEDGER_KEY,
      read<ManualLedgerEntry[]>(MANUAL_LEDGER_KEY, []).filter((e) => e.id !== id),
    );
  },
};

// ─── Reminders (یادآوری‌ها — پیگیری وظایف و مشتریان) ─────────────────────────

export type Reminder = {
  id: string;
  /** عنوان یادآوری، مثلاً «تماس با آقای رضایی» */
  title: string;
  note?: string;
  /** زمان سررسید یادآوری (timestamp) */
  dueAt: number;
  /** اتصال اختیاری به یک مشتری از لیست مشتریان */
  customerId?: string;
  /** نام مشتری در لحظه‌ی ثبت — حتی اگر بعداً مشتری حذف/ویرایش شود، عنوان یادآوری معتبر می‌ماند */
  customerName?: string;
  /** یادآوری تکرارشونده (مثل پیگیری هفتگی) — تعداد روز دوره؛ خالی یعنی یک‌بار */
  recurringDays?: number;
  done: boolean;
  doneAt?: number;
  createdAt: number;
};

export type ReminderStatus = "done" | "overdue" | "due-today" | "soon" | "upcoming";

/** وضعیت یک یادآوری بر اساس سررسید (نسبت به «امروز» به وقت تهران) */
export function reminderStatus(r: Reminder): ReminderStatus {
  if (r.done) return "done";
  const today = todayStartTs();
  const days = Math.floor((r.dueAt - today) / 86_400_000);
  if (days < 0) return "overdue";
  if (days === 0) return "due-today";
  if (days <= 3) return "soon";
  return "upcoming";
}

/** لیست یادآوری‌های فعال (انجام‌نشده)، مرتب‌شده بر اساس فوریت سررسید */
export function activeReminders(list: Reminder[]): Reminder[] {
  return list.filter((r) => !r.done).sort((a, b) => a.dueAt - b.dueAt);
}

/** تعداد یادآوری‌های امروز یا عقب‌افتاده — برای نشان (badge) در نوار پایین */
export function dueReminderCount(list: Reminder[]): number {
  return list.filter(
    (r) => !r.done && (reminderStatus(r) === "overdue" || reminderStatus(r) === "due-today"),
  ).length;
}

export const reminders = {
  useAll: () => useStore<Reminder[]>(REMINDERS_KEY, []),
  getAll: () => read<Reminder[]>(REMINDERS_KEY, []),
  save: (list: Reminder[]) => write(REMINDERS_KEY, list),

  add: (r: Omit<Reminder, "id" | "createdAt" | "done" | "doneAt">) => {
    const created: Reminder = { ...r, id: cryptoId(), createdAt: Date.now(), done: false };
    write(REMINDERS_KEY, [created, ...read<Reminder[]>(REMINDERS_KEY, [])]);
    return created;
  },

  update: (updated: Reminder) => {
    const list = read<Reminder[]>(REMINDERS_KEY, []);
    write(
      REMINDERS_KEY,
      list.map((r) => (r.id === updated.id ? updated : r)),
    );
  },

  remove: (id: string) => {
    const list = read<Reminder[]>(REMINDERS_KEY, []);
    write(
      REMINDERS_KEY,
      list.filter((r) => r.id !== id),
    );
  },

  /** انجام‌شده علامت بزن؛ اگر تکرارشونده باشد، یادآوری بعدی خودکار ساخته می‌شود */
  markDone: (id: string) => {
    const list = read<Reminder[]>(REMINDERS_KEY, []);
    const target = list.find((r) => r.id === id);
    if (!target) return;
    const next = list.map((r) => (r.id === id ? { ...r, done: true, doneAt: Date.now() } : r));
    if (target.recurringDays && target.recurringDays > 0) {
      const period = target.recurringDays * 86_400_000;
      let nextDue = target.dueAt + period;
      const now = Date.now();
      while (nextDue < now) nextDue += period;
      next.unshift({
        ...target,
        id: cryptoId(),
        dueAt: nextDue,
        done: false,
        doneAt: undefined,
        createdAt: Date.now(),
      });
    }
    write(REMINDERS_KEY, next);
  },

  /** برگرداندن یک یادآوری انجام‌شده به حالت فعال */
  markUndone: (id: string) => {
    const list = read<Reminder[]>(REMINDERS_KEY, []);
    write(
      REMINDERS_KEY,
      list.map((r) => (r.id === id ? { ...r, done: false, doneAt: undefined } : r)),
    );
  },
};

// ─── Accounts (حساب‌ها و کارت‌ها — صندوق، بانک، واریز/برداشت) ────────────────

export type Account = {
  id: string;
  /** نام حساب/کارت، مثلاً «کارت ملی بانک» یا «صندوق فروشگاه» */
  name: string;
  /** شماره کارت (اختیاری) — ۱۶ رقم */
  cardNumber?: string;
  /** شماره شبا (اختیاری) — IR + ۲۴ رقم */
  iban?: string;
  /** نام صاحب حساب — روی کارت نمایش داده می‌شود و برای ارسال به مشتری استفاده می‌شود */
  holderName?: string;
  /** نام بانک — اگر خالی باشد از روی شماره کارت تشخیص داده می‌شود */
  bankName?: string;
  /**
   * رنگ کارت انتخاب‌شده توسط کاربر.
   * شناسه پالت (mint, sky, …) یا کد هگز مثل `#22D3EE`.
   */
  cardColor?: string;
  /** موجودی اولیه هنگام تعریف حساب */
  openingBalance: number;
  createdAt: number;
};

export type AccountTx = {
  id: string;
  accountId: string;
  type: "deposit" | "withdraw";
  amount: number;
  note?: string;
  at: number;
  /** اگر این تراکنش خودکار از یک هزینه ساخته شده باشد، شناسه‌ی آن هزینه */
  expenseId?: string;
  createdAt: number;
};

/** موجودی فعلی یک حساب = موجودی اولیه + واریزها − برداشت‌ها */
export function accountBalance(account: Account, txs: AccountTx[]): number {
  return txs
    .filter((t) => t.accountId === account.id)
    .reduce(
      (sum, t) => sum + (t.type === "deposit" ? t.amount : -t.amount),
      account.openingBalance,
    );
}

/** نمایش پوشیده‌ی شماره کارت، مثلاً «•••• •••• •••• ۱۲۳۴» */
export function maskCardNumber(cardNumber: string): string {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 4) return cardNumber;
  const last4 = digits.slice(-4);
  return `•••• •••• •••• ${formatNumber(last4)}`;
}

export const accounts = {
  useAll: () => useStore<Account[]>(ACCOUNTS_KEY, []),
  getAll: () => read<Account[]>(ACCOUNTS_KEY, []),

  add: (a: Omit<Account, "id" | "createdAt">): Account => {
    const created: Account = { ...a, id: cryptoId(), createdAt: Date.now() };
    write(ACCOUNTS_KEY, [created, ...read<Account[]>(ACCOUNTS_KEY, [])]);
    return created;
  },

  update: (updated: Account) => {
    const list = read<Account[]>(ACCOUNTS_KEY, []);
    write(
      ACCOUNTS_KEY,
      list.map((a) => (a.id === updated.id ? updated : a)),
    );
  },

  /** حذف حساب همراه با تمام تراکنش‌های مربوط به آن */
  remove: (id: string) => {
    write(
      ACCOUNTS_KEY,
      read<Account[]>(ACCOUNTS_KEY, []).filter((a) => a.id !== id),
    );
    write(
      ACCOUNT_TXS_KEY,
      read<AccountTx[]>(ACCOUNT_TXS_KEY, []).filter((t) => t.accountId !== id),
    );
  },
};

export const accountTxs = {
  useAll: () => useStore<AccountTx[]>(ACCOUNT_TXS_KEY, []),
  getAll: () => read<AccountTx[]>(ACCOUNT_TXS_KEY, []),

  add: (t: Omit<AccountTx, "id" | "createdAt">): AccountTx => {
    const created: AccountTx = { ...t, id: cryptoId(), createdAt: Date.now() };
    write(ACCOUNT_TXS_KEY, [created, ...read<AccountTx[]>(ACCOUNT_TXS_KEY, [])]);
    return created;
  },

  update: (updated: AccountTx) => {
    const list = read<AccountTx[]>(ACCOUNT_TXS_KEY, []);
    write(
      ACCOUNT_TXS_KEY,
      list.map((t) => (t.id === updated.id ? updated : t)),
    );
  },

  remove: (id: string) => {
    write(
      ACCOUNT_TXS_KEY,
      read<AccountTx[]>(ACCOUNT_TXS_KEY, []).filter((t) => t.id !== id),
    );
  },
};

function logProductionSales(inv: Invoice) {
  const catalog = read<Product[]>(PRODUCTS_KEY, []);
  const used = ingredientsUsedOnSale(inv.items, catalog);
  if (used.length === 0) return;
  const events: ProductionEvent[] = used.map((u) => ({
    id: cryptoId(),
    createdAt: inv.createdAt || Date.now(),
    kind: "sale",
    outputProductId: u.product.id,
    outputName: u.product.name,
    outputQty: u.qty,
    outputUnit: u.product.unit,
    invoiceId: inv.id,
    ingredients: u.ingredients,
  }));
  write(PRODUCTION_KEY, [...events, ...read<ProductionEvent[]>(PRODUCTION_KEY, [])]);
}

export const production = {
  useAll: () => useStore<ProductionEvent[]>(PRODUCTION_KEY, []),
  getAll: () => read<ProductionEvent[]>(PRODUCTION_KEY, []),
  save: (list: ProductionEvent[]) => write(PRODUCTION_KEY, list),

  /**
   * تولید دسته‌ای: مواد فرمول از انبار کم و موجودی محصول نهایی زیاد می‌شود.
   */
  produce: (productId: string, qty: number, note?: string): ProductionEvent | null => {
    if (qty <= 0) return null;
    const catalog = read<Product[]>(PRODUCTS_KEY, []);
    const product = catalog.find((p) => p.id === productId);
    if (!product) return null;
    const ingredients = expandRecipeForQty(product, qty, catalog);
    if (ingredients.length === 0) return null;
    const next = catalog.map((p) => {
      if (p.id === productId) return { ...p, stock: (p.stock || 0) + qty };
      const used = ingredients.find((u) => u.productId === p.id);
      if (!used) return p;
      return { ...p, stock: Math.max(0, (p.stock || 0) - used.quantity) };
    });
    products.save(next);
    const event: ProductionEvent = {
      id: cryptoId(),
      createdAt: Date.now(),
      kind: "produce",
      outputProductId: productId,
      outputName: product.name,
      outputQty: qty,
      outputUnit: product.unit,
      ingredients,
      note,
    };
    write(PRODUCTION_KEY, [event, ...read<ProductionEvent[]>(PRODUCTION_KEY, [])]);
    return event;
  },

  remove: (id: string) => {
    write(
      PRODUCTION_KEY,
      read<ProductionEvent[]>(PRODUCTION_KEY, []).filter((e) => e.id !== id),
    );
  },
};

// ─── Settings ────────────────────────────────────────────────────────────────

export const settings = {
  useAll: () => useStore<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS),
  get: () => read<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS),
  save: (s: AppSettings) => write(SETTINGS_KEY, s),
};

// ─── Customers (debtors/creditors) ───────────────────────────────────────────

export const customers = {
  useAll: () => useStore<Customer[]>(CUSTOMERS_KEY, []),
  getAll: () => read<Customer[]>(CUSTOMERS_KEY, []),
  save: (list: Customer[]) => write(CUSTOMERS_KEY, list),

  add: (c: Omit<Customer, "id" | "createdAt" | "txs">): Customer => {
    const created: Customer = { ...c, id: cryptoId(), createdAt: Date.now(), txs: [] };
    write(CUSTOMERS_KEY, [created, ...read<Customer[]>(CUSTOMERS_KEY, [])]);
    return created;
  },

  update: (updated: Customer) => {
    const list = read<Customer[]>(CUSTOMERS_KEY, []);
    write(
      CUSTOMERS_KEY,
      list.map((c) => (c.id === updated.id ? updated : c)),
    );
  },

  remove: (id: string) => {
    write(
      CUSTOMERS_KEY,
      read<Customer[]>(CUSTOMERS_KEY, []).filter((c) => c.id !== id),
    );
  },

  /**
   * حذف کامل فهرست مشتریان (به‌همراه سوابق بدهی/پرداخت که داخل خود مشتری ذخیره
   * می‌شوند). هیچ داده‌ی دیگری — فاکتورها، هزینه‌ها، محصولات — دست نمی‌خورد.
   * فقط از مسیر دیالوگ تاییدِ صفحه‌ی مشتریان صدا زده می‌شود.
   */
  removeAll: () => {
    write(CUSTOMERS_KEY, [] as Customer[]);
  },

  addTx: (customerId: string, tx: Omit<CustomerTx, "id" | "at"> & { at?: number }) => {
    const list = read<Customer[]>(CUSTOMERS_KEY, []);
    write(
      CUSTOMERS_KEY,
      list.map((c) => {
        if (c.id !== customerId) return c;
        const updated: Customer = {
          ...c,
          txs: [{ ...tx, id: cryptoId(), at: tx.at ?? Date.now() }, ...c.txs],
        };
        // با تسویه کامل بدهی، موعد تسویه دیگر معنا ندارد
        if (customerBalance(updated) <= 0) updated.settlementDate = undefined;
        return updated;
      }),
    );
  },

  /**
   * یافتن مشتری بر اساس تلفن یا نام کامل؛ اگر پیدا نشد، مشتری جدید ساخته می‌شود
   * (بدون ثبت هیچ تراکنش بدهی/پرداختی). برای این‌که هر فاکتوری — حتی نقدی —
   * که اطلاعات مشتری دارد، مشتری را در «مشتریان» ثبت/به‌روز کند.
   * اگر نه نام و نه تلفنی وجود نداشته باشد، null برمی‌گرداند.
   */
  findOrCreate: (info: CustomerInfo): Customer | null => {
    const name = [info.firstName, info.lastName].filter(Boolean).join(" ").trim();
    const phone = info.phone?.trim();
    if (!name && !phone) return null;
    const list = read<Customer[]>(CUSTOMERS_KEY, []);
    const found = list.find(
      (c) => (phone && c.phone === phone) || (name && customerFullName(c) === name),
    );
    if (found) {
      // اگر مشتری قبلاً بدون شماره تلفن ثبت شده و الان شماره داده شده، تکمیلش می‌کنیم
      if (phone && !found.phone) {
        const updated = { ...found, phone };
        write(
          CUSTOMERS_KEY,
          list.map((c) => (c.id === found.id ? updated : c)),
        );
        return updated;
      }
      return found;
    }
    const created: Customer = {
      id: cryptoId(),
      firstName: info.firstName?.trim() || name || "مشتری",
      lastName: info.lastName?.trim() || undefined,
      phone: phone || undefined,
      createdAt: Date.now(),
      txs: [],
    };
    write(CUSTOMERS_KEY, [created, ...list]);
    return created;
  },

  /**
   * ثبت خودکار بدهی برای فاکتور نسیه. مشتری موجود (بر اساس تلفن یا نام) پیدا
   * می‌شود و در غیر این صورت ساخته می‌شود.
   */
  recordInvoiceDebt: (
    info: CustomerInfo,
    inv: Invoice,
    opts?: { amount?: number; note?: string },
  ) => {
    const name = [info.firstName, info.lastName].filter(Boolean).join(" ").trim();
    if (!name && !info.phone?.trim()) return;
    const debtAmount = Math.max(0, Math.round(opts?.amount ?? inv.total));
    if (debtAmount <= 0) return;
    const list = read<Customer[]>(CUSTOMERS_KEY, []);
    let target = list.find(
      (c) =>
        (info.phone?.trim() && c.phone === info.phone.trim()) ||
        (name && customerFullName(c) === name),
    );
    if (!target) {
      target = {
        id: cryptoId(),
        firstName: info.firstName?.trim() || name || "مشتری",
        lastName: info.lastName?.trim() || undefined,
        phone: info.phone?.trim() || undefined,
        createdAt: Date.now(),
        txs: [],
      };
      list.unshift(target);
    }
    const tx: CustomerTx = {
      id: cryptoId(),
      type: "debt",
      amount: debtAmount,
      note: opts?.note ?? "فاکتور نسیه",
      at: inv.createdAt || Date.now(),
      invoiceId: inv.id,
    };
    write(
      CUSTOMERS_KEY,
      list.map((c) => (c.id === target!.id ? { ...c, txs: [tx, ...c.txs] } : c)),
    );
  },
};

// ─── Students (کلاس‌ها، باشگاه، هنرجوها) ────────────────────────────────────

export type StudentPayment = {
  id: string;
  amount: number;
  at: number;
  /** تاریخ شروع دورهٔ پرداخت‌شده */
  periodStart: number;
  /** تاریخ سررسید بعدی پس از این پرداخت */
  nextDueAt: number;
  note?: string;
};

/** یک قسط از شهریهٔ اقساطی */
export type StudentInstallment = {
  id: string;
  /** مبلغ قسط (تومان) */
  amount: number;
  /** تاریخ سررسید قسط */
  dueAt: number;
  /** اگر پرداخت شده باشد، زمان پرداخت */
  paidAt?: number;
  /** مبلغ واقعاً پرداخت‌شده (ممکن است با amount فرق کند) */
  paidAmount?: number;
  note?: string;
};

export type Student = {
  id: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  /** رشته/کلاس (مثلاً کاراته، بدنسازی) — اختیاری */
  discipline?: string;
  /** مبلغ شهریه در هر دوره (تومان) */
  fee: number;
  /** طول دوره بر حسب روز (مثلاً ۳۰ = ماهانه) */
  periodDays: number;
  /** تاریخ ثبت‌نام */
  startDate: number;
  /** تاریخ سررسید پرداخت بعدی */
  nextDueAt: number;
  active: boolean;
  note?: string;
  createdAt: number;
  payments: StudentPayment[];
  /** حالت اقساطی: اگر true باشد سررسید از روی اقساط محاسبه می‌شود */
  installmentMode?: boolean;
  /** لیست اقساط (فقط وقتی installmentMode فعال است معنا دارد) */
  installments?: StudentInstallment[];
};

function todayStartTs(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(parts + "T00:00:00+03:30").getTime();
}

/** روزهای باقی‌مانده تا سررسید (منفی = گذشته) */
export function studentDaysToDue(s: Student): number {
  const today = todayStartTs();
  return Math.round((studentDueAt(s) - today) / 86_400_000);
}

/** لیست اقساط (همیشه آرایه) */
export function studentInstallments(s: Student): StudentInstallment[] {
  return s.installmentMode ? (s.installments ?? []) : [];
}

/** نزدیک‌ترین قسط پرداخت‌نشده */
export function nextUnpaidInstallment(s: Student): StudentInstallment | null {
  const open = studentInstallments(s)
    .filter((i) => !i.paidAt)
    .sort((a, b) => a.dueAt - b.dueAt);
  return open[0] ?? null;
}

/** سررسید مؤثر: در حالت اقساطی، سررسید نزدیک‌ترین قسط باز */
export function studentDueAt(s: Student): number {
  const next = nextUnpaidInstallment(s);
  return next ? next.dueAt : s.nextDueAt;
}

/** جمع مبلغ باقی‌ماندهٔ اقساط پرداخت‌نشده */
export function studentRemainingInstallments(s: Student): number {
  return studentInstallments(s)
    .filter((i) => !i.paidAt)
    .reduce((a, i) => a + i.amount, 0);
}

/** ساخت زمان‌بندی خودکار اقساط */
export function buildInstallmentPlan(opts: {
  total: number;
  count: number;
  firstDueAt: number;
  intervalDays: number;
}): StudentInstallment[] {
  const count = Math.max(1, Math.round(opts.count));
  const total = Math.max(0, Math.round(opts.total));
  const base = Math.floor(total / count);
  // باقی‌ماندهٔ تقسیم به قسط آخر اضافه می‌شود تا جمع دقیقاً برابر کل شود
  const rest = total - base * count;
  return Array.from({ length: count }, (_, i) => ({
    id: cryptoId(),
    amount: i === count - 1 ? base + rest : base,
    dueAt: opts.firstDueAt + i * opts.intervalDays * 86_400_000,
  }));
}

export type StudentStatus = "overdue" | "due-today" | "soon" | "ok";

export function studentStatus(s: Student): StudentStatus {
  if (!s.active) return "ok";
  const d = studentDaysToDue(s);
  if (d < 0) return "overdue";
  if (d === 0) return "due-today";
  if (d <= 3) return "soon";
  return "ok";
}

export const students = {
  useAll: () => useStore<Student[]>(STUDENTS_KEY, []),
  getAll: () => read<Student[]>(STUDENTS_KEY, []),
  save: (list: Student[]) => write(STUDENTS_KEY, list),

  add: (
    s: Omit<Student, "id" | "createdAt" | "payments" | "nextDueAt" | "active"> & {
      nextDueAt?: number;
      active?: boolean;
    },
  ): Student => {
    const nextDueAt = s.nextDueAt ?? s.startDate + s.periodDays * 86_400_000;
    const created: Student = {
      ...s,
      id: cryptoId(),
      createdAt: Date.now(),
      active: s.active ?? true,
      nextDueAt,
      payments: [],
    };
    write(STUDENTS_KEY, [created, ...read<Student[]>(STUDENTS_KEY, [])]);
    return created;
  },

  update: (updated: Student) => {
    const list = read<Student[]>(STUDENTS_KEY, []);
    write(
      STUDENTS_KEY,
      list.map((s) => (s.id === updated.id ? updated : s)),
    );
  },

  remove: (id: string) => {
    write(
      STUDENTS_KEY,
      read<Student[]>(STUDENTS_KEY, []).filter((s) => s.id !== id),
    );
  },

  /** ثبت پرداخت و پیش‌بردن سررسید بعدی */
  recordPayment: (studentId: string, opts: { amount?: number; days?: number; note?: string }) => {
    const list = read<Student[]>(STUDENTS_KEY, []);
    const next = list.map((s) => {
      if (s.id !== studentId) return s;
      const amount = opts.amount ?? s.fee;
      const days = opts.days ?? s.periodDays;
      const today = todayStartTs();
      // اگر خیلی عقب افتاده، از امروز مبنا می‌گیریم تا سررسید بی‌نهایت عقب نماند
      const base = Math.max(s.nextDueAt, today);
      const nextDueAt = base + days * 86_400_000;
      const payment: StudentPayment = {
        id: cryptoId(),
        amount,
        at: Date.now(),
        periodStart: s.nextDueAt,
        nextDueAt,
        note: opts.note,
      };
      return { ...s, nextDueAt, payments: [payment, ...s.payments] };
    });
    write(STUDENTS_KEY, next);
  },

  /** پرداخت یک قسط مشخص */
  payInstallment: (
    studentId: string,
    installmentId: string,
    opts?: { amount?: number; note?: string },
  ) => {
    const list = read<Student[]>(STUDENTS_KEY, []);
    const next = list.map((s) => {
      if (s.id !== studentId) return s;
      const installments = (s.installments ?? []).map((i) =>
        i.id === installmentId && !i.paidAt
          ? {
              ...i,
              paidAt: Date.now(),
              paidAmount: opts?.amount ?? i.amount,
              note: opts?.note ?? i.note,
            }
          : i,
      );
      const target = installments.find((i) => i.id === installmentId);
      const updated: Student = { ...s, installments };
      const upcoming = nextUnpaidInstallment(updated);
      const payment: StudentPayment = {
        id: cryptoId(),
        amount: target?.paidAmount ?? 0,
        at: Date.now(),
        periodStart: target?.dueAt ?? Date.now(),
        nextDueAt: upcoming ? upcoming.dueAt : s.nextDueAt,
        note: opts?.note ?? "پرداخت قسط",
      };
      return {
        ...updated,
        nextDueAt: upcoming ? upcoming.dueAt : s.nextDueAt,
        payments: [payment, ...s.payments],
      };
    });
    write(STUDENTS_KEY, next);
  },

  /** لغو پرداخت یک قسط (اگر اشتباه ثبت شده باشد) */
  unpayInstallment: (studentId: string, installmentId: string) => {
    const list = read<Student[]>(STUDENTS_KEY, []);
    write(
      STUDENTS_KEY,
      list.map((s) => {
        if (s.id !== studentId) return s;
        const installments = (s.installments ?? []).map((i) =>
          i.id === installmentId ? { ...i, paidAt: undefined, paidAmount: undefined } : i,
        );
        const updated: Student = { ...s, installments };
        const upcoming = nextUnpaidInstallment(updated);
        return { ...updated, nextDueAt: upcoming ? upcoming.dueAt : s.nextDueAt };
      }),
    );
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function emptyInvoice(): Invoice {
  return { id: cryptoId(), createdAt: Date.now(), items: [], total: 0 };
}

/**
 * بازمحاسبه‌ی مبالغ فاکتور. منطق محاسبه در ‎@/lib/invoice-math‎ متمرکز است تا
 * صفحه، چاپ، PDF و اکسل همگی دقیقاً یک عدد را نشان بدهند.
 * هر تغییری در اقلام/تخفیف باید از این تابع رد شود.
 */
export function recalc(inv: Invoice): Invoice {
  const t = invoiceTotals(inv);
  // اگر تخفیف درصدی فعال است، «مبلغ تخفیف» نباید به‌عنوان یک مقدار مستقل ذخیره
  // شود؛ وگرنه با تغییر اقلام، عددِ کهنه روی فاکتور می‌ماند و دو منبع حقیقت
  // می‌سازد. مبلغ همیشه از درصد بازمحاسبه می‌شود.
  const pct = Math.max(0, Math.min(100, Number(inv.discountPercent) || 0));
  // مالیات فقط درصدی است؛ مبلغش همیشه از روی درصد و «جمع اقلام − تخفیف»
  // بازمحاسبه می‌شود (invoiceTotals) تا با تغییر اقلام، عدد کهنه باقی نماند.
  const taxPct = Math.max(0, Math.min(100, Number(inv.taxPercent) || 0));
  return {
    ...inv,
    subtotal: t.subtotal,
    discountPercent: pct > 0 ? pct : undefined,
    discountAmount: pct > 0 ? undefined : t.discount > 0 ? t.discount : undefined,
    taxPercent: taxPct > 0 ? taxPct : undefined,
    total: t.total,
  };
}

export function cryptoId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function addProductToInvoice(inv: Invoice, p: Product): Invoice {
  const existing = inv.items.find((i) => i.productId === p.id);
  let items;
  if (existing) {
    items = inv.items.map((i) =>
      i.productId === p.id ? applyAutoWholesale({ ...i, quantity: i.quantity + 1 }, p) : i,
    );
  } else {
    const effectivePrice = applyProductDiscount(p);
    const hasDiscount = effectivePrice < p.price;
    items = [
      ...inv.items,
      {
        productId: p.id,
        name: p.name,
        price: effectivePrice,
        quantity: 1,
        buyPrice: p.buyPrice,
        unit: p.unit,
        discountPercent: hasDiscount
          ? Math.max(0, Math.min(100, Number(p.discountPercent) || 0))
          : undefined,
        originalPrice: hasDiscount ? p.price : undefined,
      },
    ];
  }
  return recalc({ ...inv, items });
}

/**
 * افزودن محصول به فاکتور با مقدار و واحد مشخص (برای ثبت صوتی استفاده می‌شود).
 * تابع موجود `addProductToInvoice` دست‌نخورده می‌ماند؛ این نسخه مقدار دلخواه را
 * می‌گیرد: برای محصول وزنی مقدار را جمع می‌کند و برای محصول عددی هم همین‌طور.
 */
export function addProductToInvoiceQty(
  inv: Invoice,
  p: Product,
  quantity: number,
  opts?: { unitPrice?: number },
): Invoice {
  const qty = quantity > 0 ? quantity : 1;
  const customPrice = opts?.unitPrice != null && opts.unitPrice > 0 ? opts.unitPrice : undefined;
  const existing = inv.items.find(
    (i) => i.productId === p.id && (customPrice == null || i.price === customPrice),
  );
  let items;
  if (existing) {
    items = inv.items.map((i) =>
      i.productId === existing.productId && i.price === existing.price
        ? customPrice != null
          ? { ...i, quantity: i.quantity + qty, price: customPrice }
          : applyAutoWholesale({ ...i, quantity: i.quantity + qty }, p)
        : i,
    );
  } else {
    const effectivePrice = customPrice ?? applyProductDiscount(p);
    const hasDiscount = customPrice == null && effectivePrice < p.price;
    items = [
      ...inv.items,
      {
        productId: p.id,
        name: p.name,
        price: effectivePrice,
        quantity: qty,
        buyPrice: p.buyPrice,
        unit: p.unit,
        discountPercent: hasDiscount
          ? Math.max(0, Math.min(100, Number(p.discountPercent) || 0))
          : undefined,
        originalPrice: hasDiscount ? p.price : undefined,
      },
    ];
    if (customPrice == null) {
      items = items.map((i) => (i.productId === p.id ? applyAutoWholesale(i, p) : i));
    }
  }
  return recalc({ ...inv, items });
}

/** ردیف فاکتور آزاد — بدون وابستگی به فهرست محصولات و موجودی انبار */
export function isManualInvoiceItem(item: InvoiceItem): boolean {
  return item.productId.startsWith("manual-");
}

export function addCustomInvoiceLine(
  inv: Invoice,
  line: { name: string; price: number; quantity: number; unit?: string },
): Invoice {
  const qty = line.quantity > 0 ? line.quantity : 1;
  const name = line.name.trim();
  if (!name) return inv;
  const unit = line.unit || COUNT_UNIT;
  const price = Math.max(0, Math.round(line.price || 0));
  const existing = inv.items.find(
    (i) =>
      isManualInvoiceItem(i) && i.name === name && i.price === price && (i.unit || COUNT_UNIT) === unit,
  );
  const items = existing
    ? inv.items.map((i) => (i === existing ? { ...i, quantity: i.quantity + qty } : i))
    : [
        ...inv.items,
        {
          productId: `manual-${cryptoId()}`,
          name,
          price,
          quantity: qty,
          unit,
        },
      ];
  return recalc({ ...inv, items });
}

/**
 * قیمت موثر پس از اعمال درصد تخفیف محصول (در صورت وجود).
 * اگر تخفیفی نباشد، خود `price` برمی‌گردد.
 */
export function applyProductDiscount(p: Product): number {
  const d = Math.max(0, Math.min(100, Number(p.discountPercent) || 0));
  if (!d) return p.price;
  return Math.round((p.price * (100 - d)) / 100);
}

/**
 * اگر برای محصول قیمت عمده و حداقل تعداد تعریف شده باشد و تعداد ردیف به آن حد رسیده باشد
 * و قیمت فعلی همچنان قیمت تک‌فروشی (با/بدون تخفیف) باشد، قیمت را به عمده تبدیل می‌کند.
 * ویرایش دستی قیمت توسط کاربر حفظ می‌شود (فقط از قیمت پایه به عمده سوییچ می‌کند).
 */
export function applyAutoWholesale(item: InvoiceItem, p: Product): InvoiceItem {
  const wp = Number(p.wholesalePrice) || 0;
  const minQty = Number(p.wholesaleMinQty) || 0;
  if (!wp || !minQty) return item;
  const retail = applyProductDiscount(p);
  // Only auto-switch if current price is still the retail price (user hasn't manually customized)
  if (item.quantity >= minQty && item.price === retail) {
    return { ...item, price: wp };
  }
  return item;
}

/**
 * ساخت لینک عمومی صفحه فروشگاه برای یک کاربر مشخص.
 * شناسه فروشگاه همان شناسه کاربر (user id) است.
 */
export function storePublicUrl(userId: string): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://kamixapp.ir";
  return `${origin}/store/${userId}`;
}

/** فرمت عدد با جداکننده هزارگان (ارقام فارسی) */
export function formatNumber(n: number | string): string {
  if (typeof n === "string") {
    // رشته‌ها (مثل «۰۹» یا شماره کارت) فقط رقم‌هایشان فارسی می‌شود تا صفرِ ابتدایی حفظ شود
    return n.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
  }
  return new Intl.NumberFormat("fa-IR").format(n);
}

// ─── واحد نمایش مبالغ (تومان/ریال) ──────────────────────────────────────────
// همه‌ی مبالغ همیشه «به تومان» ذخیره می‌شوند؛ این تنظیم نمایش و ورودی را تغییر می‌دهد.
// ورود در واحد نمایش (ریال یا تومان) با fromDisplayAmount به تومان تبدیل می‌شود.

export type CurrencyUnit = "toman" | "rial";

let cachedCurrencyUnit: CurrencyUnit | null = null;
if (typeof window !== "undefined") {
  // با هر تغییر تنظیمات (یا تعویض کاربر) کش واحد نمایش باطل می‌شود
  window.addEventListener("store-change", () => {
    cachedCurrencyUnit = null;
  });
  window.addEventListener("storage", () => {
    cachedCurrencyUnit = null;
  });
}

export function getCurrencyUnit(): CurrencyUnit {
  if (cachedCurrencyUnit == null) {
    cachedCurrencyUnit = settings.get().currencyUnit === "rial" ? "rial" : "toman";
  }
  return cachedCurrencyUnit;
}

/** برچسب واحد نمایش («تومان» یا «ریال») */
export function currencyLabel(): string {
  return getCurrencyUnit() === "rial" ? "ریال" : "تومان";
}

/** عدد مبلغ (ذخیره‌شده به تومان) در واحد نمایش انتخابی — بدون برچسب */
export function formatAmount(n: number): string {
  return formatNumber(getCurrencyUnit() === "rial" ? n * 10 : n);
}

/** نمایش کامل مبلغ با برچسب واحد، بر اساس انتخاب کاربر در تنظیمات */
export function formatToman(n: number): string {
  return formatAmount(n) + " " + currencyLabel();
}

/**
 * مبلغ ذخیره‌شده (تومان) → عددی که کاربر در واحد نمایش می‌بیند/وارد می‌کند.
 * ریال = تومان × ۱۰. ورودی نامعتبر → ۰.
 */
export function toDisplayAmount(toman: number, unit: CurrencyUnit = getCurrencyUnit()): number {
  const n = Number(toman);
  if (!Number.isFinite(n) || n === 0) return 0;
  return unit === "rial" ? Math.round(n * 10) : Math.round(n);
}

/**
 * عدد تایپ‌شده در واحد نمایش → تومان برای ذخیره.
 * ریال ÷ ۱۰ (گرد به نزدیک‌ترین تومان). ورودی نامعتبر → ۰.
 */
export function fromDisplayAmount(display: number, unit: CurrencyUnit = getCurrencyUnit()): number {
  const n = Number(display);
  if (!Number.isFinite(n) || n === 0) return 0;
  return unit === "rial" ? Math.round(n / 10) : Math.round(n);
}

/** پارس ورودی مبلغ در واحد نمایش فعلی، خروجی همیشه تومان ذخیره‌ای است */
export function parseDisplayAmountInput(s: string, unit: CurrencyUnit = getCurrencyUnit()): number {
  return fromDisplayAmount(parseNumberInput(s), unit);
}

// ─── Jalali (Persian) date helpers ─────────────────────────────────────────
// Deterministic Gregorian↔Jalali conversion (jalaali-js algorithm by Behrang Noruzi Niya)
// Independent of the host ICU calendar so results are identical across browsers/OSes and
// always match the official Iranian Solar Hijri calendar.

function div(a: number, b: number): number {
  return ~~(a / b);
}

/** Convert Gregorian (gy, gm, gd) → Julian Day Number */
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * ((gm + 9) % 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** Is a given Jalali year a leap year (Khayyam-Borkowski algorithm)? */
function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const breaks = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
    2456, 3178,
  ];
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  if (jy < jp || jy >= breaks[bl - 1]) throw new Error("Invalid Jalali year " + jy);
  let jump = 0;
  let jm: number;
  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(jump % 33, 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div((n % 33) + 3, 4);
  if (jump % 33 === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = (((n + 1) % 33) - 1) % 4;
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** Convert Julian Day Number → Jalali (jy, jm, jd) */
function d2j(jdn: number): { jy: number; jm: number; jd: number } {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      const jm = 1 + div(k, 31);
      const jd = (k % 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  const jm = 7 + div(k, 30);
  const jd = (k % 30) + 1;
  return { jy, jm, jd };
}

/** Convert Julian Day Number → Gregorian (gy, gm, gd) */
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(j % 1461, 4) * 5 + 308;
  const gd = div(i % 153, 5) + 1;
  const gm = (div(i, 153) % 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** Extract Gregorian y/m/d/h/m in Asia/Tehran regardless of host timezone. */
function tehranParts(d: Date): {
  y: number;
  m: number;
  day: number;
  h: number;
  min: number;
  dow: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let h = parseInt(map.hour, 10);
  if (h === 24) h = 0; // some ICU builds return "24" for midnight
  return {
    y: parseInt(map.year, 10),
    m: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    h,
    min: parseInt(map.minute, 10),
    dow: dowMap[map.weekday] ?? 0,
  };
}

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
function toFa(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
}
function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export const JMONTHS_LONG = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];
const JMONTHS_SHORT = JMONTHS_LONG; // Persian months don't have a distinct short form
const WEEKDAYS_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

export function toJalali(
  ts: number | string | Date,
): { jy: number; jm: number; jd: number; h: number; min: number; dow: number } | null {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    const g = tehranParts(d);
    if (!Number.isFinite(g.y) || !Number.isFinite(g.m) || !Number.isFinite(g.day)) return null;
    const jdn = g2d(g.y, g.m, g.day);
    const j = d2j(jdn);
    return { jy: j.jy, jm: j.jm, jd: j.jd, h: g.h, min: g.min, dow: g.dow };
  } catch {
    return null;
  }
}

export function formatJalaliDate(ts: number | string | Date): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${toFa(j.jy)}/${toFa(pad2(j.jm))}/${toFa(pad2(j.jd))}`;
}
export function formatJalaliDateTime(ts: number | string | Date): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${toFa(j.jy)}/${toFa(pad2(j.jm))}/${toFa(pad2(j.jd))}، ${toFa(pad2(j.h))}:${toFa(pad2(j.min))}`;
}
export function formatJalaliLong(ts: number | string | Date): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${WEEKDAYS_FA[j.dow]} ${toFa(j.jd)} ${JMONTHS_LONG[j.jm - 1]} ${toFa(j.jy)}، ساعت ${toFa(pad2(j.h))}:${toFa(pad2(j.min))}`;
}
export function formatJalaliShort(ts: number | string | Date): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${toFa(j.jd)} ${JMONTHS_SHORT[j.jm - 1]}`;
}

// Jalali → Julian Day Number (inverse of d2j)
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

/** تعداد روزهای یک ماه شمسی (برای ساخت لیست انتخابی روز در فرم‌ها) */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (!Number.isFinite(jy) || !Number.isFinite(jm) || jm < 1 || jm > 12) {
    return 30;
  }
  try {
    const nextJy = jm === 12 ? jy + 1 : jy;
    const nextJm = jm === 12 ? 1 : jm + 1;
    const len = j2d(nextJy, nextJm, 1) - j2d(jy, jm, 1);
    return len > 0 && len <= 31 ? len : jm <= 6 ? 31 : jm <= 11 ? 30 : 29;
  } catch {
    return jm <= 6 ? 31 : jm <= 11 ? 30 : 29;
  }
}

/** Convert a Jalali date (interpreted in Asia/Tehran) to a UTC timestamp (ms). */
export function jalaliToTimestamp(jy: number, jm: number, jd: number, h = 0, min = 0): number {
  try {
    if (!Number.isFinite(jy) || !Number.isFinite(jm) || !Number.isFinite(jd)) return NaN;
    const g = d2g(j2d(jy, jm, jd));
    // Guess as if the wall-clock were UTC, then correct by Tehran's offset.
    const guess = Date.UTC(g.gy, g.gm - 1, g.gd, h, min, 0);
    const t = tehranParts(new Date(guess));
    const asUTCFromTehran = Date.UTC(t.y, t.m - 1, t.day, t.h, t.min, 0);
    const offset = asUTCFromTehran - guess; // Tehran ahead of UTC in ms
    return guess - offset;
  } catch {
    return NaN;
  }
}

/** تاریخ میلادی ISO مثل 2026-09-25 — نباید به‌عنوان شمسی پارس شود */
function looksLikeIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(s.trim());
  if (!m) return false;
  const y = +m[1];
  // سال میلادی رایج؛ سال شمسی ۱۳xx/۱۴xx با خط تیره را ISO نگیر
  return y >= 1800 && y <= 2200;
}

/** Parse strings like `1403/05/12` (Persian/Arabic digits OK) into Jalali parts. */
export function parseJalaliInput(s: string): { jy: number; jm: number; jd: number } | null {
  if (!s) return null;
  const en = s
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .trim();
  // ISO میلادی (YYYY-MM-DD) را شمسی نگیر — باعث کرش «Invalid Jalali year» می‌شد
  if (looksLikeIsoDate(en)) return null;
  const m = en.match(/^(\d{3,4})([.\-/])(\d{1,2})\2(\d{1,2})$/);
  if (!m) return null;
  const jy = +m[1],
    jm = +m[3],
    jd = +m[4];
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  // سال شمسی این برنامه در بازه‌ی ۱۲۰۰–۱۷۰۰ است؛ ۲۰۲۶ میلادی را رد کن
  if (jy < 1200 || jy > 1700) return null;
  return { jy, jm, jd };
}

/** Parse `HH:MM` (Persian digits OK). Also accepts `HHMM`/`HMM` without a colon
 *  (useful on mobile numeric keypads that don't have a ':' key). Returns null on invalid input. */
export function parseTimeInput(s: string): { h: number; min: number } | null {
  if (!s) return null;
  const en = s
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .trim();
  const withColon = en.match(/^(\d{1,2}):(\d{1,2})$/);
  if (withColon) {
    const h = +withColon[1],
      min = +withColon[2];
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return { h, min };
  }
  // بدون «:» — مثلاً «1430» یا «930» (کیبورد عددی موبایل معمولاً کلید «:» ندارد)
  const digitsOnly = en.match(/^\d{3,4}$/);
  if (digitsOnly) {
    const raw = digitsOnly[0];
    const h = +raw.slice(0, raw.length - 2);
    const min = +raw.slice(-2);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return { h, min };
  }
  return null;
}

/** Get Jalali parts formatted as `YYYY/MM/DD` in Latin digits (for editing inputs). */
export function toJalaliInputDate(ts: number | string | Date): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
}
export function toJalaliInputTime(ts: number | string | Date): string {
  const j = toJalali(ts);
  if (!j) return "";
  return `${pad2(j.h)}:${pad2(j.min)}`;
}

/** تاریخ میلادی YYYY-MM-DD به وقت تهران */
export function isoDateFromTimestamp(ts: number | string | Date): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** تبدیل ورودی شمسی YYYY/MM/DD به ISO میلادی YYYY-MM-DD */
export function jalaliInputToIsoDate(s: string): string {
  const p = parseJalaliInput(s);
  if (!p) return "";
  const ts = jalaliToTimestamp(p.jy, p.jm, p.jd, 12, 0);
  if (!Number.isFinite(ts)) return "";
  return isoDateFromTimestamp(ts);
}

/** ISO میلادی یا شمسی → رشته‌ی ویرایش شمسی YYYY/MM/DD */
export function toJalaliInputFromDue(due?: string): string {
  if (!due) return "";
  const trimmed = due.trim();
  if (looksLikeIsoDate(trimmed)) return toJalaliInputDate(trimmed);
  const parsed = parseJalaliInput(trimmed);
  if (parsed) return `${parsed.jy}/${pad2(parsed.jm)}/${pad2(parsed.jd)}`;
  return toJalaliInputDate(due);
}

/** نمایش تاریخ سررسید چک به شمسی، چه ISO باشد چه شمسی ذخیره‌شده */
export function formatChequeDue(due?: string): string {
  if (!due) return "";
  const parsed = parseJalaliInput(due);
  if (parsed) return `${toFa(parsed.jy)}/${toFa(pad2(parsed.jm))}/${toFa(pad2(parsed.jd))}`;
  return formatJalaliDate(due);
}

/** نمایش رشته تاریخ شمسی YYYY/MM/DD (ارقام فارسی) — موعد تسویه مشتری و مشابه آن */
export function formatJalaliYmd(date?: string): string {
  return formatChequeDue(date);
}

/** timestamp سررسید چک برای یادآوری — ظهر به وقت تهران تا اختلاف روز پیش نیاید */
export function chequeDueTimestamp(due?: string): number | null {
  if (!due) return null;
  const parsed = parseJalaliInput(due);
  if (parsed) return jalaliToTimestamp(parsed.jy, parsed.jm, parsed.jd, 9, 0);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(due.trim());
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T09:00:00+03:30`);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  const t = Date.parse(due);
  return Number.isFinite(t) ? t : null;
}

/**
 * تبدیل ورودی کاربر به عدد: ارقام فارسی/عربی را به انگلیسی تبدیل و
 * جداکننده‌ها را حذف می‌کند. اعشار (برای واحدهای وزنی) پشتیبانی می‌شود.
 */
export function parseNumberInput(s: string): number {
  if (!s) return 0;
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let out = "";
  for (const ch of String(s)) {
    const fi = fa.indexOf(ch);
    const ai = ar.indexOf(ch);
    if (fi >= 0) out += String(fi);
    else if (ai >= 0) out += String(ai);
    else if ((ch >= "0" && ch <= "9") || ch === "." || ch === "/") out += ch === "/" ? "." : ch;
    // ، ٬ , و فاصله به‌عنوان جداکننده نادیده گرفته می‌شوند
  }
  const n = parseFloat(out);
  return Number.isFinite(n) ? n : 0;
}

/** نمایش زنده‌ی عدد با جداکننده هزارگان داخل input (ارقام فارسی) */
export function formatNumberInput(s: string): string {
  const n = parseNumberInput(s);
  if (!n) return s.trim() === "" ? "" : s;
  return formatNumber(n);
}

export function stockStatus(p: Product): "ok" | "low" | "out" {
  if (p.stock <= 0) return "out";
  const threshold = p.lowStockThreshold ?? 5;
  if (p.stock <= threshold) return "low";
  return "ok";
}

/** پیگیری موجودی انبار — پیش‌فرض روشن؛ فقط با خاموش‌کردن صریح در تنظیمات off می‌شود */
export function inventoryTrackingEnabled(s?: AppSettings): boolean {
  return (s ?? settings.get()).trackInventory !== false;
}

/** روزهای باقیمانده تا انقضا (منفی یعنی منقضی‌شده). اگر تاریخ انقضا ثبت نشده باشد null. */
export function daysToExpiry(p: Product, now = Date.now()): number | null {
  if (!p.expiryAt) return null;
  return Math.ceil((p.expiryAt - now) / 86400000);
}

/** وضعیت انقضا — فقط برای محصولاتی که کاربر تاریخ انقضا ثبت کرده است. */
export function expiryStatus(
  p: Product,
  soonDays = 30,
  now = Date.now(),
): "none" | "expired" | "soon" | "ok" {
  const d = daysToExpiry(p, now);
  if (d === null) return "none";
  if (d < 0) return "expired";
  if (d <= soonDays) return "soon";
  return "ok";
}
