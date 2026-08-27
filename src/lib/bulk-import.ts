// Parse Excel/CSV product files into normalized rows.
import * as XLSX from "xlsx";
import type { Product } from "@/lib/store";

export type ImportRow = {
  rowIndex: number;
  name: string;
  code: string;
  price: number;
  buyPrice?: number;
  stock: number;
  category: string;
  description?: string;
  unit?: string;
  errors: string[];
};

const HEADERS: Record<string, keyof Omit<ImportRow, "rowIndex" | "errors">> = {
  "نام": "name", "نام محصول": "name", "نام کالا": "name", "عنوان": "name", "عنوان کالا": "name",
  "شرح کالا": "name", "شرح": "name", "نام جنس": "name",
  "بارکد": "code", "کد": "code", "کد بارکد": "code", "کد کالا": "code", "کد جنس": "code", "شناسه": "code", "شماره": "code",
  "قیمت": "price", "قیمت فروش": "price", "مبلغ": "price", "مبلغ فروش": "price", "بها": "price", "ارزش": "price", "فی": "price", "فی فروش": "price",
  "قیمت خرید": "buyPrice", "مبلغ خرید": "buyPrice", "فی خرید": "buyPrice", "بهای خرید": "buyPrice",
  "موجودی": "stock", "تعداد": "stock", "موجودی کالا": "stock", "موجودی انبار": "stock", "تعداد کالا": "stock", "انبار": "stock", "مقدار": "stock",
  "دسته": "category", "دسته بندی": "category", "دسته‌بندی": "category", "گروه": "category", "گروه کالا": "category", "نوع": "category",
  "توضیحات": "description", "توضیح": "description", "یادداشت": "description",
  "واحد": "unit", "واحد کالا": "unit", "واحد شمارش": "unit",
  "name": "name", "product": "name", "product name": "name", "title": "name", "item": "name",
  "barcode": "code", "code": "code", "sku": "code", "id": "code",
  "price": "price", "sellprice": "price", "sell_price": "price", "sell price": "price", "amount": "price",
  "buyprice": "buyPrice", "buy_price": "buyPrice", "buy price": "buyPrice", "cost": "buyPrice",
  "stock": "stock", "qty": "stock", "quantity": "stock", "inventory": "stock",
  "category": "category", "group": "category",
  "description": "description", "desc": "description", "note": "description",
  "unit": "unit",
};

// نگاشت انعطاف‌پذیر (fallback) برای عناوین ستونی که در جدول بالا دقیقاً نیامده‌اند؛
// هر فایل اکسل با نام‌گذاری متفاوت ستون‌ها (خروجی نرم‌افزارهای مختلف فروشگاهی) را پوشش می‌دهد.
// ترتیب کلیدها مهم است: مشخص‌ترین‌ها (کد/قیمت خرید) قبل از کلی‌ترین‌ها (نام) بررسی می‌شوند
// تا مثلاً «قیمت خرید» به‌اشتباه به‌جای buyPrice روی price ننشیند.
const FUZZY_RULES: Array<[keyof Omit<ImportRow, "rowIndex" | "errors">, string[]]> = [
  ["code", ["بارکد", "کد", "شناسه", "barcode", "code", "sku"]],
  ["buyPrice", ["خرید", "buy", "cost"]],
  ["price", ["قیمت", "مبلغ", "بها", "ارزش", "فی", "price", "sell", "amount"]],
  ["stock", ["موجودی", "انبار", "تعداد", "مقدار", "stock", "qty", "quantity", "inventory"]],
  ["category", ["دسته", "گروه", "نوع", "category", "group"]],
  ["unit", ["واحد", "unit"]],
  ["description", ["توضیح", "شرح", "یادداشت", "desc", "note"]],
  ["name", ["نام", "عنوان", "کالا", "جنس", "محصول", "name", "product", "title", "item"]],
];

function fuzzyMatchHeader(
  h: string,
  claimed: Set<keyof Omit<ImportRow, "rowIndex" | "errors">>,
): keyof Omit<ImportRow, "rowIndex" | "errors"> | null {
  for (const [key, keywords] of FUZZY_RULES) {
    if (claimed.has(key)) continue; // این ستون قبلاً (با تطبیق دقیق یا فازی) پر شده — رویش ننویس
    if (keywords.some((kw) => h.includes(kw))) return key;
  }
  return null;
}

/**
 * نرمال‌سازی نام ستون: حذف هرچیز داخل پرانتز (مثل «(تومان)»)،
 * حذف فاصله‌های اضافه، یکسان‌سازی نیم‌فاصله و حروف کوچک.
 */
function normalizeHeader(h: string): string {
  return String(h ?? "")
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[,\s\u066B\u066C]/g, "").replace(/[٠-٩۰-۹]/g, (d) => {
    const i = "٠١٢٣٤٥٦٧٨٩".indexOf(d);
    if (i >= 0) return String(i);
    return String("۰۱۲۳۴۵۶۷۸۹".indexOf(d));
  });
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

