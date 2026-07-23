/**
 * barcode-code.ts — فقط تولید کد یکتای محصول.
 *
 * این ماژول عمداً از barcode.ts جدا شده تا صفحاتی که فقط به تولید کد نیاز دارند
 * (محصولات، ثبت سریع) کتابخانه‌های سنگین رندر لیبل (bwip-js/jsPDF) را بی‌جهت
 * بارگذاری نکنند. barcode.ts همین را دوباره export می‌کند تا سازگاری حفظ شود.
 */
import { products } from "@/lib/store";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateUniqueCode(existing?: Set<string>): string {
  const taken = existing ?? new Set(products.getAll().map((p) => p.code).filter(Boolean));
  for (let i = 0; i < 50; i++) {
    let code = "P";
    for (let j = 0; j < 9; j++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  return "P" + Date.now().toString(36).toUpperCase();
}
