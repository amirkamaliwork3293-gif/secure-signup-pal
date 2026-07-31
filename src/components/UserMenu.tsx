import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/AuthContext";
import { PLAN_LABEL } from "@/lib/supabase";
import { User, X, CalendarClock, BadgeCheck, RefreshCw, AlertTriangle } from "lucide-react";

/** روزهای باقی‌مانده تا پایان اشتراک (بالا-گرد) */
export function daysLeftFrom(endDate?: string | null): number | null {
  if (!endDate) return null;
  const ms = new Date(endDate).getTime();
  if (!isFinite(ms)) return null;
  return Math.ceil((ms - Date.now()) / 86_400_000);
}

export function UserMenu() {
  const { state } = useAuth();
  const [open, setOpen] = useState(false);

  if (state.status !== "authenticated") return null;

  const profile = state.profile as any;
  const left = daysLeftFrom(profile?.end_date);
  const warn = left !== null && left <= 2;
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "کاربر KAMIX";

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

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-2 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-t-3xl bg-background p-4 shadow-2xl sm:rounded-3xl"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold">حساب کاربری</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-accent"
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
                  <span className="font-semibold">{PLAN_LABEL[profile.plan as keyof typeof PLAN_LABEL]}</span>
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
                    اشتراک شما به‌زودی به پایان می‌رسد. برای جلوگیری از قطع دسترسی، همین حالا تمدید کنید.
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
      )}
    </>
  );
}
