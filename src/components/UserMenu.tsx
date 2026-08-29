import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/AuthContext";
import { PLAN_LABEL } from "@/lib/supabase";
import { User, X, CalendarClock, BadgeCheck, RefreshCw, AlertTriangle } from "lucide-react";
import {
  daysLeftFrom,
  isSubscriptionExpiringSoon,
  isSubscriptionReadOnly,
} from "@/lib/subscription-access";

export { daysLeftFrom };

export function UserMenu() {
  const { state } = useAuth();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [open]);

  if (state.status !== "authenticated" && state.status !== "expired") return null;

  const profile = state.profile as any;
  const left = daysLeftFrom(profile?.end_date);
  const expired = isSubscriptionReadOnly(state) || (left !== null && left <= 0);
  const warn = expired || isSubscriptionExpiringSoon(profile?.end_date);
  const fullName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "کاربر KAMIX";

  const dialog = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      dir="rtl"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-[22rem] max-h-[85svh] overflow-y-auto rounded-3xl border border-border bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold">حساب کاربری</h2>
          <button
            onClick={() => setOpen(false)}
            aria-label="بستن"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground">
            <User className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold">{fullName}</div>
            <div className="truncate text-xs text-muted-foreground" dir="ltr">
              {profile?.username}
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-2 text-xs">
          {profile?.plan && (
            <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <BadgeCheck className="h-3.5 w-3.5" />
                پلن فعلی
              </span>
              <span className="font-semibold">
                {PLAN_LABEL[profile.plan as keyof typeof PLAN_LABEL]}
              </span>
            </div>
          )}
          <div
            className={`flex items-center justify-between rounded-xl px-3 py-2 ${
              warn ? "bg-red-500/10 text-red-600" : "bg-muted/50"
            }`}
          >
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              باقی‌مانده اشتراک
            </span>
            <span className="font-bold">
              {left === null
                ? "نامحدود"
                : left > 0
                  ? `${left.toLocaleString("fa-IR")} روز`
                  : "منقضی شده"}
            </span>
          </div>
          {warn && (
            <div className="flex items-start gap-1.5 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 leading-6 text-red-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {expired
                  ? "اشتراک شما تمام شده است. سوابق را می‌بینید و می‌توانید چاپ یا اکسل بگیرید؛ برای کار جدید تمدید کنید."
                  : left !== null
                    ? `فقط ${left.toLocaleString("fa-IR")} روز تا پایان اشتراک مانده. برای قطع نشدن ثبت فاکتور و اسکن، همین حالا تمدید کنید.`
                    : "اشتراک شما به‌زودی تمام می‌شود. برای جلوگیری از قطع دسترسی تمدید کنید."}
              </span>
            </div>
          )}
        </div>

        <Link
          to="/renew"
          onClick={() => setOpen(false)}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <RefreshCw className="h-4 w-4" />
          تمدید اشتراک
        </Link>
        <p className="mt-2 text-center text-[11px] leading-5 text-muted-foreground">
          مدت پلن جدید به روزهای باقی‌مانده اضافه می‌شود.
        </p>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="حساب کاربری"
        aria-label="حساب کاربری"
        className={`relative grid h-8 w-8 place-items-center rounded-lg border transition-colors ${
          warn
            ? "border-red-500/50 bg-red-500/10 text-red-500"
            : "border-border text-muted-foreground hover:bg-accent"
        }`}
      >
        <User className="h-4 w-4" />
        {warn && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
        )}
      </button>

      {open && mounted && createPortal(dialog, document.body)}
    </>
  );
}
