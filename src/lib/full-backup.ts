/**
 * پشتیبان کامل JSON پیش از هر اصلاح داده (سلامت داده‌ها / اتصال فاکتورها).
 * همان قالب «فایل کامل (JSON)» صفحهٔ پشتیبان‌گیری است، به‌علاوهٔ تنظیمات، و در
 * وب و اپ اندروید ذخیره می‌شود. فقط خواندن است و هیچ داده‌ای را عوض نمی‌کند.
 */
import {
  products,
  categories,
  customers,
  invoice,
  purchases,
  expenses,
  reminders,
  students,
  accounts,
  accountTxs,
  production,
  manualLedger,
  settings,
} from "@/lib/store";
import { saveBase64File } from "@/lib/print";

export function buildFullBackupJson(reason: string): Record<string, unknown> {
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    reason,
    products: products.getAll(),
    categories: categories.getAll(),
    customers: customers.getAll(),
    invoices: invoice.getHistory(),
    manualLedger: manualLedger.getAll(),
    purchases: purchases.getAll(),
    expenses: expenses.getAll(),
    reminders: reminders.getAll(),
    students: students.getAll(),
    accounts: accounts.getAll(),
    accountTxs: accountTxs.getAll(),
    production: production.getAll(),
    settings: settings.get(),
  };
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** ذخیرهٔ پشتیبان کامل؛ true یعنی فایل نوشته/دانلود شد */
export async function saveFullBackup(reason: string): Promise<boolean> {
  const json = JSON.stringify(buildFullBackupJson(reason), null, 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return saveBase64File(utf8ToBase64(json), `kamix-backup-${stamp}.json`, "application/json");
}
