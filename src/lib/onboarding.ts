import {
  invoice,
  isCloudHydrated,
  products,
  settings,
  type AppSettings,
} from "@/lib/store";

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
