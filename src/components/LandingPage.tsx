/**
 * KAMIX landing page — shown only to web visitors who are not signed in
 * (AuthGuard decides; inside the Android app it is hidden by `html[data-app]`).
 *
 * Story: clear promise → who it is for → the three signature features with
 * self-playing demos → paper vs. KAMIX → everything else → data safety →
 * how to start → pricing → FAQ → closing CTA.
 *
 * Performance: the page stylesheet is loaded only when this component renders
 * (React-hoisted <link>); the animated demos are a lazy chunk mounted when the
 * visitor scrolls near them. CTA destinations are unchanged: /register,
 * /login, plan cards → /register.
 */
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  Cloud,
  Coffee,
  Download,
  Factory,
  Fingerprint,
  Gem,
  GraduationCap,
  HardDriveDownload,
  Headphones,
  Instagram,
  Mail,
  MessageCircle,
  Mic,
  Package,
  Phone,
  Receipt,
  RefreshCw,
  ScanLine,
  Send,
  ShieldCheck,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Store,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { getPublicSettings } from "@/lib/auth.functions";
import { DEFAULT_PLANS, effectivePrice, type PlansConfig } from "@/lib/plans";
import {
  DEFAULT_LANDING,
  loadLandingContent,
  videoEmbedUrl,
  type LandingContent,
} from "@/lib/landing";
import { APK_DOWNLOAD_URL } from "@/components/ApkDownloadButton";
import { StoriesBar } from "@/components/StoriesBar";
import { LANDING_TRUST } from "@/components/landing/config";
import { LANDING_FAQ } from "@/components/landing/faq";
import { HeroVisual } from "@/components/landing/HeroVisual";
import { Mascot } from "@/components/landing/Mascot";
import { PlanCard } from "@/components/landing/Pricing";
import { PAID_PLANS, PLAN_PERKS, pickRecommendedPlan } from "@/components/landing/pricing-utils";
import { KamixMark } from "@/components/landing/KamixMark";
import {
  faNum,
  prefersReducedMotion,
  scrollToId,
  useCountUp,
  useInView,
  useRevealOnScroll,
} from "@/components/landing/hooks";
import landingCssUrl from "@/components/landing/landing.css?url";

const VoiceDemo = lazy(() =>
  import("@/components/landing/demos").then((m) => ({ default: m.VoiceDemo })),
);
const ScanDemo = lazy(() =>
  import("@/components/landing/demos").then((m) => ({ default: m.ScanDemo })),
);
const AssistantDemo = lazy(() =>
  import("@/components/landing/demos").then((m) => ({ default: m.AssistantDemo })),
);

const DEMOS = { voice: VoiceDemo, scan: ScanDemo, assistant: AssistantDemo } as const;
type DemoKind = keyof typeof DEMOS;

const NAV = [
  { id: "voice", label: "امکانات ویژه" },
  { id: "features", label: "همه امکانات" },
  { id: "pricing", label: "قیمت‌ها" },
  { id: "faq", label: "سؤالات" },
];

const BUSINESSES: Array<{ icon: LucideIcon; label: string }> = [
  { icon: ShoppingBasket, label: "سوپرمارکت" },
  { icon: Shirt, label: "پوشاک" },
  { icon: Smartphone, label: "موبایل‌فروشی" },
  { icon: Coffee, label: "کافه و رستوران" },
  { icon: Gem, label: "طلا و جواهر" },
  { icon: GraduationCap, label: "آموزشگاه" },
  { icon: Factory, label: "کارگاه تولیدی" },
  { icon: Store, label: "هر فروشگاهی" },
];

