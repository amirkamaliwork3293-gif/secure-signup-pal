/**
 * Pricing cards — real plans from the public settings (admin panel), with the
 * same discount / recommended-plan rules the previous landing page used.
 * Every card links to /register exactly as before.
 */
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { effectivePrice, isDiscountActive, type PlanConfig } from "@/lib/plans";
import { PLAN_MONTHS } from "./pricing-utils";
import { PLAN_DURATION_LABEL, PLAN_LABEL, type SubscriptionPlan } from "@/lib/supabase";
import { formatToman } from "@/lib/store";
import { faNum } from "./hooks";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${faNum(d)} روز و ${faNum(h)} ساعت`;
  if (h > 0) return `${faNum(h)} ساعت و ${faNum(m)} دقیقه`;
  return `${faNum(m)} دقیقه`;
}

export function PlanCard({
  plan,
  cfg,
  recommended,
  now,
  monthlyBase,
}: {
  plan: SubscriptionPlan;
  cfg: PlanConfig;
  recommended: boolean;
  now: number;
  /** Effective price of the 1-month plan (0 when hidden) — to show real savings only. */
  monthlyBase: number;
}) {
  const discounted = isDiscountActive(cfg, now);
  const final = effectivePrice(cfg, now);
  const months = PLAN_MONTHS[plan] ?? 1;
  const perMonth = months > 1 ? Math.round(final / months) : 0;
  const savingPct =
    perMonth > 0 && monthlyBase > 0 ? Math.round((1 - perMonth / monthlyBase) * 100) : 0;
  const remainingMs = cfg.discount_until
    ? new Date(cfg.discount_until).getTime() - now
    : Number.POSITIVE_INFINITY;

  return (
    <Link
      to="/register"
      preload={false}
      className={`kx-plan ${recommended ? "is-best" : ""}`}
      aria-label={`${PLAN_LABEL[plan]} — ${formatToman(final)} — ثبت‌نام`}
    >
      {recommended && <span className="kx-plan-ribbon">پیشنهاد ما</span>}
      {discounted && <span className="kx-plan-off">{faNum(cfg.discount_percent)}٪ تخفیف</span>}
      <div className="kx-plan-name">{PLAN_LABEL[plan]}</div>
      <div className="kx-plan-dur">{PLAN_DURATION_LABEL[plan]} دسترسی کامل</div>

      <div className="kx-plan-price">
        {discounted && <s>{formatToman(cfg.price)}</s>}
        <strong>{formatToman(final)}</strong>
        {savingPct > 0 ? (
          <>
            <small>معادل ماهی {formatToman(perMonth)}</small>
            <span className="kx-plan-save">{faNum(savingPct)}٪ صرفه‌جویی</span>
          </>
        ) : (
          <small>{months > 1 ? `یک پرداخت برای ${faNum(months)} ماه` : "پرداخت یک‌باره"}</small>
        )}
        {discounted && Number.isFinite(remainingMs) && remainingMs > 0 && (
          <em>{formatRemaining(remainingMs)} تا پایان تخفیف</em>
        )}
      </div>

      <span className="kx-plan-cta">
        انتخاب و ثبت‌نام
        <ArrowLeft />
      </span>
    </Link>
  );
}
