/**
 * KAMIX landing page — shown only to web visitors who are not signed in
 * (AuthGuard decides; inside the Android app it is hidden by `html[data-app]`).
 *
 * Structure: hero → signature features (voice, camera, assistant) with
 * self-playing demos → everything else → vs. paper/Excel → data safety →
 * how to start → pricing → FAQ → closing CTA → contact/footer.
 *
 * Performance: the page stylesheet is loaded only when this component renders
 * (React-hoisted <link>), and the animated demos live in a separate lazy chunk
 * that loads when the visitor scrolls near them. Every CTA keeps the same
 * destination as before: /register, /login, plan cards → /register.
 */
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  Cloud,
  Coins,
  Download,
  FileSpreadsheet,
  Fingerprint,
  GraduationCap,
  HardDriveDownload,
  Instagram,
  KeyRound,
  Layers,
  Mail,
  MessageCircle,
  Mic,
  Package,
  Phone,
  PlayCircle,
  QrCode,
  Receipt,
  RefreshCw,
  ScanLine,
  Search,
  Send,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Users,
  Wallet,
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
import { PlanCard } from "@/components/landing/Pricing";
import { PAID_PLANS, pickRecommendedPlan } from "@/components/landing/pricing-utils";
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
  { id: "signature", label: "قابلیت‌ها" },
  { id: "features", label: "امکانات" },
  { id: "security", label: "امنیت" },
  { id: "pricing", label: "قیمت‌ها" },
  { id: "faq", label: "سؤالات" },
];

const MODULES: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Receipt, label: "فاکتور فروش" },
  { icon: ShoppingCart, label: "فاکتور خرید" },
  { icon: Package, label: "انبار و موجودی" },
  { icon: Users, label: "مشتریان و بدهکاران" },
  { icon: Wallet, label: "هزینه‌ها" },
  { icon: BarChart3, label: "گزارش سود" },
  { icon: FileSpreadsheet, label: "خروجی اکسل و PDF" },
  { icon: Bell, label: "یادآوری و چک" },
  { icon: QrCode, label: "منوی دیجیتال QR" },
  { icon: Store, label: "سایت فروشگاه" },
  { icon: Coins, label: "نرخ طلا و سکه" },
  { icon: GraduationCap, label: "هنرجو و شهریه" },
  { icon: Layers, label: "تولید و فرمول" },
  { icon: CalendarDays, label: "تقویم شمسی" },
];

type Feature = { icon: LucideIcon; title: string; body: string; wide?: boolean };

const FEATURES: Feature[] = [
  {
    icon: Receipt,
    title: "فاکتور حرفه‌ای در چند ثانیه",
    body: "فاکتور فروش و خرید با تخفیف، چند روش پرداخت و ثبت چک. طرح فاکتور را خودت تنظیم کن، چاپ رسید بگیر یا PDF و پیامش را برای مشتری بفرست.",
    wide: true,
  },
  {
    icon: Users,
    title: "مشتریان، بدهکاران و طلبکاران",
    body: "مانده‌ی هر مشتری، سررسید بدهی‌ها و چک‌ها با یادآوری؛ متن پیام یادآوری بدهی برای پیامک و واتساپ آماده است.",
  },
  {
    icon: Package,
    title: "انبار که خودش حساب می‌کند",
    body: "با هر فروش و خرید موجودی به‌روز می‌شود و کالاهای رو به اتمام را می‌بینی. ورود گروهی کالا از اکسل و تغییر گروهی قیمت.",
  },
  {
    icon: BarChart3,
    title: "سود واقعی، نه حدس",
    body: "فروش، سود و هزینه‌ها به تفکیک روز، هفته و ماه شمسی؛ پرسودترین کالا و بهترین مشتری را ببین.",
  },
  {
    icon: HardDriveDownload,
    wide: true,
    title: "خروجی و پشتیبان",
    body: "از محصولات، مشتریان، فاکتورها و همه‌ی اطلاعات کسب‌وکار خروجی اکسل، PDF یا فایل پشتیبان کامل بگیر.",
  },
  {
    icon: Store,
    title: "ویترین آنلاین فروشگاه",
    body: "صفحه‌ی معرفی فروشگاه و منوی دیجیتال با QR کد اختصاصی، ساخته‌شده از همان محصولاتی که ثبت کرده‌ای.",
  },
  {
    icon: Bell,
    title: "برنامه‌ی هفته و یادآوری",
    body: "یادآوری با تاریخ شمسی و ساعت؛ سررسید چک‌ها و بدهی‌ها از یادت نمی‌رود.",
  },
  {
    icon: Search,
    title: "جستجوی فوری و تاریخچه",
    body: "کالا، مشتری، فاکتور یا بدهکار را با چند حرف پیدا کن؛ تاریخچه‌ی کامل فاکتورها همیشه در دسترس است.",
  },
  {
    icon: Coins,
    title: "ویژه‌ی صنف‌های خاص",
    body: "نرخ لحظه‌ای طلا و سکه برای طلافروش‌ها، هنرجو و شهریه برای آموزشگاه‌ها، و تولید و فرمول برای کارگاه‌ها.",
    wide: true,
  },
];

