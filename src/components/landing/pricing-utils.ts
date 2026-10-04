/** Plan helpers for the landing pricing cards (same rules as the previous page). */
import { isDiscountActive, type PlansConfig } from "@/lib/plans";
import type { SubscriptionPlan } from "@/lib/supabase";

export const PAID_PLANS: SubscriptionPlan[] = ["1month", "3month", "6month", "12month"];

export const PLAN_MONTHS: Record<string, number> = {
  "1month": 1,
  "3month": 3,
  "6month": 6,
  "12month": 12,
};

export function pickRecommendedPlan(
  plans: SubscriptionPlan[],
  cfg: PlansConfig,
  now: number,
): SubscriptionPlan | null {
  if (plans.length === 0) return null;
  return plans.reduce(
    (best, p) => {
      const bd = isDiscountActive(cfg[best], now) ? cfg[best].discount_percent : 0;
      const pd = isDiscountActive(cfg[p], now) ? cfg[p].discount_percent : 0;
      return pd > bd ? p : best;
    },
    plans.includes("3month") ? "3month" : plans[0],
  );
}

/** Identical perk list for every plan — plans differ only in duration. */
export const PLAN_PERKS = [
  "فاکتور فروش و خرید نامحدود",
  "ثبت فاکتور با صدا",
  "اسکن بارکد با دوربین گوشی",
  "دستیار هوشمند فارسی",
  "انبار، مشتریان و بدهکاران",
  "گزارش سود و خروجی PDF و اکسل",
  "ساخت سایت تک‌صفحه‌ای فروشگاه",
  "همگام‌سازی بین دستگاه‌ها",
  "پشتیبانی رایگان",
];
