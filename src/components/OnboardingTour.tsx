/**
 * تور تعاملی شروع کار — spotlight روی عناصر واقعی صفحه.
 * هیچ منطق مالی/فرمی را تغییر نمی‌دهد؛ فقط یک لایه‌ی راهنما روی UI موجود است.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { formatNumber, settings } from "@/lib/store";
import { useAuth } from "@/lib/AuthContext";
import {
  patchSettings,
  resolveOnboardingEligibility,
  stageForPath,
  stageIndex,
  TOUR_STAGE_COUNT,
  TOUR_STAGES,
  waitForStoreHydration,
  isTourPage,
  shouldShowApkWelcome,
  type TourStageId,
} from "@/lib/onboarding";

type Highlight = {
  id: string;
  selector: string;
  /** اگر عنصر اصلی نبود، این انتخابگرها به‌ترتیب امتحان می‌شوند */
  fallback?: string[];
  title: string;
  body: string;
};

const STAGE_HIGHLIGHTS: Record<TourStageId, Highlight[]> = {
  invoice: [
    {
      id: "invoice-intro",
      selector: "[data-tour='invoice-intro']",
      title: "صفحه‌ی فاکتور",
      body: "اینجا فاکتور فروش می‌سازید. کالا را اضافه کنید، روش پرداخت را بزنید و ثبت کنید.",
    },
    {
      id: "invoice-scan",
      selector: "[data-tour='invoice-scan']",
      title: "اسکن بارکد",
      body: "با دوربین گوشی بارکد کالا را اسکن کنید تا خودکار به فاکتور اضافه شود.",
    },
    {
      id: "invoice-voice",
      selector: "[data-tour='invoice-voice']",
      title: "ثبت صوتی فاکتور",
      body: "یا با صدا بگویید چی می‌فروشید، مثلاً بگویید ۲ تا نون، خودش به فاکتور اضافه می‌شود.",
    },
    {
      id: "smart-assistant",
      selector: "[data-tour='smart-assistant']",
      title: "دستیار هوشمند",
      body: "این دستیار هوشمند است؛ می‌توانید باهاش بدهی مشتری ثبت کنید، هزینه بنویسید، قیمت عوض کنید یا سؤال بپرسید مثل پرسودترین کالای من چیه.",
    },
  ],
  products: [
    {
      id: "product-add",
      selector: "[data-tour='product-add']",
      title: "افزودن محصول",
      body: "از اینجا محصول را دستی ثبت کنید: نام، قیمت، موجودی و دسته‌بندی.",
    },
    {
      id: "product-voice",
      selector: "[data-tour='product-voice']",
      title: "افزودن صوتی",
      body: "یا با صدا بگویید تیشرت مشکی قیمت ۴۵ هزار تومان، خودش اضافه می‌شود.",
    },
    {
      id: "product-barcode",
      selector: "[data-tour='product-barcode']",
      fallback: ["[data-tour='product-add']"],
      title: "ساخت بارکد",
      body: "از اینجا برای هر محصول بارکد بسازید و چاپ کنید.",
    },
  ],
  history: [
    {
      id: "history-intro",
      selector: "[data-tour='history-edit']",
      fallback: ["[data-tour='history-intro']"],
      title: "تاریخچه‌ی فاکتورها",
      body: "اینجا تاریخچه‌ی همه‌ی فاکتورهای ثبت‌شده است؛ روی هرکدام بزنید تا جزئیاتش را ببینید، و با آیکن ویرایش می‌توانید ردیف‌های فاکتور را بعد از ثبت هم اصلاح کنید.",
    },
  ],
};

const PAD = 8;
const CARD_GAP = 12;
const VIEW_PAD = 12;

type Rect = { top: number; left: number; width: number; height: number; bottom: number; right: number };

function queryTarget(h: Highlight): Element | null {
  const found = document.querySelector(h.selector);
  if (found) return found;
  for (const sel of h.fallback ?? []) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function readRect(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 && r.height < 2) return null;
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    bottom: r.bottom,
    right: r.right,
  };
}

function clampCard(rect: Rect | null, cardW: number, cardH: number) {
  const vw = typeof window === "undefined" ? 360 : window.innerWidth;
  const vh = typeof window === "undefined" ? 640 : window.innerHeight;
  const width = Math.min(cardW, vw - VIEW_PAD * 2);
  if (!rect) {
    return {
      top: Math.max(VIEW_PAD, (vh - cardH) / 2),
      left: Math.max(VIEW_PAD, (vw - width) / 2),
      width,
      placement: "center" as const,
      arrowLeft: width / 2,
    };
  }
  const below = rect.bottom + CARD_GAP;
  const above = rect.top - CARD_GAP - cardH;
  const placement: "below" | "above" =
    below + cardH <= vh - VIEW_PAD || above < VIEW_PAD ? "below" : "above";
  let top = placement === "below" ? below : above;
  top = Math.max(VIEW_PAD, Math.min(top, vh - cardH - VIEW_PAD));
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(VIEW_PAD, Math.min(left, vw - width - VIEW_PAD));
  const arrowLeft = Math.max(18, Math.min(rect.left + rect.width / 2 - left, width - 18));
  return { top, left, width, placement, arrowLeft };
}

