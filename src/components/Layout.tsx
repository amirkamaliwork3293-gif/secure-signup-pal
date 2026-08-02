import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/AuthContext";
import { ScanLine, Package, Receipt, History, Settings, LogOut, BarChart3, Users, WifiOff, UtensilsCrossed, GraduationCap, ListChecks, Wallet, Coins, Bell, LayoutGrid, LayoutTemplate, Boxes, X } from "lucide-react";
import type { ReactNode } from "react";
import { settings, students as studentsStore, studentStatus, reminders as remindersStore, dueReminderCount } from "@/lib/store";
import { GlobalSearch } from "@/components/GlobalSearch";
import { UserMenu } from "@/components/UserMenu";
import { useState, useEffect } from "react";

const nav = [
  { to: "/",          label: "فاکتور",   icon: Receipt,  settingKey: null },
  { to: "/invoices",  label: "فاکتورها", icon: ListChecks, settingKey: null },
  { to: "/scan",      label: "اسکن",     icon: ScanLine, settingKey: null },
  { to: "/products",  label: "محصولات",  icon: Package,  settingKey: null },
  { to: "/inventory", label: "انبار",    icon: Boxes,    settingKey: null },
  { to: "/menu",      label: "منو",      icon: UtensilsCrossed, settingKey: "showMenuFeature" },
  { to: "/customers", label: "مشتریان",  icon: Users,    settingKey: null },
  { to: "/expenses",  label: "هزینه‌ها", icon: Wallet,   settingKey: null },
  { to: "/reminders", label: "یادآوری",  icon: Bell,     settingKey: "showRemindersFeature" },
  { to: "/students",  label: "هنرجویان", icon: GraduationCap, settingKey: "showStudentsFeature" },
  { to: "/gold",      label: "طلا",      icon: Coins,    settingKey: "showGoldFeature" },
  { to: "/history",   label: "تاریخچه",  icon: History,  settingKey: null },
  { to: "/reports",   label: "گزارش",    icon: BarChart3, settingKey: null },
  { to: "/invoice-design", label: "طراح فاکتور", icon: LayoutTemplate, settingKey: null },
  { to: "/settings",  label: "تنظیمات",  icon: Settings, settingKey: null },
] as const;

/** فقط پرکاربردترین بخش‌ها همیشه در نوار پایین دیده می‌شوند؛ بقیه داخل «بیشتر». */
const PRIMARY_PATHS = ["/", "/products", "/invoices", "/customers"] as const;

export function Layout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [appSettings] = settings.useAll();
  const shopName = appSettings.shopName || "کمالی";
  const visibleNav = nav.filter((item) => {
    if (item.settingKey === null) return true;
    // «یادآوری‌ها» به‌صورت پیش‌فرض فعال است — فقط با غیرفعال‌سازی صریح در تنظیمات پنهان می‌شود
    if (item.settingKey === "showRemindersFeature") return appSettings.showRemindersFeature !== false;
    return !!appSettings[item.settingKey];
  });
  const { state, signOut } = useAuth();
  const [studentsList] = studentsStore.useAll();
  const [remindersList] = remindersStore.useAll();
  const studentsDueCount = studentsList.filter((s) => {
    const st = studentStatus(s);
    return st === "overdue" || st === "due-today";
  }).length;
  const remindersDueCount = dueReminderCount(remindersList);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  return (
    <div
      className="min-h-[100svh] bg-background"
      style={{ paddingBottom: "calc(7rem + var(--safe-bottom))" }}
    >
      <header className="pt-safe sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant">
              <Receipt className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-base font-bold kamali-brand">{shopName}</div>
              <div className="text-[11px] text-muted-foreground">KAMIX</div>
            </div>
          </Link>
          </div>
          <div className="flex items-center gap-1.5">
            <GlobalSearch />
            <UserMenu />
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
        <div
          className="sticky z-20 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-xs font-semibold text-white"
          style={{ top: "calc(57px + var(--safe-top))" }}
        >
          <WifiOff className="h-3.5 w-3.5" />
          آفلاین — داده‌ها روی دستگاه ذخیره می‌شوند و پس از اتصال همگام‌سازی خواهند شد
        </div>
      )}

      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>

      {(() => {
        const badgeFor = (to: string) =>
          to === "/students" ? studentsDueCount : to === "/reminders" ? remindersDueCount : 0;
        const primary = visibleNav.filter((i) => (PRIMARY_PATHS as readonly string[]).includes(i.to));
        const overflow = visibleNav.filter((i) => !(PRIMARY_PATHS as readonly string[]).includes(i.to));
        const overflowBadge = overflow.reduce((s, i) => s + badgeFor(i.to), 0);
        const overflowActive = overflow.some((i) => i.to === pathname);
        return (
          <>
            {/* شیت «بیشتر» — بقیه‌ی بخش‌ها بدون شلوغ کردن نوار پایین */}
            {moreOpen && (
              <div
                className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-[2px]"
                onClick={() => setMoreOpen(false)}
              >
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-border bg-card p-4 shadow-elegant"
                  style={{ paddingBottom: "calc(6.5rem + var(--safe-bottom))" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-bold">بخش‌های دیگر</h2>
                    <button
                      onClick={() => setMoreOpen(false)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
                      aria-label="بستن"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mx-auto grid max-w-3xl grid-cols-4 gap-2">
                    {overflow.map(({ to, label, icon: Icon }) => {
                      const active = pathname === to;
                      const badgeCount = badgeFor(to);
                      return (
                        <Link
                          key={to}
                          to={to}
                          onClick={() => setMoreOpen(false)}
                          className={`relative flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-[11px] transition ${
                            active
                              ? "border-primary bg-primary/10 font-semibold text-primary"
                              : "border-border bg-background text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          <Icon className="h-5 w-5" />
                          <span className="truncate">{label}</span>
                          {badgeCount > 0 && (
                            <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                              {badgeCount}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur">
              <div
                className="mx-auto grid max-w-3xl grid-cols-5"
                style={{ paddingLeft: "var(--safe-left)", paddingRight: "var(--safe-right)" }}
              >
                {primary.map(({ to, label, icon: Icon }) => {
                  const active = pathname === to;
                  return (
                    <Link
                      key={to}
                      to={to}
                      className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors ${
                        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className={`h-5 w-5 ${active ? "scale-110" : ""} transition-transform`} />
                      <span className={active ? "font-semibold" : ""}>{label}</span>
                    </Link>
                  );
                })}
                <button
                  onClick={() => setMoreOpen((v) => !v)}
                  className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors ${
                    moreOpen || overflowActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label="بخش‌های بیشتر"
                >
                  <LayoutGrid className={`h-5 w-5 ${moreOpen || overflowActive ? "scale-110" : ""} transition-transform`} />
                  <span className={moreOpen || overflowActive ? "font-semibold" : ""}>بیشتر</span>
                  {overflowBadge > 0 && (
                    <span className="absolute right-2 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                      {overflowBadge}
                    </span>
                  )}
                </button>
              </div>
            </nav>
          </>
        );
      })()}
    </div>
  );
}