export async function parseFile(file: File): Promise<ImportRow[]> {
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_ROWS = 5000;
  if (file.size > MAX_BYTES) {
    throw new Error("حجم فایل بیش از ۲ مگابایت است.");
  }
  const buf = await file.arrayBuffer();
  // cellFormula/cellHTML خاموش: فایل اکسل مخرب نباید فرمول یا HTML را اجرا/تزریق کند.
  const wb = XLSX.read(buf, { type: "array", cellFormula: false, cellHTML: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (json.length === 0) return [];
  if (json.length > MAX_ROWS + 1) json.length = MAX_ROWS + 1;

  const headerRow = json[0].map((h) => normalizeHeader(String(h ?? "")));
  type Key = keyof Omit<ImportRow, "rowIndex" | "errors">;
  const colMap: (Key | null)[] = new Array(headerRow.length).fill(null);
  const claimed = new Set<Key>();

  // مرحله‌ی اول: فقط تطبیق دقیق (عنوان ستون دقیقاً در HEADERS باشد) — این‌ها
  // همیشه اولویت دارند و کلید مربوطه را برای همیشه «رزرو» می‌کنند.
  headerRow.forEach((h, i) => {
    const key = HEADERS[h];
    if (key) { colMap[i] = key; claimed.add(key); }
  });

  // مرحله‌ی دوم: برای ستون‌هایی که در مرحله‌ی اول تطبیق دقیق نداشتند، از حدس
  // فازی استفاده می‌کنیم — اما فقط برای کلیدهایی که هنوز رزرو نشده‌اند. این‌طوری
  // یک ستون اضافی/مشتق‌شده (مثل «ارزش موجودی» یا «قیمت مصرف‌کننده» در خروجی
  // خودِ همین برنامه) هرگز نمی‌تواند مقدار ستون اصلی (مثلاً قیمت فروش واقعی) را
  // که با تطبیق دقیق پیدا شده بود، رونویسی/خراب کند.
  headerRow.forEach((h, i) => {
    if (colMap[i]) return;
    const key = fuzzyMatchHeader(h, claimed);
    if (key) { colMap[i] = key; claimed.add(key); }
  });

  const rows: ImportRow[] = [];
  for (let i = 1; i < json.length; i++) {
    const raw = json[i];
    if (!raw || raw.every((c) => c === "" || c == null)) continue;
    const row: ImportRow = {
      rowIndex: i + 1, name: "", code: "", price: 0, stock: 0, category: "",
      errors: [],
    };
    raw.forEach((cell, idx) => {
      const key = colMap[idx];
      if (!key) return;
      if (key === "price" || key === "buyPrice" || key === "stock") (row as any)[key] = num(cell);
      else (row as any)[key] = String(cell ?? "").trim();
    });
    if (!row.name) row.errors.push("نام محصول خالی است");
    if (!row.price) row.errors.push("قیمت فروش خالی یا نامعتبر است");
    rows.push(row);
  }
  return rows;
}

export function sampleWorkbook(): Blob {
  const data = [
    ["نام", "بارکد", "قیمت خرید", "قیمت فروش", "موجودی", "دسته", "واحد", "توضیحات"],
    ["شیر پرچرب کاله", "1234567890123", 18000, 25000, 100, "لبنیات", "عدد", "بطری ۱ لیتری"],
    ["نان بربری", "", 0, 15000, 200, "مواد غذایی", "عدد", ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadSample() {
  const url = URL.createObjectURL(sampleWorkbook());
  const a = document.createElement("a");
  a.href = url; a.download = "نمونه-محصولات.xlsx"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type MergeResult = { added: number; updated: number };

export function mergeImported(
  existing: Product[],
  rows: ImportRow[],
  cryptoId: () => string,
): { list: Product[]; result: MergeResult } {
  const byCode = new Map<string, Product>();
  for (const p of existing) if (p.code) byCode.set(p.code, p);
  let added = 0, updated = 0;
  const next = [...existing];
  for (const r of rows) {
    if (r.errors.length) continue;
    const base = {
      name: r.name, price: r.price, stock: r.stock || 0,
      category: r.category || "", code: r.code || "",
      description: r.description || undefined,
      buyPrice: r.buyPrice || undefined,
      unit: r.unit || undefined,
    };
    if (r.code && byCode.has(r.code)) {
      const existingP = byCode.get(r.code)!;
      const idx = next.findIndex((p) => p.id === existingP.id);
      if (idx >= 0) {
        next[idx] = { ...existingP, ...base };
        updated++;
      }
    } else {
      next.unshift({ id: cryptoId(), ...base });
      added++;
    }
  }
  return { list: next, result: { added, updated } };
}
