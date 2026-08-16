/**
 * چک‌لیست شروع کار روی داشبورد فاکتور.
 * تیک‌ها فقط از روی داده‌ی واقعی store محاسبه می‌شوند، نه با کلیک کاربر.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronUp, Circle, ListChecks, X } from "lucide-react";
import { invoice, products, settings } from "@/lib/store";
import { useAuth } from "@/lib/AuthContext";
import {
  checklistHidden,
  isShopSetupDone,
  markChecklistHidden,
  resolveOnboardingEligibility,
  waitForStoreHydration,
} from "@/lib/onboarding";

type Item = {
  id: string;
  label: string;
  done: boolean;
  to?: string;
};

export function GettingStartedChecklist() {
  const { state: authState } = useAuth();
  const [appSettings] = settings.useAll();
  const [allProducts] = products.useAll();
  const [history] = invoice.useHistory();
  const [open, setOpen] = useState(true);
  const [leaving, setLeaving] = useState(false);

  const items: Item[] = [
    {
      id: "product",
      label: "ثبت اولین محصول (دستی یا صوتی)",
      done: allProducts.length > 0,
      to: "/products",
    },
    {
      id: "invoice",
      label: "ثبت اولین فاکتور (دستی، اسکن یا صدا)",
      done: history.length > 0,
      to: "/",
    },
    {
      id: "assistant",
      label: "امتحان‌کردن دستیار هوشمند",
      done: !!appSettings.assistantOpened,
    },
    {
      id: "settings",
      label: "تکمیل تنظیمات فروشگاه (نام یا لوگو)",
      done: isShopSetupDone(appSettings),
      to: "/settings",
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;
  const hidden = checklistHidden(appSettings) || appSettings.onboardingEligible !== true;

  useEffect(() => {
    if (authState.status !== "authenticated") return;
    let cancelled = false;
    void waitForStoreHydration().then(() => {
      if (!cancelled) resolveOnboardingEligibility(authState.profile);
    });
    return () => {
      cancelled = true;
    };
  }, [authState]);

  const hideCard = () => {
    setLeaving(true);
    window.setTimeout(() => markChecklistHidden(), 450);
  };

  useEffect(() => {
    if (hidden || !allDone) return;
    hideCard();
  }, [allDone, hidden]);

  if (hidden) return null;

  return (
    <section
      className={`mb-4 overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all duration-500 ${
        leaving ? "max-h-0 mb-0 border-transparent p-0 opacity-0" : "max-h-[28rem] opacity-100"
      }`}
    >
      <div className="flex items-center gap-1 px-2 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1 text-right"
          aria-expanded={open}
        >
          <ListChecks className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">شروع کار با کامیکس</div>
            <div className="text-[11px] text-muted-foreground">
              {doneCount} از {items.length} مورد انجام شده
            </div>
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          onClick={hideCard}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          title="دیگر نمایش داده نشود"
          aria-label="دیگر نمایش داده نشود"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {open && !leaving && (
        <ul className="space-y-1.5 border-t border-border px-3.5 py-3">
          {items.map((item) => {
            const row = (
              <span className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                    item.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                  aria-hidden
                >
                  {item.done ? <Check className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5" />}
                </span>
                <span
                  className={`text-xs leading-5 ${
                    item.done ? "text-muted-foreground line-through" : "text-foreground"
                  }`}
                >
                  {item.label}
                </span>
              </span>
            );
            return (
              <li key={item.id}>
                {item.to && !item.done ? (
                  <Link to={item.to} className="block rounded-xl px-1 py-1.5 hover:bg-accent">
                    {row}
                  </Link>
                ) : (
                  <div className="px-1 py-1.5">{row}</div>
                )}
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={hideCard}
              className="mt-1 w-full rounded-xl py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              دیگر نمایش داده نشود
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}
