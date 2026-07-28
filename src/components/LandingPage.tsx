/**
 * صفحه‌ی معرفی KAMIX — فقط برای بازدیدکنندگان وب (نه داخل اپلیکیشن).
 * تم آبی/سفید، معرفی برنامه، ویدیو/عکس‌های قابل‌مدیریت از پنل ادمین،
 * و دکمه‌های واضح «ثبت‌نام» و «ورود».
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getPublicSettings } from "@/lib/auth.functions";
import { DEFAULT_PLANS, effectivePrice, isDiscountActive, type PlansConfig, type PlanConfig } from "@/lib/plans";
import { PLAN_LABEL, PLAN_DURATION_LABEL, type SubscriptionPlan } from "@/lib/supabase";
import { formatToman } from "@/lib/store";
import {
  DEFAULT_LANDING,
  loadLandingContent,
  type LandingContent,
} from "@/lib/landing";
import {
  Receipt,
  ScanLine,
  Sparkles,
  ArrowLeft,
  ShieldCheck,
  Smartphone,
  BarChart3,
  Users,
  Package,
  CheckCircle2,
  Check,
  Star,
  Phone,
  Instagram,
  Send,
  MessageCircle,
  Mail,
} from "lucide-react";
import heroBannerUrl from "@/assets/kamix-hero-banner.png";
import supportIconAsset from "@/assets/support-icon.png.asset.json";
import { SmartBusinessGuide } from "@/components/SmartBusinessGuide";
import { StoriesBar } from "@/components/StoriesBar";

const FEATURE_ICONS = [Receipt, ScanLine, Package, BarChart3, Users, ShieldCheck];
const PAID_PLANS: SubscriptionPlan[] = ["1month", "3month", "6month", "12month"];

function formatRemaining(ms: number): string {
  if (ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} روز و ${h} ساعت`;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")} دقیقه`;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function LandingPage() {
  const [content, setContent] = useState<LandingContent>(DEFAULT_LANDING);
  const [plansCfg, setPlansCfg] = useState<PlansConfig>(DEFAULT_PLANS);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    loadLandingContent().then((c) => {
      if (alive) setContent(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    getPublicSettings()
      .then((data) => {
        if (alive) setPlansCfg(data.plans);
      })
      .catch(() => {
        /* پلن‌های پیش‌فرض نمایش داده می‌شوند */
      });
    return () => {
      alive = false;
    };
  }, []);

  // شمارش‌معکوس تخفیف — هر دقیقه به‌روزرسانی می‌شود (نیازی به هر ثانیه نیست، سبک‌تر است)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const c = content.contact || {};
  const socials: Array<{ href: string; label: string; icon: any }> = [];
  if (c.phone) socials.push({ href: `tel:${c.phone.replace(/\s+/g, "")}`, label: c.phone, icon: Phone });
  if (c.whatsapp)
    socials.push({
      href: `https://wa.me/${c.whatsapp.replace(/[^\d]/g, "")}`,
      label: "WhatsApp",
      icon: MessageCircle,
    });
  if (c.telegram)
    socials.push({
      href: c.telegram.startsWith("http")
        ? c.telegram
        : `https://t.me/${c.telegram.replace(/^@/, "")}`,
      label: "Telegram",
      icon: Send,
    });
  if (c.instagram)
    socials.push({
      href: c.instagram.startsWith("http")
        ? c.instagram
        : `https://instagram.com/${c.instagram.replace(/^@/, "")}`,
      label: "Instagram",
      icon: Instagram,
    });
  if (c.email) socials.push({ href: `mailto:${c.email}`, label: c.email, icon: Mail });

  const hasVideos = content.media.filter((m) => m.type === "video").length > 0;
  const visiblePaidPlans = PAID_PLANS.filter((p) => plansCfg[p]?.enabled);
  const hasPricing = visiblePaidPlans.length > 0;
  // پلنی که بیشترین تخفیف فعال را دارد به‌عنوان «پیشنهاد ویژه» برجسته می‌شود؛
  // اگر هیچ تخفیفی فعال نبود، پلن سه‌ماهه (رایج‌ترین انتخاب) پیشنهاد می‌شود.
  const recommendedPlan: SubscriptionPlan | null =
    visiblePaidPlans.length === 0
      ? null
      : visiblePaidPlans.reduce((best, p) => {
          const bd = isDiscountActive(plansCfg[best], now) ? plansCfg[best].discount_percent : 0;
          const pd = isDiscountActive(plansCfg[p], now) ? plansCfg[p].discount_percent : 0;
          return pd > bd ? p : best;
        }, visiblePaidPlans.includes("3month") ? "3month" : visiblePaidPlans[0]);

  const quickLinks = [
    hasPricing && { id: "pricing", label: "قیمت‌ها" },
    hasVideos && { id: "videos", label: "ویدیوهای معرفی" },
    { id: "why-kamix", label: "چرا KAMIX؟" },
    socials.length > 0 && { id: "contact", label: "ارتباط با ما" },
  ].filter(Boolean) as { id: string; label: string }[];

  const supportHref = c.phone
    ? `tel:${c.phone.replace(/\s+/g, "")}`
    : c.whatsapp
      ? `https://wa.me/${c.whatsapp.replace(/[^\d]/g, "")}`
      : null;

  return (
    <div dir="rtl" className="landing-page min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary shadow-elegant">
              <Receipt className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-extrabold tracking-tight kamali-brand">
              {content.brand_name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="rounded-xl px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              ورود
            </Link>
            <Link
              to="/register"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-elegant transition hover:opacity-90"
            >
              ثبت‌نام
            </Link>
          </div>
        </div>
        {quickLinks.length > 0 && (
          <div className="border-t border-primary/15 bg-gradient-to-l from-primary/10 via-primary/5 to-transparent">
            <div className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {quickLinks.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(l.id);
                  }}
                  className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-bold text-primary shadow-sm transition hover:bg-primary hover:text-primary-foreground hover:shadow-elegant"
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Hero banner — edge-to-edge, standard 15:4 ratio, entire image visible */}
      <section className="relative w-full">
        <div className="group relative w-full overflow-hidden border-b border-border/60 bg-primary/10">
          <img
            src={heroBannerUrl}
            alt="KAMIX — اپلیکیشن حسابداری موبایل"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            width={1920}
            height={512}
            className="block w-full h-auto object-contain object-center transition duration-700 group-hover:scale-[1.01]"
          />
        </div>
      </section>

      {/* Stories bar — Instagram-style horizontal reel, admin-managed */}
      <StoriesBar stories={content.stories} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/10 via-background to-background" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -left-24 top-32 h-72 w-72 rounded-full bg-primary-glow/20 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-4 pb-14 pt-14 text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            حسابداری فروشگاهی روی موبایل
          </div>

          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            <span className="kamali-brand">{content.headline}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg font-semibold text-primary sm:text-xl">
            {content.subheadline}
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-8 text-muted-foreground sm:text-base">
            {content.description}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className="flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-primary px-8 py-4 text-base font-extrabold text-primary-foreground shadow-elegant transition hover:opacity-90 sm:w-auto"
            >
              ثبت‌نام و شروع
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <Link
              to="/login"
              className="flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl border border-primary/40 bg-card px-8 py-4 text-base font-bold text-foreground transition hover:bg-accent sm:w-auto"
            >
              قبلاً حساب دارم — ورود
            </Link>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-primary" /> بدون نیاز به کامپیوتر
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-primary" /> اسکن با دوربین موبایل
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-primary" /> پشتیبان‌گیری ابری
            </span>
          </div>

          {/* Download-after-signup notice — visible, no direct link (as requested) */}
          <div className="mx-auto mt-8 flex max-w-xl items-center justify-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm font-semibold text-primary shadow-card">
            <Smartphone className="h-5 w-5 shrink-0" />
            <span>
              پس از ثبت‌نام، لینک دانلود <strong>اپلیکیشن اندروید KAMIX</strong> برای شما نمایش داده می‌شود.
            </span>
          </div>
        </div>
      </section>

      {/* Video introduction — videos only (images are shown as stories above) */}
      {content.media.filter((m) => m.type === "video").length > 0 && (
        <section id="videos" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-10">
          <h2 className="mb-6 text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
            معرفی برنامه در چند ویدیو
          </h2>
          <p className="mx-auto -mt-4 mb-6 max-w-xl text-center text-sm text-muted-foreground">
            کارکرد بخش‌های مختلف برنامه را از نزدیک ببینید.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {content.media.filter((m) => m.type === "video").map((m, i) => (
              <figure
                key={i}
                className="group overflow-hidden rounded-2xl border border-border bg-card shadow-card transition hover:shadow-elegant"
              >
                <video
                    src={m.url}
                    poster={m.coverUrl}
                    muted
                    loop
                    playsInline
                    controls
                    preload="metadata"
                    className="aspect-video w-full bg-black object-cover transition duration-500 group-hover:scale-[1.02]"
                  />
                {m.caption && (
                  <figcaption className="px-4 py-3 text-center text-sm text-muted-foreground">
                    {m.caption}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* Features */}
      <section id="why-kamix" className="mx-auto max-w-5xl scroll-mt-28 px-4 py-10">
        <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
          چرا KAMIX؟
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
          همه‌ی ابزارهای فروشگاه‌داری در یک برنامه‌ی ساده و فارسی.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {content.features.map((f, i) => {
            const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
            return (
              <div
                key={i}
                className="rounded-2xl border border-border bg-card p-3.5 shadow-card transition hover:border-primary/40 hover:shadow-elegant sm:p-5"
              >
                <div className="mb-2.5 grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary sm:mb-3 sm:h-11 sm:w-11">
                  <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
                <div className="text-sm font-bold sm:text-base">{f.title}</div>
                <p className="mt-1 text-xs leading-6 text-muted-foreground sm:mt-1.5 sm:text-sm sm:leading-7">{f.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Smart business guide — persuasive, category-specific breakdown */}
      <SmartBusinessGuide />

      {/* Pricing — کارت‌های «سه‌بعدی»، کلیک روی هرکدام کاربر را به ثبت‌نام می‌برد */}
      {hasPricing && (
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-12">
          <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
            قیمت‌گذاری شفاف، بدون هزینه‌ی پنهان
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
            پلن مناسب فروشگاه خودتان را انتخاب کنید و همین امروز شروع کنید.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-6 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            {visiblePaidPlans.map((p) => (
              <PlanCard key={p} plan={p} cfg={plansCfg[p]} recommended={p === recommendedPlan} now={now} />
            ))}
          </div>
        </section>
      )}

      {/* Bottom CTA */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-primary p-8 text-center text-primary-foreground shadow-elegant sm:p-12">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <Smartphone className="mx-auto mb-4 h-10 w-10 opacity-90" />
          <h3 className="text-2xl font-extrabold sm:text-3xl">همین حالا با KAMIX شروع کنید</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm opacity-90">
            چند ثانیه تا ساخت حساب فاصله دارید. بعد از تکمیل ثبت‌نام، لینک دانلود
            اپلیکیشن اندروید هم برای شما نمایش داده می‌شود.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className="flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-background px-8 py-4 text-base font-extrabold text-primary transition hover:opacity-90 sm:w-auto"
            >
              ثبت‌نام
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <Link
              to="/login"
              className="flex w-full max-w-xs items-center justify-center rounded-2xl border border-primary-foreground/40 px-8 py-4 text-base font-bold text-primary-foreground transition hover:bg-primary-foreground/10 sm:w-auto"
            >
              ورود به حساب
            </Link>
          </div>
        </div>
      </section>

      {/* Contact / Socials */}
      {socials.length > 0 && (
        <section id="contact" className="mx-auto max-w-5xl scroll-mt-28 px-4 pb-14">
          <div className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
            <h3 className="text-center text-xl font-extrabold sm:text-2xl">
              ارتباط با ما
            </h3>
            <p className="mx-auto mt-1 max-w-md text-center text-xs text-muted-foreground sm:text-sm">
              برای مشاوره، خرید یا پشتیبانی از راه‌های زیر با ما در تماس باشید.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              {socials.map((s, i) => {
                const Icon = s.icon;
                return (
                  <a
                    key={i}
                    href={s.href}
                    target={s.href.startsWith("http") ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    dir="ltr"
                    className="inline-flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
                  >
                    <Icon className="h-4 w-4" />
                    <span className="truncate max-w-[160px]">{s.label}</span>
                  </a>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Active users — نمادین/تبلیغاتی، برای نمایش اعتماد اجتماعی در ابتدای راه */}
      <section className="mx-auto max-w-5xl px-4 pb-10">
        <ActiveUsersBadge />
      </section>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} KAMIX — همه‌ی حقوق محفوظ است.
      </footer>

      {/* دکمه‌ی شناور پشتیبانی — آیکون 3D تماس مستقیم با تلفن */}
      {supportHref && (
        <a
          href={supportHref}
          target={supportHref.startsWith("http") ? "_blank" : undefined}
          rel={supportHref.startsWith("http") ? "noopener noreferrer" : undefined}
          aria-label="پشتیبانی رایگان"
          title="پشتیبانی رایگان"
          className="fixed bottom-4 left-4 z-40 h-14 w-14 overflow-hidden rounded-full shadow-elegant transition-all duration-300 hover:scale-110 hover:shadow-2xl active:scale-95 sm:bottom-5 sm:left-5"
        >
          <img
            src={supportIconAsset.url}
            alt="پشتیبانی رایگان"
            className="h-full w-full object-cover"
            loading="eager"
          />
        </a>
      )}
    </div>
  );
}

/**
 * کارت هر پلن اشتراک — با افکت «بلندشدن + سایه‌ی سه‌بعدی» روی هاور، و برجسته‌سازی
 * پلن پیشنهادی با نوار «پیشنهاد ویژه». کلیک روی هر جای کارت کاربر را به صفحه‌ی
 * ثبت‌نام می‌برد.
 */
function PlanCard({
  plan, cfg, recommended, now,
}: {
  plan: SubscriptionPlan;
  cfg: PlanConfig;
  recommended: boolean;
  now: number;
}) {
  const discounted = isDiscountActive(cfg, now);
  const final = effectivePrice(cfg, now);
  const remainingMs = cfg.discount_until ? new Date(cfg.discount_until).getTime() - now : Infinity;
  const perks = [
    "ثبت فاکتور نامحدود",
    "ثبت فاکتور با صدا 🎙️",
    "اسکن کالا با دوربین موبایل",
    "ساخت سایت تک‌صفحه‌ای فروشگاه",
    "مدیریت انبار و محصولات",
    "گزارش‌های فروش و سود",
    "پشتیبانی رایگان",
  ];

  return (
    <Link
      to="/register"
      className={`group relative flex flex-col rounded-3xl border p-6 pt-8 text-center shadow-card transition-all duration-300 hover:-translate-y-3 hover:shadow-2xl ${
        recommended
          ? "z-10 border-primary bg-gradient-primary text-primary-foreground shadow-elegant sm:scale-105"
          : "border-border bg-card"
      }`}
    >
      {recommended && (
        <span className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-extrabold text-amber-950 shadow">
          <Star className="h-3 w-3 fill-amber-950" />
          پیشنهاد ویژه
        </span>
      )}
      {discounted && (
        <span className="absolute -top-3 -right-3 rounded-full bg-rose-500 px-2 py-1 text-[11px] font-extrabold text-white shadow">
          {cfg.discount_percent.toLocaleString("fa-IR")}٪ تخفیف
        </span>
      )}

      <div className="text-lg font-extrabold">{PLAN_LABEL[plan]}</div>
      <div className={`mt-1 text-xs ${recommended ? "opacity-90" : "text-muted-foreground"}`}>
        {PLAN_DURATION_LABEL[plan]} اعتبار
      </div>

      <div className="my-5">
        {discounted && (
          <div className={`text-xs line-through ${recommended ? "opacity-70" : "text-muted-foreground"}`}>
            {formatToman(cfg.price)}
          </div>
        )}
        <div className="text-2xl font-black">{formatToman(final)}</div>
        {discounted && isFinite(remainingMs) && remainingMs > 0 && (
          <div dir="ltr" className={`mt-1 text-[10px] ${recommended ? "opacity-80" : "text-rose-600"}`}>
            ⏳ {formatRemaining(remainingMs)} تا پایان تخفیف
          </div>
        )}
      </div>

      <ul className="mb-6 flex-1 space-y-2 text-right text-xs">
        {perks.map((perk) => (
          <li key={perk} className="flex items-center gap-2">
            <Check className={`h-3.5 w-3.5 shrink-0 ${recommended ? "" : "text-primary"}`} />
            <span>{perk}</span>
          </li>
        ))}
      </ul>

      <span
        className={`mt-auto flex items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-bold transition ${
          recommended
            ? "bg-background text-primary group-hover:opacity-90"
            : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
        }`}
      >
        شروع کنید
        <ArrowLeft className="h-4 w-4" />
      </span>
    </Link>
  );
}

/**
 * نشان «کاربران فعال» — کاملاً نمادین و برای تبلیغات است (نه آمار واقعی).
 * وقتی صفحه باز می‌شود عدد از صفر با یک انیمیشن جذاب تا حدود ۵۰۰۰ نفر بالا
 * می‌رود، سپس هر از گاهی کمی بیشتر می‌شود تا حس زنده و پویا بودن سایت را
 * منتقل کند.
 */
function ActiveUsersBadge() {
  const targetCount = useMemo(() => {
    // بر اساس روز جاری یک عدد پایه‌ی ثابت (نه کاملاً تصادفی روی هر رفرش) بین
    // ۵۰۰۰ تا ۵۹۰۰ می‌سازد تا در طول یک روز عدد پایدار بماند.
    const day = Math.floor(Date.now() / 86_400_000);
    const seeded = ((day * 9301 + 49297) % 233280) / 233280;
    return 5000 + Math.floor(seeded * 900);
  }, []);
  const [count, setCount] = useState(0);
  const [countUpDone, setCountUpDone] = useState(false);

  // شمارش جذاب از صفر تا عدد هدف هنگام ورود به صفحه
  useEffect(() => {
    let frameId: number;
    const duration = 1800;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out
      setCount(Math.floor(eased * targetCount));
      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      } else {
        setCountUpDone(true);
      }
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [targetCount]);

  // بعد از پایان انیمیشن ورودی، هر از گاهی کمی عدد را بالا می‌برد
  useEffect(() => {
    if (!countUpDone) return;
    const tick = () => {
      setCount((c) => {
        const next = c + Math.floor(Math.random() * 14) + 1;
        return next > 6000 ? 5000 + Math.floor(Math.random() * 300) : next;
      });
    };
    const id = setInterval(tick, 9000 + Math.random() * 9000);
    return () => clearInterval(id);
  }, [countUpDone]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="inline-flex items-center gap-2.5 rounded-full border border-primary/20 bg-primary/5 px-5 py-2.5 shadow-card">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <Users className="h-4 w-4 text-primary" />
        <span className="text-sm font-extrabold tabular-nums text-foreground">
          {count.toLocaleString("fa-IR")}
        </span>
        <span className="text-xs text-muted-foreground">کاربر فعال KAMIX</span>
      </div>
    </div>
  );
}
