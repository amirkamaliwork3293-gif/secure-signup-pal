import { invoice, isCloudHydrated, products, settings, type AppSettings } from "@/lib/store";
import { isWebView } from "@/lib/isWebView";

/**
 * تور فقط برای حساب‌هایی که از این تاریخ به بعد ساخته شده‌اند.
 * کاربران قدیمی — حتی بدون محصول/فاکتور — مشمول نیستند.
 */
export const ONBOARDING_LAUNCH_AT = Date.parse("2026-08-16T00:00:00+03:30");

const PENDING_SIGNUP_KEY = "kamix.onboarding.pendingUsername";

export function markPendingOnboarding(username: string) {
  if (typeof window === "undefined") return;
  const u = username.trim().toLowerCase();
  if (!u) return;
  try {
    localStorage.setItem(PENDING_SIGNUP_KEY, u);
  } catch {
    /* نادیده */
  }
}

function readPendingOnboarding(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(PENDING_SIGNUP_KEY);
  } catch {
    return null;
  }
}

function clearPendingOnboarding() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PENDING_SIGNUP_KEY);
  } catch {
    /* نادیده */
  }
}

/** شناسه‌ی سه مرحله‌ی تور (هر کدام روی صفحه‌ی خودش) */
export const TOUR_STAGES = ["invoice", "products", "history"] as const;
export type TourStageId = (typeof TOUR_STAGES)[number];

export const TOUR_STAGE_COUNT = TOUR_STAGES.length;

export function patchSettings(patch: Partial<AppSettings>) {
  settings.save({ ...settings.get(), ...patch });
}

export function hasExistingShopData(): boolean {
  return products.getAll().length > 0 || invoice.getHistory().length > 0;
}

type EligibilityProfile = { username?: string | null; created_at?: string | null };

/**
 * تصمیم قطعی: تور خودکار فقط برای ثبت‌نام جدید از الان.
 * نتیجه در settings ذخیره می‌شود تا با رفرش/ورود دوباره عوض نشود.
 */
export function resolveOnboardingEligibility(profile?: EligibilityProfile | null): boolean {
  const s = settings.get();
  if (s.onboardingEligible === true) return true;
  if (s.onboardingEligible === false) return false;
  // قبل از خواندن ابر تصمیم نگیر — کاربر قدیمی روی دستگاه جدید دادهٔ خالی محلی دارد
  if (!isCloudHydrated()) return false;
  if (!profile?.created_at && !profile?.username) return false;

  const username = (profile.username || "").trim().toLowerCase();
  const pending = readPendingOnboarding();
  const fromThisSignup = !!username && pending === username;
  const created = Date.parse(profile.created_at || "");
  const newAccount = Number.isFinite(created) && created >= ONBOARDING_LAUNCH_AT;
  const eligible = (fromThisSignup || newAccount) && !hasExistingShopData();

  if (fromThisSignup) clearPendingOnboarding();

  patchSettings({
    onboardingEligible: eligible,
    ...(eligible ? {} : { onboardingDismissed: true }),
  });
  return eligible;
}

export function isOnboardingEligible(): boolean {
  return settings.get().onboardingEligible === true;
}

/**
 * پنجره‌ی دانلود اپ فقط برای تازه‌ثبت‌نام‌ها، فقط در سایت (نه داخل اپ)،
 * و فقط قبل از شروع/اتمام آموزش — تا کاربران قدیمی هرگز نبینند.
 */
export function shouldShowApkWelcome(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (isWebView()) return false;
    const s = settings.get();
    if (s.onboardingEligible !== true) return false;
    if (s.apkWelcomeDismissed === true) return false;
    if (s.onboardingDismissed === true) return false;
    const completed = s.onboardingCompletedSteps ?? [];
    if (completed.length > 0) return false;
    if ((s.onboardingStep ?? 0) > 1) return false;
    return true;
  } catch {
    return false;
  }
}

export function dismissApkWelcome() {
  patchSettings({ apkWelcomeDismissed: true });
}

export function isShopSetupDone(s: AppSettings): boolean {
  const name = (s.shopName || "").trim();
  return (!!name && name !== "فروشگاه من") || !!s.logoUrl;
}

export function checklistHidden(s: AppSettings): boolean {
  return (s.onboardingCompletedSteps ?? []).includes("checklist");
}

export function markChecklistHidden() {
  const s = settings.get();
  const steps = s.onboardingCompletedSteps ?? [];
  if (steps.includes("checklist")) return;
  patchSettings({ onboardingCompletedSteps: [...steps, "checklist"] });
}

export function markAssistantOpened() {
  const s = settings.get();
  if (s.assistantOpened) return;
  patchSettings({ assistantOpened: true });
}

export function stageForPath(pathname: string): TourStageId {
  if (pathname === "/products" || pathname === "/voice-products" || pathname === "/quick-add") {
    return "products";
  }
  if (pathname === "/history" || pathname === "/invoices") return "history";
  return "invoice";
}

/** صفحه‌ای که تور آن مرحله باید رویش دیده شود (نه صفحات جانبی مثل تنظیمات) */
export function isTourPage(pathname: string): boolean {
  return pathname === "/" || pathname === "/products" || pathname === "/history";
}

export function stageIndex(id: TourStageId): number {
  return TOUR_STAGES.indexOf(id);
}

/** صبر تا hydrate ابری تمام شود تا کاربر قدیمی به‌اشتباه تور نگیرد */
export function waitForStoreHydration(timeoutMs = 2000): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (isCloudHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("store-hydrated", finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    window.addEventListener("store-hydrated", finish);
  });
}