const FEATURES: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Receipt,
    title: "فاکتور فروش و خرید",
    body: "با تخفیف، چک و چاپ رسید. PDF فاکتور را برای مشتری بفرست.",
  },
  {
    icon: Package,
    title: "انبار و موجودی",
    body: "با هر فروش و خرید خودش به‌روز می‌شود و کمبودها را نشانت می‌دهد.",
  },
  {
    icon: Users,
    title: "مشتریان و بدهکاران",
    body: "مانده‌ی هر مشتری، و یادآوری سررسید بدهی‌ها و چک‌ها.",
  },
  {
    icon: BarChart3,
    title: "گزارش سود و فروش",
    body: "سود و فروش روزانه، هفتگی و ماهانه، با تاریخ شمسی.",
  },
  {
    icon: HardDriveDownload,
    title: "خروجی و پشتیبان",
    body: "هر وقت خواستی خروجی اکسل، PDF یا فایل پشتیبان کامل بگیر.",
  },
  {
    icon: Store,
    title: "ویترین آنلاین",
    body: "صفحه‌ی معرفی فروشگاه و منوی دیجیتال با QR کد اختصاصی.",
  },
];

const EXTRAS = [
  "نرخ لحظه‌ای طلا و سکه",
  "هنرجو و شهریه",
  "تولید و فرمول",
  "برنامه‌ی هفته و یادآوری",
  "هزینه‌ها",
  "جستجوی سریع",
  "ورود کالا از اکسل",
  "تغییر گروهی قیمت",
];

const BEFORE = [
  "فاکتور را با دست می‌نویسی",
  "آخر شب با ماشین‌حساب جمع می‌زنی",
  "بدهی‌ها لابه‌لای دفتر گم می‌شوند",
  "اگر دفتر گم شود، همه‌چیز رفته",
];

const AFTER = [
  "فاکتور با چند لمس، یا فقط با صدا",
  "سود و فروش هر لحظه جلوی چشمت",
  "مانده‌ی هر مشتری، با یادآوری",
  "اطلاعات روی حساب ابری‌ات می‌ماند",
];

const SECURITY: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Cloud,
    title: "نسخه‌ی ابری از حسابت",
    body: "گوشی خراب یا گم شد؟ روی گوشی جدید وارد شو؛ همه‌چیز سر جایش است.",
  },
  {
    icon: RefreshCw,
    title: "همگام روی چند دستگاه",
    body: "ثبت‌های دستگاه‌های مختلف با هم ادغام می‌شوند و چیزی پاک نمی‌شود.",
  },
  {
    icon: Fingerprint,
    title: "فقط مال خودت",
    body: "دسترسی به اطلاعات هر حساب فقط برای صاحب همان حساب است.",
  },
  {
    icon: HardDriveDownload,
    title: "پشتیبان در دست خودت",
    body: "هر زمان خروجی کامل بگیر و هر جا خواستی نگه دار.",
  },
];

const STEPS: Array<{ title: string; body: string }> = [
  { title: "ثبت‌نام کن", body: "نام کاربری، رمز و پلن دلخواهت را انتخاب کن." },
  { title: "پرداخت کن", body: "کارت‌به‌کارت واریز کن و عکس رسید را بفرست." },
  { title: "وارد شو", body: "بعد از تأیید پرداخت، با همان نام کاربری وارد می‌شوی." },
  { title: "اولین فاکتور", body: "محصولاتت را اضافه کن و اولین فاکتور را بگو!" },
];

function supportLinks(c: LandingContent["contact"]) {
  const out: Array<{ href: string; label: string; icon: LucideIcon; ltr?: boolean }> = [];
  if (c.phone) {
    out.push({
      href: `tel:${c.phone.replace(/\s+/g, "")}`,
      label: c.phone,
      icon: Phone,
      ltr: true,
    });
  }
  if (c.whatsapp) {
    out.push({
      href: `https://wa.me/${c.whatsapp.replace(/[^\d]/g, "")}`,
      label: "واتساپ",
      icon: MessageCircle,
    });
  }
  if (c.telegram) {
    out.push({
      href: c.telegram.startsWith("http")
        ? c.telegram
        : `https://t.me/${c.telegram.replace(/^@/, "")}`,
      label: "تلگرام",
      icon: Send,
    });
  }
  if (c.instagram) {
    out.push({
      href: c.instagram.startsWith("http")
        ? c.instagram
        : `https://instagram.com/${c.instagram.replace(/^@/, "")}`,
      label: "اینستاگرام",
      icon: Instagram,
    });
  }
  if (c.email) out.push({ href: `mailto:${c.email}`, label: c.email, icon: Mail, ltr: true });
  return out;
}

