/**
 * صفحه‌ی معرفی KAMIX — فقط برای بازدیدکنندگان وب (نه داخل اپلیکیشن).
 * تم آبی/سفید، معرفی برنامه، ویدیو/عکس‌های قابل‌مدیریت از پنل ادمین،
 * و دکمه‌های واضح «ثبت‌نام» و «ورود».
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
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
  Phone,
  Instagram,
  Send,
  MessageCircle,
  Mail,
} from "lucide-react";
import heroBannerUrl from "@/assets/kamix-hero-banner.png";

const FEATURE_ICONS = [Receipt, ScanLine, Package, BarChart3, Users, ShieldCheck];

export function LandingPage() {
  const [content, setContent] = useState<LandingContent>(DEFAULT_LANDING);

  useEffect(() => {
    let alive = true;
    loadLandingContent().then((c) => {
      if (alive) setContent(c);
    });
    return () => {
      alive = false;
    };
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

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground">
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
        </div>
      </section>

      {/* Media gallery */}
      {content.media.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="mb-6 text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
            نگاهی به KAMIX
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {content.media.map((m, i) => (
              <figure
                key={i}
                className="group overflow-hidden rounded-2xl border border-border bg-card shadow-card transition hover:shadow-elegant"
              >
                {m.type === "video" ? (
                  <video
                    src={m.url}
                    autoPlay
                    muted
                    loop
                    playsInline
                    controls
                    preload="metadata"
                    className="aspect-video w-full bg-black object-cover transition duration-500 group-hover:scale-[1.02]"
                  />
                ) : (
                  <img
                    src={m.url}
                    alt={m.caption || "معرفی KAMIX"}
                    loading="lazy"
                    className="aspect-video w-full object-cover transition duration-500 group-hover:scale-[1.02]"
                  />
                )}
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
      <section className="mx-auto max-w-5xl px-4 py-10">
        <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
          چرا KAMIX؟
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
          همه‌ی ابزارهای فروشگاه‌داری در یک برنامه‌ی ساده و فارسی.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {content.features.map((f, i) => {
            const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
            return (
              <div
                key={i}
                className="rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-primary/40 hover:shadow-elegant"
              >
                <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="text-base font-bold">{f.title}</div>
                <p className="mt-1.5 text-sm leading-7 text-muted-foreground">{f.description}</p>
              </div>
            );
          })}
        </div>
      </section>

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
        <section className="mx-auto max-w-5xl px-4 pb-14">
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

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} KAMIX — همه‌ی حقوق محفوظ است.
      </footer>
    </div>
  );
}