export function OnboardingTour({ replayNonce = 0 }: { replayNonce?: number }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { state: authState } = useAuth();
  const [appSettings] = settings.useAll();
  const [active, setActive] = useState(false);
  const [replay, setReplay] = useState(false);
  const [stage, setStage] = useState<TourStageId>("invoice");
  const [sub, setSub] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ w: 320, h: 200 });
  const cardRef = useRef<HTMLDivElement>(null);
  const lastReplay = useRef(0);
  const replayRef = useRef(false);
  const resumeStageRef = useRef<TourStageId | null>(null);
  const dismissed = !!appSettings.onboardingDismissed;
  const completed = appSettings.onboardingCompletedSteps ?? [];
  const started = (appSettings.onboardingStep ?? 0) > 0;
  replayRef.current = replay;

  const highlights = STAGE_HIGHLIGHTS[stage];
  const highlight = highlights[Math.min(sub, highlights.length - 1)];
  const stageNo = stageIndex(stage) + 1;

  const dismissForever = () => {
    patchSettings({ onboardingDismissed: true });
    setActive(false);
    setReplay(false);
  };

  const completeStage = (id: TourStageId) => {
    const s = settings.get();
    const steps = s.onboardingCompletedSteps ?? [];
    const nextSteps = steps.includes(id) ? steps : [...steps, id];
    const nextIdx = stageIndex(id) + 1;
    patchSettings({
      onboardingCompletedSteps: nextSteps,
      onboardingStep: Math.max(s.onboardingStep ?? 0, nextIdx + 1),
    });
  };

  const closeReplay = () => {
    setActive(false);
    setReplay(false);
  };

  const goNext = () => {
    if (sub < highlights.length - 1) {
      setSub((n) => n + 1);
      return;
    }
    if (replay) {
      closeReplay();
      return;
    }
    completeStage(stage);
    const nextId = TOUR_STAGES[stageIndex(stage) + 1];
    if (!nextId) {
      setActive(false);
      return;
    }
    // مرحله‌ی بعد روی صفحه‌ی دیگری است — وقتی کاربر خودش رفت، نشان داده می‌شود
    setActive(false);
  };

  const goBack = () => {
    if (sub > 0) {
      setSub((n) => n - 1);
      return;
    }
    const prevId = TOUR_STAGES[stageIndex(stage) - 1];
    if (!prevId) return;
    const prevPath = prevId === "invoice" ? "/" : prevId === "products" ? "/products" : "/history";
    resumeStageRef.current = prevId;
    setStage(prevId);
    setSub(STAGE_HIGHLIGHTS[prevId].length - 1);
    setActive(true);
    if (pathname !== prevPath) {
      void navigate({ to: prevPath });
    }
  };

  // شروع خودکار فقط برای کاربر تازه‌ثبت‌نام (بدون محصول/فاکتور)
  useEffect(() => {
    let cancelled = false;
    if (replayRef.current) return;
    void (async () => {
      await waitForStoreHydration();
      if (cancelled) return;
      const resume = resumeStageRef.current;
      if (resume) {
        resumeStageRef.current = null;
        setStage(resume);
        setSub(STAGE_HIGHLIGHTS[resume].length - 1);
        setActive(true);
        return;
      }
      const profile = authState.status === "authenticated" ? authState.profile : null;
      let eligible = false;
      try {
        eligible = resolveOnboardingEligibility(profile);
      } catch {
        setActive(false);
        return;
      }
      const s = settings.get();
      if (!eligible || s.onboardingDismissed) {
        setActive(false);
        return;
      }
      // تا وقتی پنجره‌ی دانلود اپ باز است، تور را شروع نکن
      if (shouldShowApkWelcome()) {
        setActive(false);
        return;
      }
      if (!isTourPage(pathname)) {
        setActive(false);
        return;
      }
      const pageStage = stageForPath(pathname);
      if ((s.onboardingCompletedSteps ?? []).includes(pageStage)) {
        setActive(false);
        return;
      }
      if ((s.onboardingStep ?? 0) <= 0) {
        patchSettings({ onboardingStep: 1 });
      }
      setReplay(false);
      setStage(pageStage);
      setSub(0);
      setActive(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    pathname,
    dismissed,
    started,
    completed.join("|"),
    authState.status,
    appSettings.apkWelcomeDismissed,
    appSettings.onboardingEligible,
  ]);

  // بازپخش از آیکن «؟» — مرحله‌ی همین صفحه، حتی اگر قبلاً رد شده باشد
  useEffect(() => {
    if (replayNonce === 0 || replayNonce === lastReplay.current) return;
    lastReplay.current = replayNonce;
    const pageStage = stageForPath(pathname);
    setReplay(true);
    setStage(pageStage);
    setSub(0);
    setActive(true);
  }, [replayNonce, pathname]);

  const measure = useCallback(() => {
    if (!active || !highlight) {
      setRect(null);
      return;
    }
    const el = queryTarget(highlight);
    if (el instanceof HTMLElement) {
      const hidden = el.offsetParent === null && getComputedStyle(el).position !== "fixed";
      if (!hidden) {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }
    }
    window.setTimeout(() => {
      setRect(readRect(queryTarget(highlight)));
    }, 280);
  }, [active, highlight]);

  useLayoutEffect(() => {
    if (!active) return;
    measure();
    const on = () => setRect(readRect(queryTarget(highlight)));
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [active, highlight, measure]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const r = card.getBoundingClientRect();
    if (Math.abs(r.width - cardSize.w) > 2 || Math.abs(r.height - cardSize.h) > 2) {
      setCardSize({ w: r.width, h: r.height });
    }
  }, [active, highlight, rect, cardSize.w, cardSize.h]);

  if (!active || !highlight) return null;

  const vw = typeof window === "undefined" ? 360 : window.innerWidth;
  const vh = typeof window === "undefined" ? 640 : window.innerHeight;
  const hole = rect
    ? {
        top: Math.max(0, rect.top - PAD),
        left: Math.max(0, rect.left - PAD),
        right: Math.min(vw, rect.right + PAD),
        bottom: Math.min(vh, rect.bottom + PAD),
        width: Math.min(vw, rect.right + PAD) - Math.max(0, rect.left - PAD),
        height: Math.min(vh, rect.bottom + PAD) - Math.max(0, rect.top - PAD),
      }
    : null;

  const pos = clampCard(hole, cardSize.w, cardSize.h);
  const isFirst = sub === 0 && stageIndex(stage) === 0;
  const nextLabel =
    sub < highlights.length - 1 ? "بعدی" : stageIndex(stage) < TOUR_STAGE_COUNT - 1 ? "بعدی" : "پایان";

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" dir="rtl" role="dialog" aria-modal="true" aria-label="راهنمای شروع کار">
      {hole ? (
        <>
          <div className="pointer-events-auto fixed bg-foreground/55" style={{ top: 0, left: 0, right: 0, height: hole.top }} />
          <div className="pointer-events-auto fixed bg-foreground/55" style={{ top: hole.bottom, left: 0, right: 0, bottom: 0 }} />
          <div className="pointer-events-auto fixed bg-foreground/55" style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }} />
          <div className="pointer-events-auto fixed bg-foreground/55" style={{ top: hole.top, left: hole.right, right: 0, height: hole.height }} />
          <div
            className="pointer-events-none fixed rounded-xl ring-2 ring-primary shadow-elegant"
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          />
        </>
      ) : (
        <div className="pointer-events-auto fixed inset-0 bg-foreground/55" />
      )}

      <div
        ref={cardRef}
        className="pointer-events-auto fixed z-[61] max-h-[min(70svh,28rem)] overflow-y-auto rounded-2xl border border-border bg-card p-3.5 text-card-foreground shadow-elegant"
        style={{ top: pos.top, left: pos.left, width: pos.width, maxWidth: "calc(100vw - 24px)" }}
      >
        {pos.placement !== "center" && hole && (
          <span
            className={`pointer-events-none absolute h-2.5 w-2.5 rotate-45 border-border bg-card ${
              pos.placement === "below" ? "-top-1.5 border-r border-t" : "-bottom-1.5 border-b border-l"
            }`}
            style={{ left: pos.arrowLeft, transform: "translateX(-50%) rotate(45deg)" }}
          />
        )}

        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            {formatNumber(stageNo)} از {formatNumber(TOUR_STAGE_COUNT)}
          </span>
          <button
            type="button"
            onClick={replay ? closeReplay : dismissForever}
            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
            aria-label="بستن"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <h3 className="text-sm font-bold">{highlight.title}</h3>
        <p className="mt-1 text-xs leading-6 text-muted-foreground">{highlight.body}</p>

        {sub === highlights.length - 1 && stageIndex(stage) < TOUR_STAGE_COUNT - 1 && !replay && (
          <p className="mt-2 text-[11px] leading-5 text-primary">
            {stage === "invoice"
              ? "برای ادامه‌ی آموزش، از نوار پایین وارد «محصولات» شوید."
              : "برای ادامه‌ی آموزش، از بخش «بیشتر» وارد «تاریخچه» شوید."}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goNext}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
          >
            {nextLabel}
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={goBack}
            disabled={isFirst}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            قبلی
          </button>
        </div>

        {!replay && (
          <button
            type="button"
            onClick={dismissForever}
            className="mt-2 w-full py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            رد کردن آموزش
          </button>
        )}
      </div>
    </div>
  );
}
