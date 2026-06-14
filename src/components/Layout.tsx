import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/AuthContext";
import { ScanLine, Package, Receipt, History, Settings, LogOut, BarChart3, Users, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { settings } from "@/lib/store";
import { GlobalSearch } from "@/components/GlobalSearch";
import { useState, useEffect } from "react";

const nav = [
  { to: "/",          label: "فاکتور",   icon: Receipt  },
  { to: "/scan",      label: "اسکن",     icon: ScanLine },
  { to: "/products",  label: "محصولات",  icon: Package  },
  { to: "/customers", label: "مشتریان",  icon: Users    },
  { to: "/history",   label: "تاریخچه",  icon: History  },
  { to: "/reports",   label: "گزارش",    icon: BarChart3 },
  { to: "/settings",  label: "تنظیمات",  icon: Settings },
] as const;

export function Layout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [appSettings] = settings.useAll();
  const shopName = appSettings.shopName || "کمالی";
  const { state, signOut } = useAuth();
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant">
              <Receipt className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-base font-bold kamali-brand">{shopName}</div>
              <div className="text-[11px] text-muted-foreground">کمالی حسابداری</div>
            </div>
          </Link>
          </div>
          <div className="flex items-center gap-1.5">
            <GlobalSearch />
            {state.status === "authenticated" && state.isAdmin && (
              <Link
                to="/admin"
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                پنل ادمین
              </Link>
            )}
            {state.status === "authenticated" && (
              <button
                onClick={signOut}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
                title="خروج"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="sticky top-[57px] z-20 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-xs font-semibold text-white">
          <WifiOff className="h-3.5 w-3.5" />
          آفلاین — داده‌ها روی دستگاه ذخیره می‌شوند و پس از اتصال همگام‌سازی خواهند شد
        </div>
      )}

      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>

      {/* pb-safe: فاصله امن برای نوار ژست اندروید/آیفون در نسخه APK */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="mx-auto grid max-w-3xl grid-cols-7">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex flex-col items-center gap-1 py-2 text-[10px] transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "scale-110" : ""} transition-transform`} />
                <span className={`whitespace-nowrap ${active ? "font-semibold" : ""}`}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
