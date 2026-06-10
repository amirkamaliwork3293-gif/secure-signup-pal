import type { SubscriptionPlan } from "@/lib/supabase";

export type PlanConfig = {
  enabled: boolean;
  price: number;
  duration_minutes: number;
  discount_percent: number;
  discount_until: string | null;
};

export type PlansConfig = Record<SubscriptionPlan, PlanConfig>;

export const DEFAULT_PLANS: PlansConfig = {
  trial:    { enabled: true, price: 0,       duration_minutes: 60,     discount_percent: 0, discount_until: null },
  "1month": { enabled: true, price: 100000,  duration_minutes: 43200,  discount_percent: 0, discount_until: null },
  "3month": { enabled: true, price: 280000,  duration_minutes: 129600, discount_percent: 0, discount_until: null },
  "6month": { enabled: true, price: 500000,  duration_minutes: 259200, discount_percent: 0, discount_until: null },
  "12month":{ enabled: true, price: 1500000, duration_minutes: 525600, discount_percent: 0, discount_until: null },
};

export function normalizePlans(input: any): PlansConfig {
  const out = { ...DEFAULT_PLANS };
  if (input && typeof input === "object") {
    for (const key of Object.keys(out) as SubscriptionPlan[]) {
      const v = input[key];
      if (v && typeof v === "object") {
        out[key] = {
          enabled: v.enabled !== false,
          price: Number(v.price ?? out[key].price) || 0,
          duration_minutes: Number(v.duration_minutes ?? out[key].duration_minutes) || out[key].duration_minutes,
          discount_percent: Math.max(0, Math.min(100, Number(v.discount_percent ?? 0) || 0)),
          discount_until: v.discount_until ?? null,
        };
      }
    }
  }
  return out;
}

/** Returns true if a discount is currently active (percent > 0 and not expired). */
export function isDiscountActive(cfg: PlanConfig, now = Date.now()): boolean {
  if (!cfg.discount_percent || cfg.discount_percent <= 0) return false;
  if (!cfg.discount_until) return true;
  const until = new Date(cfg.discount_until).getTime();
  return isFinite(until) && until > now;
}

/** Final price after applying an active discount (rounded down to nearest toman). */
export function effectivePrice(cfg: PlanConfig, now = Date.now()): number {
  if (!isDiscountActive(cfg, now)) return cfg.price;
  return Math.max(0, Math.floor(cfg.price * (100 - cfg.discount_percent) / 100));
}