/**
 * ترجیحات محلیِ محاسبه‌گر طلا (آخرین نرخ دستی، درصدهای پیش‌فرض).
 * عمداً کاملاً مستقل از store.ts/AppSettings نگه داشته شده تا به منطق
 * همگام‌سازی ابری تنظیمات دست نخورد — فقط localStorage، فقط این صفحه.
 */

import { DEFAULT_PROFIT_PERCENT, DEFAULT_TAX_PERCENT, DEFAULT_WAGE_PERCENT } from "./gold-calc";

const KEY = "kamix_gold_prefs_v1";

export type GoldPrefs = {
  pricePerGram18: number;
  wagePercent: number;
  profitPercent: number;
  taxPercent: number;
  karat: number;
};

const DEFAULTS: GoldPrefs = {
  pricePerGram18: 0,
  wagePercent: DEFAULT_WAGE_PERCENT,
  profitPercent: DEFAULT_PROFIT_PERCENT,
  taxPercent: DEFAULT_TAX_PERCENT,
  karat: 18,
};

export function loadGoldPrefs(): GoldPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<GoldPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

export function saveGoldPrefs(prefs: Partial<GoldPrefs>) {
  if (typeof window === "undefined") return;
  try {
    const next = { ...loadGoldPrefs(), ...prefs };
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* بی‌اهمیت — فقط یک راحتی برای دفعه‌ی بعد است */
  }
}