const COMPARE: Array<{ label: string; paper: boolean | string; kamix: string }> = [
  { label: "ثبت فاکتور", paper: "دستی، با خودکار یا تایپ", kamix: "با صدا، بارکد یا چند لمس" },
  {
    label: "پیدا کردن قیمت کالا",
    paper: "حفظی یا ورق‌زدن دفتر",
    kamix: "اسکن بارکد با دوربین گوشی",
  },
  { label: "جمع حساب و سود روز", paper: "ماشین‌حساب آخر شب", kamix: "لحظه‌ای؛ از دستیار بپرس" },
  { label: "مانده‌ی بدهکارها", paper: "پراکنده در دفتر", kamix: "برای هر مشتری، با یادآوری" },
  { label: "موجودی انبار", paper: false, kamix: "خودکار با هر فروش و خرید" },
  { label: "اگر دفتر/فایل گم شود", paper: "اطلاعات از دست می‌رود", kamix: "روی حساب ابری می‌ماند" },
  { label: "کار با چند دستگاه", paper: false, kamix: "همگام، با یک حساب" },
];

const SECURITY: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Cloud,
    title: "نسخه‌ی ابری از هر حساب",
    body: "اطلاعات روی گوشی ذخیره و روی سرور هم نگه‌داری می‌شود؛ با خراب یا گم‌شدن گوشی چیزی از دست نمی‌رود.",
  },
  {
    icon: RefreshCw,
    title: "همگام‌سازی بدون پاک‌شدن",
    body: "ثبت‌های چند دستگاه ردیف‌به‌ردیف ادغام می‌شوند؛ ذخیره‌ی یک دستگاه کار دستگاه دیگر را پاک نمی‌کند.",
  },
  {
    icon: Fingerprint,
    title: "هر حساب، فقط داده‌ی خودش",
    body: "دسترسی به اطلاعات در سطح پایگاه داده به صاحب همان حساب محدود است.",
  },
  {
    icon: HardDriveDownload,
    title: "پشتیبان در دست خودت",
    body: "هر زمان خروجی اکسل، PDF یا فایل کامل JSON بگیر و جایی که می‌خواهی نگه دار.",
  },
];

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: "ثبت‌نام و انتخاب پلن",
    body: "نام کاربری و رمزت را انتخاب کن و پلنی که می‌خواهی را بردار؛ چند دقیقه بیشتر طول نمی‌کشد.",
  },
  {
    title: "پرداخت و ارسال رسید",
    body: "مبلغ را کارت‌به‌کارت واریز کن و عکس رسید یا کد پیگیری را همان‌جا بفرست.",
  },
  {
    title: "تأیید و فعال‌سازی",
    body: "پرداخت بررسی و حسابت فعال می‌شود؛ با همان نام کاربری و رمز وارد می‌شوی.",
  },
  {
    title: "اولین فاکتور با صدا",
    body: "اپ اندروید را نصب کن یا از مرورگر وارد شو، محصولاتت را اضافه کن و اولین فاکتور را بگو.",
  },
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
    "حسابداری فروشگاهی فارسی با ثبت فاکتور با صدا، اسکن بارکد با دوربین گوشی، دستیار هوشمند، انبار، مشتریان و گزارش سود.",
});

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<LandingContent>(DEFAULT_LANDING);
  const [plansCfg, setPlansCfg] = useState<PlansConfig>(DEFAULT_PLANS);
  const [now, setNow] = useState(() => Date.now());
  const [scrolled, setScrolled] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
        setScrolled(y > 12);
        setPastHero(y > window.innerHeight * 0.85);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

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
    setMenuOpen(false);
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

      {/* ── Header ─────────────────────────────────────────────────────── */}
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
            <span className="kx-brand-text">
              <strong>{content.brand_name}</strong>
              <small>حسابداری کامیکس</small>
            </span>
          </a>

          <nav className="kx-nav" aria-label="بخش‌های صفحه">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={go(n.id)}>
                {n.label}
              </a>
            ))}
          </nav>

          <div className="kx-header-actions">
            <Link to="/login" preload={false} className="kx-link-login">
              ورود
            </Link>
            <Link to="/register" preload={false} className="kx-btn kx-btn--primary kx-btn--sm">
              شروع کن
              <ArrowLeft />
            </Link>
            <button
              type="button"
              className="kx-menu-btn"
              aria-label={menuOpen ? "بستن منو" : "باز کردن منو"}
              aria-expanded={menuOpen}
              aria-controls="kx-mobile-nav"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X /> : <span className="kx-burger" aria-hidden="true" />}
            </button>
          </div>
        </div>
        <nav
          id="kx-mobile-nav"
          className={`kx-mobile-nav ${menuOpen ? "is-open" : ""}`}
          aria-label="منوی صفحه"
          hidden={!menuOpen}
        >
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} onClick={go(n.id)}>
              {n.label}
            </a>
          ))}
          <Link to="/login" preload={false} className="kx-mobile-login">
            ورود به حساب
          </Link>
        </nav>
      </header>

      <main id="main">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="kx-hero" aria-labelledby="kx-hero-title">
          <div className="kx-hero-bg" aria-hidden="true">
            <span className="kx-aurora kx-aurora--1" />
            <span className="kx-aurora kx-aurora--2" />
            <span className="kx-aurora kx-aurora--3" />
            <span className="kx-grid" />
          </div>
          <div className="kx-wrap kx-hero-in">
            <div className="kx-hero-copy">
              <p className="kx-eyebrow kx-enter" style={{ animationDelay: "0.05s" }}>
                <span className="kx-eyebrow-dot" />
                حسابداری هوشمند فارسی برای فروشگاه و کسب‌وکار
              </p>
              <h1
                id="kx-hero-title"
                className="kx-hero-title kx-enter"
                style={{ animationDelay: "0.12s" }}
              >
                فاکتور را <span className="kx-grad">بگو</span>، بارکد را{" "}
                <span className="kx-grad">نشان بده</span>، حساب را{" "}
                <span className="kx-grad">بپرس</span>.
              </h1>
              <p className="kx-hero-lead kx-enter" style={{ animationDelay: "0.2s" }}>
                KAMIX حسابداری کسب‌وکارت را به گوشی می‌آورد: ثبت فاکتور با صدا، اسکن بارکد با دوربین
                و دستیاری که سود، فروش و بدهکارهایت را به فارسی جواب می‌دهد. بدون دفتر، بدون
                بارکدخوان، بدون نصب ویندوزی.
              </p>
              <div className="kx-hero-ctas kx-enter" style={{ animationDelay: "0.28s" }}>
                <Link to="/register" preload={false} className="kx-btn kx-btn--primary kx-btn--lg">
                  همین الان شروع کن
                  <ArrowLeft />
                </Link>
                <a
                  href="#signature"
                  className="kx-btn kx-btn--glass kx-btn--lg"
                  onClick={go("signature")}
                >
                  <PlayCircle />
                  ببین چطور کار می‌کند
                </a>
              </div>
              <p className="kx-hero-login kx-enter" style={{ animationDelay: "0.32s" }}>
                قبلاً حساب داری؟{" "}
                <Link to="/login" preload={false}>
                  وارد شو
                </Link>
              </p>
              <ul className="kx-hero-proof kx-enter" style={{ animationDelay: "0.38s" }}>
                {activeBusinesses > 0 && (
                  <li>
                    <Users />
                    <span>
                      <b>بیش از {faNum(activeBusinesses)}</b> کسب‌وکار فعال
                    </span>
                  </li>
                )}
                <li>
                  <Smartphone />
                  <span>اپ اندروید + نسخه‌ی وب</span>
                </li>
                <li>
                  <CalendarDays />
                  <span>تاریخ شمسی و تومان</span>
                </li>
              </ul>
            </div>
            <div className="kx-hero-visual kx-enter" style={{ animationDelay: "0.25s" }}>
              <HeroVisual />
            </div>
          </div>

          <div className="kx-marquee" aria-label="بخش‌های برنامه">
            <ul className="kx-marquee-track">
              {[...MODULES, ...MODULES].map((m, i) => {
                const Icon = m.icon;
                return (
                  <li key={i} aria-hidden={i >= MODULES.length ? "true" : undefined}>
                    <Icon />
                    {m.label}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ── Signature features ─────────────────────────────────────── */}
        <section id="signature" className="kx-section kx-sig-intro" aria-labelledby="kx-sig-title">
          <div className="kx-wrap">
            <SectionHead
              kicker="سه کاری که هیچ دفتر حسابی برایت نمی‌کرد"
              title="سریع‌تر از نوشتن. دقیق‌تر از حافظه."
              id="kx-sig-title"
              lead="سه روش ورود که KAMIX را از یک نرم‌افزار حسابداری معمولی جدا می‌کند. هر سه را همین پایین، همان‌طور که در برنامه کار می‌کنند، ببین."
            />
            <div className="kx-sig-cards kx-reveal">
              <SigCard
                href="voice"
                icon={Mic}
                tone="blue"
                title="فاکتور با صدا"
                body="بگو چه فروختی؛ ردیف‌های فاکتور خودشان نوشته می‌شوند."
                onGo={go}
              />
              <SigCard
                href="scan"
                icon={ScanLine}
                tone="cyan"
                title="اسکن با دوربین"
                body="بارکد را جلوی دوربین بگیر؛ کالا با قیمتش اضافه می‌شود."
                onGo={go}
              />
              <SigCard
                href="assistant"
                icon={Sparkles}
                tone="violet"
                title="دستیار هوشمند"
                body="بپرس سود امروز چقدر شد یا بگو بدهی مشتری را ثبت کند."
                onGo={go}
              />
            </div>
          </div>
        </section>

        <Showcase
          id="voice"
          tone="light"
          kicker="فاکتور با صدا"
          icon={Mic}
          title={
            <>
              فاکتور را <span className="kx-grad">بگو</span>، نه بنویس.
            </>
          }
          lead="وسط شلوغی مغازه، وقت تایپ نیست. میکروفون را بزن و بگو «دو تا پیراهن مردانه». KAMIX کالا را از فهرست محصولاتت پیدا می‌کند، تعداد و قیمت را می‌نشاند و جمع فاکتور را حساب می‌کند."
          points={[
            "عدد و مبلغ فارسی را می‌فهمد؛ «دو تا»، «۲۵۰ هزار»، «یه»",
            "کالا را از فهرست محصولات خودت پیدا می‌کند و اگر چند مورد شبیه بود، می‌پرسد",
            "ثبت صوتی محصولات جدید با تعداد و قیمت هم دارد",
            "جایی که نمی‌شود حرف زد؟ همان جمله را تایپ کن",
          ]}
          demo="voice"
        />

        <Showcase
          id="scan"
          tone="dark"
          reverse
          kicker="اسکن بارکد با دوربین"
          icon={ScanLine}
          title={
            <>
              دوربین گوشی‌ات، <span className="kx-grad">بارکدخوان</span> توست.
            </>
          }
          lead="لازم نیست دستگاه بارکدخوان بخری. بارکد یا QR کالا را جلوی دوربین بگیر؛ KAMIX در کسری از ثانیه آن را می‌شناسد و کالا با قیمتش به فاکتور جاری اضافه می‌شود."
          points={[
            "خواندن بارکدهای رایج کالا و QR کد",
            "اسکن پشت‌سرهم برای فاکتورهای چندقلمی",
            "برای کالاهای بی‌بارکد، برچسب بارکد بساز و چاپ کن",
            "ثبت سریع محصولات جدید با اسکن",
          ]}
          demo="scan"
        />

        <Showcase
          id="assistant"
          tone="tint"
          kicker="دستیار هوشمند"
          icon={Sparkles}
          title={
            <>
              از حسابت <span className="kx-grad">بپرس</span>. جواب بگیر.
            </>
          }
          lead="«امروز چقدر سود داشتم؟»، «آقای شهریاری ۲۵۰ هزار تومان بدهکار است»، «یادآوری پرداخت چک فردا ساعت ۱۰». با صدا یا تایپ بگو؛ دستیار از روی داده‌های خود حسابت جواب می‌دهد یا کار را برایت ثبت می‌کند."
          points={[
            "گزارش‌ها: سود، فروش، هزینه، پرسودترین کالا، بهترین مشتری",
            "حساب مشتری: ثبت بدهی و تسویه، مانده‌ی هر نفر، فهرست بدهکارها",
            "کارها: ثبت هزینه، یادآوری با تاریخ شمسی، تغییر قیمت، افزودن کالا",
            "پاسخ‌ها از روی اطلاعات خودت محاسبه می‌شوند؛ عدد ساختگی نمی‌دهد",
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
              <SectionHead
                kicker="ویدیو"
                title="KAMIX را در عمل ببین"
                id="kx-videos-title"
                lead="ویدیوها روی آپارات یا یوتیوب پخش می‌شوند؛ چیزی سنگین دانلود نمی‌شود."
              />
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

        {/* ── Everything else ────────────────────────────────────────── */}
        <section id="features" className="kx-section" aria-labelledby="kx-features-title">
          <div className="kx-wrap">
            <SectionHead
              kicker="همه در یک برنامه"
              title="هر چه یک کسب‌وکار هر روز لازم دارد"
              id="kx-features-title"
              lead="از فاکتور و انبار تا بدهکارها و گزارش سود؛ با تاریخ شمسی، تومان و زبان خودمان."
            />
            <div className="kx-bento">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <article
                    key={f.title}
                    className={`kx-feature kx-reveal ${f.wide ? "is-wide" : ""}`}
                  >
                    <span className="kx-feature-ic">
                      <Icon />
                    </span>
                    <h3>{f.title}</h3>
                    <p>{f.body}</p>
                  </article>
                );
              })}
            </div>
            {customFeatures.length > 0 && (
              <ul className="kx-extra-features kx-reveal">
                {customFeatures.map((f, i) => (
                  <li key={i}>
                    <Check />
                    <span>
                      <b>{f.title}</b>
                      {f.description && <> — {f.description}</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ── Comparison ─────────────────────────────────────────────── */}
        <section className="kx-section kx-section--muted" aria-labelledby="kx-compare-title">
          <div className="kx-wrap kx-compare-wrap">
            <SectionHead
              kicker="چرا KAMIX"
              title="فرق یک دفتر حساب با یک دستیار حسابداری"
              id="kx-compare-title"
              lead="دفتر کاغذی و فایل اکسل فقط می‌نویسند. KAMIX می‌شنود، می‌بیند، حساب می‌کند و یادت می‌اندازد."
            />
            <div
              className="kx-compare kx-reveal"
              role="table"
              aria-label="مقایسه‌ی KAMIX با دفتر کاغذی و اکسل"
            >
              <div className="kx-compare-row kx-compare-head" role="row">
                <span role="columnheader">کار روزانه</span>
                <span role="columnheader">دفتر کاغذی و اکسل</span>
                <span role="columnheader">
                  <KamixMark className="kx-compare-mark" /> KAMIX
                </span>
              </div>
              {COMPARE.map((r) => (
                <div key={r.label} className="kx-compare-row" role="row">
                  <span role="rowheader">{r.label}</span>
                  <span role="cell" className="kx-compare-old">
                    {r.paper === false ? (
                      <>
                        <X aria-hidden="true" /> ندارد
                      </>
                    ) : (
                      r.paper
                    )}
                  </span>
                  <span role="cell" className="kx-compare-new">
                    <Check aria-hidden="true" /> {r.kamix}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Security & data safety ─────────────────────────────────── */}
        <section id="security" className="kx-section kx-security" aria-labelledby="kx-sec-title">
          <div className="kx-wrap kx-security-in">
            <div className="kx-security-copy kx-reveal">
              <p className="kx-kicker kx-kicker--light">
                <ShieldCheck /> امنیت و نگهداری اطلاعات
              </p>
              <h2 id="kx-sec-title">حساب کسب‌وکارت، امن و همیشه در دسترس.</h2>
              <p>
                اطلاعات فروش و بدهکارهای تو سرمایه‌ی توست. KAMIX طوری ساخته شده که با خراب‌شدن گوشی،
                کار هم‌زمان روی چند دستگاه یا قطع موقت اینترنت، چیزی از دست نرود.
              </p>
              <div className="kx-lock" aria-hidden="true">
                <span className="kx-lock-ring" />
                <span className="kx-lock-ring kx-lock-ring--2" />
                <span className="kx-lock-core">
                  <KeyRound />
                </span>
              </div>
            </div>
            <div className="kx-security-grid">
              {SECURITY.map((s) => {
                const Icon = s.icon;
                return (
                  <article key={s.title} className="kx-sec-card kx-reveal">
                    <span className="kx-sec-ic">
                      <Icon />
                    </span>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── How to start ───────────────────────────────────────────── */}
        <section id="start" className="kx-section" aria-labelledby="kx-steps-title">
          <div className="kx-wrap">
            <SectionHead
              kicker="شروع کار"
              title="از ثبت‌نام تا اولین فاکتور"
              id="kx-steps-title"
              lead="بدون نصب پیچیده و بدون آموزش طولانی. این تمام مسیر است."
            />
            <ol className="kx-steps">
              {STEPS.map((s, i) => (
                <li
                  key={s.title}
                  className="kx-step kx-reveal"
                  style={{ transitionDelay: `${i * 80}ms` }}
                >
                  <span className="kx-step-n">{faNum(i + 1)}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
            <div className="kx-steps-cta kx-reveal">
              <Link to="/register" preload={false} className="kx-btn kx-btn--primary kx-btn--lg">
                قدم اول: ثبت‌نام
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
                title="یک قیمت روشن. همه‌ی امکانات در همه‌ی پلن‌ها."
                id="kx-pricing-title"
                lead="قیمت نهایی همان است که می‌بینی؛ بدون هزینه‌ی پنهان. پلن‌ها فقط در مدت اعتبار فرق دارند."
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
          <section className="kx-section kx-section--muted" aria-labelledby="kx-voices-title">
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
            <SectionHead
              kicker="سؤالات پیش از خرید"
              title="هر سؤالی قبل از پرداخت داری"
              id="kx-faq-title"
            />
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
              <div className="kx-final-bg" aria-hidden="true" />
              <KamixMark className="kx-final-mark" />
              <h2 id="kx-final-title">دفتر را ببند. از امروز با KAMIX بفروش.</h2>
              <p>
                ثبت‌نام چند دقیقه طول می‌کشد. بعد از فعال‌سازی، اولین فاکتورت را با صدا بگو.
                {activeBusinesses > 0 && (
                  <>
                    {" "}
                    به بیش از {faNum(activeBusinesses)} کسب‌وکاری بپیوند که همین حالا با KAMIX کار
                    می‌کنند.
                  </>
                )}
              </p>
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

        {activeBusinesses > 0 && <ActiveCounter target={activeBusinesses} />}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer id="contact" className="kx-footer">
        <div className="kx-wrap kx-footer-in">
          <div className="kx-footer-brand">
            <div className="kx-brand">
              <KamixMark className="kx-brand-mark" />
              <span className="kx-brand-text">
                <strong>{content.brand_name}</strong>
                <small>حسابداری کامیکس</small>
              </span>
            </div>
            <p>
              حسابداری فروشگاهی فارسی روی موبایل و وب؛ فاکتور با صدا، اسکن بارکد با دوربین و دستیار
              هوشمند.
            </p>
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
          شروع با KAMIX
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
          <Phone />
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

function SigCard({
  href,
  icon: Icon,
  tone,
  title,
  body,
  onGo,
}: {
  href: string;
  icon: LucideIcon;
  tone: "blue" | "cyan" | "violet";
  title: string;
  body: string;
  onGo: (id: string) => (e: React.MouseEvent) => void;
}) {
  return (
    <a href={`#${href}`} className={`kx-sig kx-sig--${tone}`} onClick={onGo(href)}>
      <span className="kx-sig-ic">
        <Icon />
      </span>
      <b>{title}</b>
      <span>{body}</span>
      <span className="kx-sig-more">
        نمایش زنده <ArrowLeft />
      </span>
    </a>
  );
}

function Showcase({
  id,
  tone,
  reverse = false,
  kicker,
  icon: Icon,
  title,
  lead,
  points,
  demo,
}: {
  id: string;
  tone: "light" | "dark" | "tint";
  reverse?: boolean;
  kicker: string;
  icon: LucideIcon;
  title: ReactNode;
  lead: string;
  points: string[];
  demo: DemoKind;
}) {
  return (
    <section id={id} className={`kx-show kx-show--${tone}`} aria-labelledby={`kx-${id}-title`}>
      <div className={`kx-wrap kx-show-in ${reverse ? "is-reverse" : ""}`}>
        <div className="kx-show-copy kx-reveal">
          <p className="kx-kicker">
            <Icon /> {kicker}
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
          <Link to="/register" preload={false} className="kx-btn kx-btn--primary">
            می‌خواهم این را داشته باشم
            <ArrowLeft />
          </Link>
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
    <div ref={ref} className="kx-wrap kx-counter kx-reveal">
      <span className="kx-counter-pulse" aria-hidden="true" />
      <Users aria-hidden="true" />
      <span>
        بیش از <b>{faNum(seen ? value : target)}</b> کسب‌وکار فعال در KAMIX
      </span>
    </div>
  );
}