const FAQ_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: LANDING_FAQ.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
});

const APP_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "KAMIX (کامیکس)",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Android, Web",
  inLanguage: "fa",
  url: "https://kamixapp.ir/",
  description:
    "حسابداری فروشگاهی فارسی روی گوشی: فاکتور، انبار، مشتریان و گزارش سود؛ با ثبت فاکتور با صدا، اسکن بارکد با دوربین و دستیار هوشمند.",
});

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<LandingContent>(DEFAULT_LANDING);
  const [plansCfg, setPlansCfg] = useState<PlansConfig>(DEFAULT_PLANS);
  const [now, setNow] = useState(() => Date.now());
  const [scrolled, setScrolled] = useState(false);
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    let alive = true;
    loadLandingContent().then((c) => {
      if (alive) setContent(c);
    });
    getPublicSettings()
      .then((data) => {
        if (alive) setPlansCfg(data.plans);
      })
      .catch(() => {
        /* default plans stay visible */
      });
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        setScrolled(y > 8);
        setPastHero(y > window.innerHeight * 0.9);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const videos = content.media.filter((m) => m.type === "video");
  useRevealOnScroll(rootRef, `${videos.length}:${content.stories.length}`);

  const socials = supportLinks(content.contact || {});
  const supportHref = content.contact?.phone
    ? `tel:${content.contact.phone.replace(/\s+/g, "")}`
    : content.contact?.whatsapp
      ? `https://wa.me/${content.contact.whatsapp.replace(/[^\d]/g, "")}`
      : null;

  const visiblePlans = PAID_PLANS.filter((p) => plansCfg[p]?.enabled);
  const recommended = pickRecommendedPlan(visiblePlans, plansCfg, now);
  const monthlyBase = visiblePlans.includes("1month") ? effectivePrice(plansCfg["1month"], now) : 0;
  const customFeatures =
    JSON.stringify(content.features) !== JSON.stringify(DEFAULT_LANDING.features)
      ? content.features
      : [];
  const { activeBusinesses, testimonials, guarantee, supportHours } = LANDING_TRUST;

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    scrollToId(id);
  };

  return (
    <div ref={rootRef} dir="rtl" id="top" className="landing-page kx">
      <link rel="stylesheet" href={landingCssUrl} precedence="default" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: APP_LD }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_LD }} />

      <a href="#main" className="kx-skip" onClick={go("main")}>
        رفتن به محتوای اصلی
      </a>

      {/* ── Header: calm and minimal — brand, a few links, login ─────── */}
      <header className={`kx-header ${scrolled ? "is-scrolled" : ""}`}>
        <div className="kx-wrap kx-header-in">
          <a
            href="#top"
            className="kx-brand"
            aria-label={`${content.brand_name} — بازگشت به بالای صفحه`}
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
            }}
          >
            <KamixMark className="kx-brand-mark" />
            <span className="kx-brand-name">{content.brand_name}</span>
          </a>

          <nav className="kx-nav" aria-label="بخش‌های صفحه">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={go(n.id)}>
                {n.label}
              </a>
            ))}
          </nav>

          <div className="kx-header-actions">
            <Link to="/login" preload={false} className="kx-btn kx-btn--soft kx-btn--sm">
              ورود
            </Link>
            <Link
              to="/register"
              preload={false}
              className="kx-btn kx-btn--primary kx-btn--sm kx-only-desktop"
            >
              ثبت‌نام
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="kx-hero" aria-labelledby="kx-hero-title">
          <div className="kx-hero-bg" aria-hidden="true" />
          <div className="kx-wrap kx-hero-in">
            <div className="kx-hero-copy">
              {activeBusinesses > 0 && (
                <p className="kx-trust-pill kx-enter" style={{ animationDelay: "0.05s" }}>
                  <span className="kx-trust-avatars" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  بیش از <b>{faNum(activeBusinesses)}</b> کسب‌وکار با KAMIX کار می‌کنند
                </p>
              )}
              <h1
                id="kx-hero-title"
                className="kx-hero-title kx-enter"
                style={{ animationDelay: "0.12s" }}
              >
                حسابداری مغازه،
                <br />
                <span className="kx-scribble">ساده</span> مثل پیام دادن
              </h1>
              <p className="kx-hero-lead kx-enter" style={{ animationDelay: "0.2s" }}>
                فاکتور صادر کن، موجودی انبار را ببین و بدهی مشتری‌ها را پیگیری کن؛ همه از روی گوشی.
                حتی می‌توانی فاکتور را <b>با صدا</b> ثبت کنی یا بارکد را <b>با دوربین گوشی</b>{" "}
                بخوانی.
              </p>
              <div className="kx-hero-ctas kx-enter" style={{ animationDelay: "0.28s" }}>
                <Link to="/register" preload={false} className="kx-btn kx-btn--primary kx-btn--lg">
                  ثبت‌نام و شروع کار
                  <ArrowLeft />
                </Link>
                <a
                  href="#voice"
                  className="kx-btn kx-btn--ghost kx-btn--lg kx-hide-xs"
                  onClick={go("voice")}
                >
                  ببین چطور کار می‌کند
                </a>
              </div>
              <p className="kx-hero-login kx-enter" style={{ animationDelay: "0.32s" }}>
                قبلاً ثبت‌نام کرده‌ای؟{" "}
                <Link to="/login" preload={false}>
                  وارد شو
                </Link>
              </p>
              <ul className="kx-assure kx-enter" style={{ animationDelay: "0.38s" }}>
                <li>
                  <Headphones /> پشتیبانی رایگان
                </li>
                <li>
                  <Smartphone /> اپ اندروید و نسخه‌ی وب
                </li>
                <li>
                  <ShieldCheck /> اطلاعات امن روی ابر
                </li>
              </ul>
            </div>
            <div className="kx-hero-visual kx-enter" style={{ animationDelay: "0.2s" }}>
              <HeroVisual />
            </div>
          </div>
        </section>

        {/* ── Who it is for ─────────────────────────────────────────── */}
        <section className="kx-for" aria-labelledby="kx-for-title">
          <div className="kx-wrap">
            <h2 id="kx-for-title" className="kx-for-title kx-reveal">
              مناسب هر کسب‌وکاری که خرید و فروش دارد
            </h2>
            <ul className="kx-for-list kx-reveal">
              {BUSINESSES.map((b) => {
                const Icon = b.icon;
                return (
                  <li key={b.label}>
                    <Icon aria-hidden="true" />
                    {b.label}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ── Signature features ─────────────────────────────────────── */}
        <Showcase
          id="voice"
          tone="sky"
          step="۱"
          kicker="ثبت فاکتور با صدا"
          icon={Mic}
          title="فقط بگو چی فروختی؛ فاکتور آماده است."
          lead="میکروفون را بزن و بگو «دو تا پیراهن مردانه». KAMIX کالا را از فهرست محصولاتت پیدا می‌کند، قیمت را می‌گذارد و جمع فاکتور را حساب می‌کند."
          points={[
            "عدد و مبلغ را به فارسی محاوره‌ای می‌فهمد",
            "اگر چند کالای شبیه داشته باشی، از تو می‌پرسد",
            "جایی که نمی‌شود حرف زد، همان جمله را تایپ کن",
          ]}
          demo="voice"
        />

        <Showcase
          id="scan"
          tone="mint"
          reverse
          step="۲"
          kicker="اسکن بارکد با دوربین"
          icon={ScanLine}
          title="دوربین گوشی‌ات، بارکدخوان توست."
          lead="بارکد کالا را جلوی دوربین بگیر؛ کالا با قیمتش همان لحظه به فاکتور اضافه می‌شود. دیگر لازم نیست دستگاه بارکدخوان بخری."
          points={[
            "بارکد کالا و QR کد را می‌خواند",
            "اسکن پشت‌سرهم برای فاکتورهای چندقلمی",
            "برای کالاهای بدون بارکد، برچسب بارکد بساز و چاپ کن",
          ]}
          demo="scan"
        />

        <Showcase
          id="assistant"
          tone="lavender"
          step="۳"
          kicker="دستیار هوشمند"
          icon={Sparkles}
          title="سؤال کن، فوری جواب بگیر."
          lead="بپرس «امروز چقدر سود کردم؟» یا بگو «آقای شهریاری ۲۵۰ هزار تومان بدهکار است». دستیار از روی حساب خودت جواب می‌دهد یا کار را برایت ثبت می‌کند."
          points={[
            "سود، فروش، هزینه و پرفروش‌ترین کالا را می‌گوید",
            "بدهی مشتری و یادآوری را با یک جمله ثبت می‌کند",
            "جواب را از اطلاعات خودت حساب می‌کند، نه با حدس",
          ]}
          demo="assistant"
        />

        {/* ── Admin-managed stories & videos ─────────────────────────── */}
        {content.stories.length > 0 && (
          <section className="kx-section kx-section--tight" aria-label="استوری‌های KAMIX">
            <StoriesBar stories={content.stories} />
          </section>
        )}

        {videos.length > 0 && (
          <section id="videos" className="kx-section" aria-labelledby="kx-videos-title">
            <div className="kx-wrap">
              <SectionHead kicker="ویدیو" title="KAMIX را در عمل ببین" id="kx-videos-title" />
              <div className="kx-videos kx-reveal">
                {videos.map((m, i) => {
                  const embed = videoEmbedUrl(m.url);
                  return (
                    <figure key={i} className="kx-video">
                      {embed ? (
                        <iframe
                          src={embed}
                          title={m.caption || `ویدیوی معرفی ${i + 1}`}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                          allowFullScreen
                          loading="lazy"
                        />
                      ) : (
                        <video
                          src={m.url}
                          poster={m.coverUrl}
                          muted
                          loop
                          playsInline
                          controls
                          preload="none"
                        />
                      )}
                      {m.caption && <figcaption>{m.caption}</figcaption>}
                    </figure>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── Before / after ─────────────────────────────────────────── */}
        <section className="kx-section" aria-labelledby="kx-ba-title">
          <div className="kx-wrap">
            <SectionHead
              kicker="چرا KAMIX"
              title="خداحافظ دفتر و ماشین‌حساب"
              id="kx-ba-title"
              lead="همان کارهای هر روز، فقط خیلی سریع‌تر و بدون اشتباه."
            />
            <div className="kx-ba kx-reveal">
              <div className="kx-ba-card kx-ba-card--old">
                <p className="kx-ba-tag">دفتر کاغذی و اکسل</p>
                <ul>
                  {BEFORE.map((t) => (
                    <li key={t}>
                      <X aria-hidden="true" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="kx-ba-arrow" aria-hidden="true">
                <ArrowLeft />
              </div>
              <div className="kx-ba-card kx-ba-card--new">
                <p className="kx-ba-tag">
                  <KamixMark className="kx-ba-mark" /> با KAMIX
                </p>
                <ul>
                  {AFTER.map((t) => (
                    <li key={t}>
                      <Check aria-hidden="true" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── Everything else ────────────────────────────────────────── */}
        <section
          id="features"
          className="kx-section kx-section--soft"
          aria-labelledby="kx-features-title"
        >
          <div className="kx-wrap">
            <SectionHead
              kicker="همه در یک برنامه"
              title="هر چیزی که مغازه‌ات لازم دارد"
              id="kx-features-title"
            />
            <div className="kx-features">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <article key={f.title} className="kx-feature kx-reveal">
                    <span className="kx-feature-ic">
                      <Icon />
                    </span>
                    <div>
                      <h3>{f.title}</h3>
                      <p>{f.body}</p>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="kx-extras kx-reveal">
              <span className="kx-extras-label">و همچنین:</span>
              {EXTRAS.map((e) => (
                <span key={e} className="kx-extra">
                  {e}
                </span>
              ))}
              {customFeatures.map((f, i) => (
                <span key={`c${i}`} className="kx-extra" title={f.description}>
                  {f.title}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Data safety + proof ─────────────────────────────────────── */}
        <section id="security" className="kx-section kx-trust" aria-labelledby="kx-sec-title">
          <div className="kx-wrap">
            <div className="kx-trust-head kx-reveal">
              <span className="kx-trust-icon" aria-hidden="true">
                <ShieldCheck />
              </span>
              <h2 id="kx-sec-title">خیالت از اطلاعاتت راحت باشد</h2>
              <p>
                فروش و حساب مشتری‌ها سرمایه‌ی توست. KAMIX طوری ساخته شده که با خراب‌شدن گوشی یا کار
                روی چند دستگاه، چیزی از دست نرود.
              </p>
            </div>
            <div className="kx-trust-grid">
              {SECURITY.map((s) => {
                const Icon = s.icon;
                return (
                  <article key={s.title} className="kx-trust-card kx-reveal">
                    <Icon aria-hidden="true" />
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </article>
                );
              })}
            </div>
            {activeBusinesses > 0 && <ActiveCounter target={activeBusinesses} />}
          </div>
        </section>

        {/* ── How to start ───────────────────────────────────────────── */}
        <section id="start" className="kx-section" aria-labelledby="kx-steps-title">
          <div className="kx-wrap">
            <SectionHead kicker="شروع کار" title="شروع در چهار قدم ساده" id="kx-steps-title" />
            <ol className="kx-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="kx-step kx-reveal">
                  <span className="kx-step-n">{faNum(i + 1)}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="kx-steps-cta kx-reveal">
              <Link to="/register" preload={false} className="kx-btn kx-btn--primary kx-btn--lg">
                همین الان ثبت‌نام کن
                <ArrowLeft />
              </Link>
              <a href={APK_DOWNLOAD_URL} className="kx-btn kx-btn--ghost kx-btn--lg" download>
                <Download />
                دانلود اپ اندروید
              </a>
            </div>
          </div>
        </section>

        {/* ── Pricing ────────────────────────────────────────────────── */}
        {visiblePlans.length > 0 && (
          <section
            id="pricing"
            className="kx-section kx-pricing"
            aria-labelledby="kx-pricing-title"
          >
            <div className="kx-wrap">
              <SectionHead
                kicker="قیمت‌ها"
                title="قیمت روشن، بدون هزینه‌ی پنهان"
                id="kx-pricing-title"
                lead="همه‌ی امکانات در همه‌ی پلن‌ها هست؛ پلن‌ها فقط در مدت اعتبار فرق دارند."
              />
              <div className={`kx-plans kx-reveal kx-plans--${visiblePlans.length}`}>
                {visiblePlans.map((p) => (
                  <PlanCard
                    key={p}
                    plan={p}
                    cfg={plansCfg[p]}
                    recommended={p === recommended}
                    now={now}
                    monthlyBase={monthlyBase}
                  />
                ))}
              </div>
              <div className="kx-perks kx-reveal">
                <b>همه‌ی پلن‌ها شامل:</b>
                <ul>
                  {PLAN_PERKS.map((perk) => (
                    <li key={perk}>
                      <Check aria-hidden="true" />
                      {perk}
                    </li>
                  ))}
                </ul>
              </div>
              {guarantee && (
                <div className="kx-guarantee kx-reveal">
                  <ShieldCheck />
                  <div>
                    <b>{guarantee.title}</b>
                    <p>{guarantee.body}</p>
                  </div>
                </div>
              )}
              <p className="kx-pricing-note">
                پرداخت کارت‌به‌کارت در صفحه‌ی ثبت‌نام · فعال‌سازی پس از تأیید رسید
              </p>
            </div>
          </section>
        )}

        {/* ── Testimonials (only real, opt-in quotes from config) ────── */}
        {testimonials.length > 0 && (
          <section className="kx-section kx-section--soft" aria-labelledby="kx-voices-title">
            <div className="kx-wrap">
              <SectionHead
                kicker="از زبان کاربران"
                title="کسب‌وکارهایی که با KAMIX کار می‌کنند"
                id="kx-voices-title"
              />
              <div className="kx-quotes">
                {testimonials.map((t) => (
                  <figure key={t.name} className="kx-quote kx-reveal">
                    <blockquote>«{t.quote}»</blockquote>
                    <figcaption>
                      <b>{t.name}</b>
                      <small>{t.business}</small>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── FAQ ────────────────────────────────────────────────────── */}
        <section id="faq" className="kx-section" aria-labelledby="kx-faq-title">
          <div className="kx-wrap kx-faq-wrap">
            <SectionHead kicker="سؤالات رایج" title="قبل از خرید بدان" id="kx-faq-title" />
            <div className="kx-faq kx-reveal">
              {LANDING_FAQ.map((f) => (
                <details key={f.q} className="kx-faq-item">
                  <summary>
                    <span>{f.q}</span>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Closing CTA ────────────────────────────────────────────── */}
        <section className="kx-section kx-section--tight" aria-labelledby="kx-final-title">
          <div className="kx-wrap">
            <div className="kx-final kx-reveal">
              <Mascot className="kx-final-mascot" />
              <h2 id="kx-final-title">آماده‌ای حساب‌وکتاب مغازه را راحت کنی؟</h2>
              <p>ثبت‌نام چند دقیقه طول می‌کشد و پشتیبانی رایگان در تمام مسیر کنارت است.</p>
              <div className="kx-final-ctas">
                <Link to="/register" preload={false} className="kx-btn kx-btn--white kx-btn--lg">
                  ثبت‌نام در KAMIX
                  <ArrowLeft />
                </Link>
                <Link
                  to="/login"
                  preload={false}
                  className="kx-btn kx-btn--outline-light kx-btn--lg"
                >
                  ورود به حساب
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer id="contact" className="kx-footer">
        <div className="kx-wrap kx-footer-in">
          <div className="kx-footer-brand">
            <div className="kx-brand">
              <KamixMark className="kx-brand-mark" />
              <span className="kx-brand-name">{content.brand_name}</span>
            </div>
            <p>حسابداری فروشگاهی فارسی روی گوشی و وب.</p>
          </div>
          <nav className="kx-footer-col" aria-label="دسترسی سریع">
            <b>دسترسی سریع</b>
            <Link to="/register" preload={false}>
              ثبت‌نام
            </Link>
            <Link to="/login" preload={false}>
              ورود
            </Link>
            <a href="#pricing" onClick={go("pricing")}>
              قیمت‌ها
            </a>
            <a href={APK_DOWNLOAD_URL} download>
              دانلود اپ اندروید
            </a>
          </nav>
          {socials.length > 0 && (
            <div className="kx-footer-col">
              <b>پشتیبانی و مشاوره خرید</b>
              {supportHours && <small>{supportHours}</small>}
              <div className="kx-socials">
                {socials.map((s) => {
                  const Icon = s.icon;
                  return (
                    <a
                      key={s.href}
                      href={s.href}
                      target={s.href.startsWith("http") ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      dir={s.ltr ? "ltr" : undefined}
                    >
                      <Icon />
                      <span>{s.label}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="kx-wrap kx-footer-base">
          © {new Date().getFullYear()} KAMIX — همه‌ی حقوق محفوظ است.
        </div>
      </footer>

      {/* ── Mobile sticky CTA ────────────────────────────────────────── */}
      <div className={`kx-sticky ${pastHero ? "is-on" : ""}`} aria-hidden={!pastHero}>
        <Link
          to="/register"
          preload={false}
          className="kx-btn kx-btn--primary"
          tabIndex={pastHero ? 0 : -1}
        >
          ثبت‌نام و شروع کار
          <ArrowLeft />
        </Link>
      </div>

      {supportHref && (
        <a
          href={supportHref}
          target={supportHref.startsWith("http") ? "_blank" : undefined}
          rel={supportHref.startsWith("http") ? "noopener noreferrer" : undefined}
          aria-label="پشتیبانی رایگان"
          title="پشتیبانی رایگان"
          className={`kx-support ${pastHero ? "is-raised" : ""}`}
        >
          <Headphones />
        </a>
      )}
    </div>
  );
}

function SectionHead({
  kicker,
  title,
  lead,
  id,
}: {
  kicker: string;
  title: ReactNode;
  lead?: string;
  id: string;
}) {
  return (
    <div className="kx-head kx-reveal">
      <p className="kx-kicker">{kicker}</p>
      <h2 id={id}>{title}</h2>
      {lead && <p className="kx-lead">{lead}</p>}
    </div>
  );
}

function Showcase({
  id,
  tone,
  reverse = false,
  step,
  kicker,
  icon: Icon,
  title,
  lead,
  points,
  demo,
}: {
  id: string;
  tone: "sky" | "mint" | "lavender";
  reverse?: boolean;
  step: string;
  kicker: string;
  icon: LucideIcon;
  title: string;
  lead: string;
  points: string[];
  demo: DemoKind;
}) {
  return (
    <section id={id} className={`kx-show kx-show--${tone}`} aria-labelledby={`kx-${id}-title`}>
      <div className={`kx-wrap kx-show-in ${reverse ? "is-reverse" : ""}`}>
        <div className="kx-show-copy kx-reveal">
          <p className="kx-show-kicker">
            <span className="kx-show-step">{step}</span>
            <Icon aria-hidden="true" />
            {kicker}
          </p>
          <h2 id={`kx-${id}-title`}>{title}</h2>
          <p className="kx-lead">{lead}</p>
          <ul className="kx-points">
            {points.map((p) => (
              <li key={p}>
                <Check aria-hidden="true" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="kx-show-demo kx-reveal">
          <DemoSlot kind={demo} />
        </div>
      </div>
    </section>
  );
}

/** Mounts the lazy demo only when the visitor scrolls near it; fixed-size frame avoids layout shift. */
function DemoSlot({ kind }: { kind: DemoKind }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { rootMargin: "600px 0px", once: true });
  const Demo = DEMOS[kind];
  return (
    <div ref={ref} className={`kx-slot kx-slot--${kind}`}>
      {near ? (
        <Suspense fallback={<div className="kx-slot-poster" aria-hidden="true" />}>
          <Demo />
        </Suspense>
      ) : (
        <div className="kx-slot-poster" aria-hidden="true" />
      )}
    </div>
  );
}

function ActiveCounter({ target }: { target: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true });
  const value = useCountUp(target, seen);
  return (
    <div ref={ref} className="kx-counter kx-reveal">
      <span className="kx-counter-num" dir="ltr">
        +<b>{faNum(seen ? value : target)}</b>
      </span>
      <span>کسب‌وکار فعال به KAMIX اعتماد کرده‌اند</span>
    </div>
  );
}
