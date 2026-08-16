/**
 * صفحه‌ی معرفی KAMIX — فقط برای بازدیدکنندگان وب (نه داخل اپلیکیشن).
 * هویت بصری: پیشخوان مغازهٔ ایرانی (دفتر خط‌دار، فاکتور کاغذی، مهر ثبت)
 * با رنگ primary موجود. عنصر امضادار: دموی زنده‌نمای «فاکتور با صدا».
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
  videoEmbedUrl,
  type LandingContent,
} from "@/lib/landing";
import {
  Receipt,
  ScanLine,
  ArrowLeft,
  ShieldCheck,
  Smartphone,
  BarChart3,
  Users,
  Package,
  CheckCircle2,
  Check,
  Phone,
  Instagram,
  Send,
  MessageCircle,
  Mail,
  Mic,
  type LucideIcon,
} from "lucide-react";
import { LiveFeatureShowcase } from "@/components/LiveFeatureShowcase";
import { StoriesBar } from "@/components/StoriesBar";

const FEATURE_ICONS = [Receipt, ScanLine, Package, BarChart3, Users, ShieldCheck];
const PAID_PLANS: SubscriptionPlan[] = ["1month", "3month", "6month", "12month"];

const INVOICE_DEMO = [
  { spoken: "۲ عدد پیراهن ۲۵۰ هزار تومان", name: "پیراهن مردانه", qty: "۲", amount: 250_000 },
  { spoken: "یک شلوار جین ۴۲۰ هزار", name: "شلوار جین", qty: "۱", amount: 420_000 },
  { spoken: "۳ تا جوراب ۶۰ هزار", name: "جوراب نخی", qty: "۳", amount: 60_000 },
] as const;

const BARCODE_BARS = [10, 22, 14, 26, 12, 24, 18, 11, 26, 15, 22, 10, 25, 13, 20, 26, 12, 18, 24, 11, 22, 16, 26, 10, 20, 14, 24, 12, 18, 26, 11, 22];

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

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useLandingReveal(dep: unknown) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".landing-page .lp-reveal"));
    if (nodes.length === 0) return;
    if (prefersReducedMotion()) {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -36px 0px" },
    );
    nodes.forEach((n) => {
      if (!n.classList.contains("is-in")) io.observe(n);
    });
    return () => io.disconnect();
  }, [dep]);
}

export function LandingPage() {
  const [content, setContent] = useState<LandingContent>(DEFAULT_LANDING);
  const [plansCfg, setPlansCfg] = useState<PlansConfig>(DEFAULT_PLANS);
  const [now, setNow] = useState(Date.now());
  const [scrolled, setScrolled] = useState(false);

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

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const videos = content.media.filter((m) => m.type === "video");
  useLandingReveal(`${content.features.length}:${videos.length}:${content.stories.length}`);

  const c = content.contact || {};
  const socials: Array<{ href: string; label: string; icon: LucideIcon }> = [];
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

  const hasVideos = videos.length > 0;
  const visiblePaidPlans = PAID_PLANS.filter((p) => plansCfg[p]?.enabled);
  const hasPricing = visiblePaidPlans.length > 0;
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
    hasVideos && { id: "videos", label: "ویدیوها" },
    { id: "why-kamix", label: "امکانات" },
    { id: "live-showcase", label: "نمایش زنده" },
    socials.length > 0 && { id: "contact", label: "تماس" },
  ].filter(Boolean) as { id: string; label: string }[];

  const supportHref = c.phone
    ? `tel:${c.phone.replace(/\s+/g, "")}`
    : c.whatsapp
      ? `https://wa.me/${c.whatsapp.replace(/[^\d]/g, "")}`
      : null;

  return (
    <div dir="rtl" className="landing-page min-h-screen bg-background text-foreground">
      <header
        className={`sticky top-0 z-30 pt-safe border-b transition-[background-color,box-shadow,border-color] duration-200 ${
          scrolled
            ? "border-border/80 bg-background/92 shadow-sm backdrop-blur-md"
            : "border-transparent bg-background/75 backdrop-blur-md"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-primary shadow-elegant" aria-hidden="true">
              <Receipt className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="truncate text-[1.05rem] font-extrabold tracking-tight kamali-brand">
              {content.brand_name}
            </span>
          </div>

          {quickLinks.length > 0 && (
            <nav
              className="hidden min-w-0 flex-1 items-center justify-center gap-1 md:flex"
              aria-label="بخش‌های صفحه"
            >
              {quickLinks.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(l.id);
                  }}
                  className="rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {l.label}
                </a>
              ))}
            </nav>
          )}

          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              to="/login"
              preload={false}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              ورود
            </Link>
            <Link
              to="/register"
              preload={false}
              className="lp-btn lp-btn-primary rounded-xl bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground shadow-elegant sm:px-4"
            >
              ثبت‌نام
            </Link>
          </div>
        </div>

        {quickLinks.length > 0 && (
          <div className="border-t border-border/50 md:hidden">
            <div className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {quickLinks.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(l.id);
                  }}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="overflow-x-clip">
        {/* Hero — copy + live voice-invoice */}
        <section className="lp-hero relative">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-primary/25 to-transparent" />
          <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-8 sm:pb-16 sm:pt-12">
            <div className="lp-hero-grid">
              <div className="lp-hero-titles">
                <p className="lp-enter lp-enter-1 mb-3 inline-flex items-center gap-2 text-[13px] font-bold text-primary">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10">
                    <Mic className="h-3.5 w-3.5" />
                  </span>
                  فاکتور را بگو — نه بنویس
                </p>
                <h1 className="lp-enter lp-enter-2 max-w-xl text-[1.7rem] font-extrabold leading-[1.35] sm:text-4xl lg:text-[2.6rem] lg:leading-[1.3]">
                  وقتی مشتری جلوی پیشخوانه، فاکتور همون لحظه آماده‌ست
                </h1>
                <p className="lp-enter lp-enter-2 mt-2 text-sm font-bold kamali-brand">{content.headline}</p>
              </div>

              <div className="lp-hero-demo lp-enter lp-enter-demo">
                <VoiceInvoiceDemo />
              </div>

              <div className="lp-hero-rest">
                <p className="lp-enter lp-enter-3 lp-body mt-1 max-w-xl text-base font-semibold text-primary sm:text-lg">
                  {content.subheadline}
                </p>
                <p className="lp-enter lp-enter-3 lp-body mt-3 max-w-xl text-sm leading-8 text-muted-foreground sm:text-[15px]">
                  {content.description}
                </p>

                <div className="lp-enter lp-enter-4 mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                  <Link
                    to="/register"
                    preload={false}
                    className="lp-btn lp-btn-primary inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-7 py-3.5 text-base font-extrabold text-primary-foreground shadow-elegant"
                  >
                    ثبت‌نام و شروع از روی گوشی
                    <ArrowLeft className="h-5 w-5" />
                  </Link>
                  <Link
                    to="/login"
                    preload={false}
                    className="lp-btn inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/35 bg-card px-7 py-3.5 text-base font-bold text-foreground hover:bg-accent"
                  >
                    قبلاً حساب دارم — ورود
                  </Link>
                </div>

                <ul className="lp-enter lp-enter-4 lp-body mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <li className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-primary" /> همون گوشی مغازه‌ت کافیه
                  </li>
                  <li className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-primary" /> بارکد را با دوربین بزن
                  </li>
                  <li className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-primary" /> دفترت روی ابر هم می‌مونه
                  </li>
                </ul>

                <div className="lp-enter lp-enter-4 mx-auto mt-6 flex max-w-xl items-start gap-3 rounded-2xl border border-dashed border-primary/35 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary sm:mx-0">
                  <Smartphone className="mt-0.5 h-5 w-5 shrink-0" />
                  <span className="lp-body leading-7">
                    بعد از ثبت‌نام، لینک دانلود <strong>اپ اندروید KAMIX</strong> روی همین صفحه برات می‌آید — لازم نیست از قبل چیزی نصب کرده باشی.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <StoriesBar stories={content.stories} />

        {hasVideos && (
          <section id="videos" className="lp-reveal mx-auto max-w-6xl scroll-mt-28 px-4 py-12">
            <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
              از نزدیک ببین صندوق چطور جمع می‌شود
            </h2>
            <p className="lp-body mx-auto mt-2 max-w-xl text-center text-sm leading-7 text-muted-foreground">
              ویدیوها روی آپارات یا یوتیوب هستند؛ اینجا چیزی برای دانلود سنگین نمی‌شود.
            </p>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {videos.map((m, i) => {
                const embed = videoEmbedUrl(m.url);
                return (
                  <figure key={i} className="lp-card lp-video-frame group overflow-hidden rounded-2xl border border-border/70 transition">
                    {embed ? (
                      <iframe
                        src={embed}
                        title={m.caption || `ویدیوی معرفی ${i + 1}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                        allowFullScreen
                        loading="lazy"
                        className="aspect-video w-full border-0 bg-black"
                      />
                    ) : (
                      <video
                        src={m.url}
                        poster={m.coverUrl}
                        muted
                        loop
                        playsInline
                        controls
                        preload="metadata"
                        className="aspect-video w-full bg-black object-cover"
                      />
                    )}
                    {m.caption && (
                      <figcaption className="lp-body px-4 py-3 text-center text-sm text-muted-foreground">
                        {m.caption}
                      </figcaption>
                    )}
                  </figure>
                );
              })}
            </div>
          </section>
        )}

        <section id="why-kamix" className="lp-reveal mx-auto max-w-6xl scroll-mt-28 px-4 py-12">
          <h2 className="max-w-xl text-2xl font-extrabold tracking-tight sm:text-3xl">
            دفتر کاغذی را بگذار کنار — کار روزانه همین‌هاست
          </h2>
          <p className="lp-body mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
            نه شعار مدیریت کسب‌وکار؛ همین کارهایی که هر روز پشت پیشخوان انجام می‌دهی.
          </p>
          <div className="lp-features mt-8">
            {content.features.map((f, i) => {
              const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
              const lead = i === 0;
              return (
                <article
                  key={i}
                  className={`lp-card rounded-2xl border border-border bg-card p-4 shadow-card transition sm:p-5 ${
                    lead ? "lp-feature lp-feature--lead p-5 sm:p-7" : "lp-feature"
                  }`}
                >
                  <div
                    className={`mb-3 grid place-items-center rounded-xl bg-primary/10 text-primary ${
                      lead ? "h-12 w-12" : "h-9 w-9 sm:h-10 sm:w-10"
                    }`}
                  >
                    <Icon className={lead ? "h-6 w-6" : "h-4 w-4 sm:h-5 sm:w-5"} />
                  </div>
                  <h3 className={lead ? "text-xl font-extrabold sm:text-2xl" : "text-sm font-bold sm:text-base"}>
                    {f.title}
                  </h3>
                  <p className={`lp-body mt-1.5 text-muted-foreground ${lead ? "text-sm leading-8 sm:text-[15px]" : "text-xs leading-6 sm:text-sm sm:leading-7"}`}>
                    {f.description}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        <div className="lp-reveal">
          <LiveFeatureShowcase />
        </div>

        {hasPricing && (
          <section id="pricing" className="lp-reveal mx-auto max-w-6xl scroll-mt-28 px-4 py-12">
            <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
              یک اشتراک؛ کل پیشخوان
            </h2>
            <p className="lp-body mx-auto mt-2 max-w-xl text-center text-sm leading-7 text-muted-foreground">
              قیمت همان است که می‌بینی. بعد از پرداخت، همان روز از روی گوشی فاکتور می‌زنی.
            </p>

            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {visiblePaidPlans.map((p) => (
                <PlanCard key={p} plan={p} cfg={plansCfg[p]} recommended={p === recommendedPlan} now={now} />
              ))}
            </div>
          </section>
        )}

        <section className="lp-reveal mx-auto max-w-6xl px-4 pb-16">
          <div className="lp-cta-slip rounded-3xl p-8 text-center text-primary-foreground sm:p-12">
            <p className="relative text-[13px] font-bold opacity-90">فاکتور امروز هنوز باز است</p>
            <h3 className="relative mt-2 text-2xl font-extrabold sm:text-3xl">
              دفتر را ببند — از فردا با گوشی بفروش
            </h3>
            <p className="lp-body relative mx-auto mt-3 max-w-lg text-sm leading-7 opacity-90">
              ساخت حساب کمتر از دو دقیقه طول می‌کشد. بعد از ثبت‌نام، لینک دانلود اپ اندروید هم همان‌جا نشان داده می‌شود.
            </p>
            <div className="relative mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/register"
                preload={false}
                className="lp-btn lp-btn-primary flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-background px-8 py-4 text-base font-extrabold text-primary sm:w-auto"
              >
                ثبت‌نام
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <Link
                to="/login"
                preload={false}
                className="lp-btn flex w-full max-w-xs items-center justify-center rounded-2xl border border-primary-foreground/40 px-8 py-4 text-base font-bold text-primary-foreground transition hover:bg-primary-foreground/10 sm:w-auto"
              >
                ورود به حساب
              </Link>
            </div>
          </div>
        </section>

        {socials.length > 0 && (
          <section id="contact" className="lp-reveal mx-auto max-w-6xl scroll-mt-28 px-4 pb-14">
            <div className="rounded-3xl border border-dashed border-primary/30 bg-card p-6 shadow-card sm:p-8">
              <h3 className="text-center text-xl font-extrabold sm:text-2xl">سوال داری؟ مستقیم زنگ بزن</h3>
              <p className="lp-body mx-auto mt-1 max-w-md text-center text-xs leading-7 text-muted-foreground sm:text-sm">
                مثل پشت پیشخوان — مشاوره، خرید یا پشتیبانی، از همین راه‌ها به خودمان می‌رسی.
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
                      className="lp-card inline-flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
                    >
                      <Icon className="h-4 w-4" />
                      <span className="max-w-[160px] truncate">{s.label}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <section className="lp-reveal mx-auto max-w-6xl px-4 pb-10">
          <ActiveUsersBadge />
        </section>

        <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} KAMIX — همه‌ی حقوق محفوظ است.
        </footer>
      </div>

      {supportHref && (
        <a
          href={supportHref}
          target={supportHref.startsWith("http") ? "_blank" : undefined}
          rel={supportHref.startsWith("http") ? "noopener noreferrer" : undefined}
          aria-label="پشتیبانی رایگان"
          title="پشتیبانی رایگان"
          className="fixed bottom-[calc(1rem+var(--safe-bottom))] left-4 z-40 h-14 w-14 rounded-full transition-transform duration-300 hover:scale-110 active:scale-95 sm:bottom-[calc(1.25rem+var(--safe-bottom))] sm:left-5"
        >
          <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-xl" role="img" aria-hidden="true">
            <defs>
              <linearGradient id="kx-sup-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#4f8cff" />
                <stop offset="55%" stopColor="#6a5cff" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
              <radialGradient id="kx-sup-shine" cx="0.3" cy="0.22" r="0.7">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="32" cy="32" r="31" fill="url(#kx-sup-bg)" />
            <circle cx="32" cy="32" r="31" fill="url(#kx-sup-shine)" />
            <circle cx="32" cy="32" r="30" fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="1.5" />
            <path
              d="M18 34v-3a14 14 0 0 1 28 0v3"
              fill="none"
              stroke="#ffffff"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <rect x="13.5" y="32" width="8" height="13" rx="4" fill="#ffffff" />
            <rect x="42.5" y="32" width="8" height="13" rx="4" fill="#ffffff" />
            <path
              d="M46.5 45v2.5a5 5 0 0 1-5 5H36"
              fill="none"
              stroke="#ffffff"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="33" cy="52.5" r="3.2" fill="#ffffff" />
            <rect x="24" y="21" width="16" height="11" rx="5.5" fill="#ffffff" />
            <circle cx="29" cy="26.5" r="1.4" fill="#6a5cff" />
            <circle cx="32" cy="26.5" r="1.4" fill="#6a5cff" />
            <circle cx="35" cy="26.5" r="1.4" fill="#6a5cff" />
          </svg>
        </a>
      )}
    </div>
  );
}

function VoiceInvoiceDemo() {
  const [typed, setTyped] = useState("");
  const [rows, setRows] = useState(0);
  const [stamp, setStamp] = useState(false);
  const [listening, setListening] = useState(false);
  const dateLabel = useMemo(() => {
    try {
      return new Date().toLocaleDateString("fa-IR");
    } catch {
      return "—";
    }
  }, []);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setTyped(INVOICE_DEMO[INVOICE_DEMO.length - 1].spoken);
      setRows(INVOICE_DEMO.length);
      setStamp(true);
      return;
    }

    let cancelled = false;
    let timeoutId = 0;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timeoutId = window.setTimeout(resolve, ms);
      });

    const run = async () => {
      while (!cancelled) {
        setTyped("");
        setRows(0);
        setStamp(false);
        setListening(false);
        await wait(450);
        if (cancelled) return;
        for (let i = 0; i < INVOICE_DEMO.length; i++) {
          if (cancelled) return;
          const text = INVOICE_DEMO[i].spoken;
          setListening(true);
          setTyped("");
          for (let c = 0; c < text.length; c++) {
            if (cancelled) return;
            setTyped(text.slice(0, c + 1));
            await wait(40);
          }
          setListening(false);
          await wait(260);
          if (cancelled) return;
          setRows(i + 1);
          await wait(720);
        }
        if (cancelled) return;
        setStamp(true);
        await wait(2800);
      }
    };

    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  const visible = INVOICE_DEMO.slice(0, rows);
  const total = visible.reduce((sum, line) => sum + line.amount, 0);

  return (
    <div className="lp-demo mx-auto w-full max-w-[22.5rem]">
      <p className="sr-only">
        نمایش ازپیش‌تعریف‌شدهٔ صدور فاکتور با صدا: چند کالای نمونه گفته می‌شود و ردیف فاکتور اضافه می‌گردد.
      </p>
      <div aria-hidden="true">
      <div className="lp-voice">
        <span className={`lp-mic ${listening ? "is-on" : ""}`}>
          <Mic className="h-3.5 w-3.5" />
        </span>
        <span className={`lp-wave ${listening ? "is-on" : ""}`} aria-hidden="true">
          <span /><span /><span /><span /><span />
        </span>
        <span className="lp-spoken">
          {typed || (rows === 0 && !listening ? "بگو چی فروختی…" : "")}
          {listening && <span className="lp-caret" />}
        </span>
      </div>

      <div className="lp-receipt">
        <span className="lp-receipt-fold" />
        <div className="lp-receipt-head">
          <div className="lp-receipt-shop">فروشگاه امید</div>
          <div className="lp-receipt-meta">
            <span>فاکتور فروش</span>
            <span dir="ltr">{dateLabel} · ۱۴۰۳-۰۱۸۴</span>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="lp-receipt-empty">منتظر صدای فروشنده…</div>
        ) : (
          <div>
            {visible.map((line) => (
              <div key={line.name} className="lp-receipt-row">
                <span>{line.name}</span>
                <span className="text-[11px] opacity-60">× {line.qty}</span>
                <span>{formatToman(line.amount)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="lp-receipt-total">
          <span>جمع</span>
          <span>{formatToman(total)}</span>
        </div>

        <div className="lp-barcode" aria-hidden="true">
          {BARCODE_BARS.map((h, i) => (
            <i key={i} style={{ height: `${h}px` }} />
          ))}
        </div>

        {stamp && (
          <div className="lp-stamp">
            <strong>ثبت شد</strong>
            <small>KAMIX</small>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

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
    "ثبت فاکتور با صدا",
    "اسکن کالا با دوربین موبایل",
    "ساخت سایت تک‌صفحه‌ای فروشگاه",
    "مدیریت انبار و محصولات",
    "گزارش‌های فروش و سود",
    "پشتیبانی رایگان",
  ];

  return (
    <Link
      to="/register"
      preload={false}
      className={`lp-plan lp-card group relative flex flex-col rounded-3xl border p-6 pt-9 text-center shadow-card transition-all duration-300 ${
        recommended
          ? "z-10 border-primary bg-[var(--lp-paper)] shadow-elegant ring-2 ring-primary/25 sm:scale-[1.04]"
          : "border-border bg-card"
      }`}
    >
      {recommended && (
        <span className="lp-plan-stamp">پیشنهاد مغازه</span>
      )}
      {discounted && (
        <span className="absolute -top-2 -right-2 rotate-[-8deg] rounded-sm border border-rose-400/80 bg-rose-50 px-2 py-1 text-[11px] font-extrabold text-rose-700 shadow-sm">
          {cfg.discount_percent.toLocaleString("fa-IR")}٪ تخفیف
        </span>
      )}

      <div className="text-lg font-extrabold">{PLAN_LABEL[plan]}</div>
      <div className="lp-body mt-1 text-xs text-muted-foreground">
        {PLAN_DURATION_LABEL[plan]} اعتبار
      </div>

      <div className="my-5">
        {discounted && (
          <div className="lp-body text-xs text-muted-foreground line-through">
            {formatToman(cfg.price)}
          </div>
        )}
        <div className="text-2xl font-black">{formatToman(final)}</div>
        {discounted && isFinite(remainingMs) && remainingMs > 0 && (
          <div dir="ltr" className="mt-1 text-[10px] text-rose-600">
            {formatRemaining(remainingMs)} تا پایان تخفیف
          </div>
        )}
      </div>

      <ul className="lp-body mb-6 flex-1 space-y-2 text-right text-xs">
        {perks.map((perk) => (
          <li key={perk} className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>{perk}</span>
          </li>
        ))}
      </ul>

      <span
        className={`mt-auto flex items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-bold transition ${
          recommended
            ? "bg-primary text-primary-foreground group-hover:opacity-90"
            : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
        }`}
      >
        شروع کنید
        <ArrowLeft className="h-4 w-4" />
      </span>
    </Link>
  );
}

function ActiveUsersBadge() {
  const targetCount = useMemo(() => {
    const day = Math.floor(Date.now() / 86_400_000);
    const seeded = ((day * 9301 + 49297) % 233280) / 233280;
    return 5000 + Math.floor(seeded * 900);
  }, []);
  const [count, setCount] = useState(0);
  const [countUpDone, setCountUpDone] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setCount(targetCount);
      setCountUpDone(true);
      return;
    }
    let frameId: number;
    const duration = 1800;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
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
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <Users className="h-4 w-4 text-primary" />
        <span className="text-sm font-extrabold tabular-nums text-foreground">
          {count.toLocaleString("fa-IR")}
        </span>
        <span className="lp-body text-xs text-muted-foreground">فروشنده همین حالا با KAMIX کار می‌کنند</span>
      </div>
    </div>
  );
}
