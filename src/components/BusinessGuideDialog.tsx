/**
 * راهنمای هوشمند کسب‌وکار برای صفحه ورود/ثبت‌نام.
 * - کاملاً استاتیک و بدون هیچ تماس شبکه‌ای/AI — صفر مصرف کردیت.
 * - کاربر نوع کسب‌وکار خود را انتخاب می‌کند (یا آزادانه تایپ می‌کند)
 *   و مزایای مرتبط برنامه را می‌بیند تا ترغیب به خرید اشتراک شود.
 * - فیلد اختیاری است.
 */
import { useMemo, useState } from "react";
import {
  Sparkles, X, ArrowRight, CheckCircle2, TrendingUp,
  Package, Users, FileText, BarChart3, ShieldCheck, Rocket,
} from "lucide-react";

type Benefit = {
  icon: "package" | "users" | "file" | "chart" | "shield" | "rocket" | "trend" | "check";
  title: string;
  detail: string;
};

type Guide = {
  key: string;
  label: string;
  emoji: string;
  keywords: string[];
  intro: string;                 // یک پاراگراف پیچ اختصاصی
  problems: string[];            // «الان چه چالشی داری؟»
  benefits: Benefit[];           // مزایای دقیق و توضیحی
  roi: string;                   // یک جمله برگشت سرمایه
};

const iconMap = {
  package: Package,
  users: Users,
  file: FileText,
  chart: BarChart3,
  shield: ShieldCheck,
  rocket: Rocket,
  trend: TrendingUp,
  check: CheckCircle2,
} as const;

const GUIDES: Guide[] = [
  {
    key: "clothing",
    label: "پوشاک",
    emoji: "👕",
    keywords: ["پوشاک", "لباس", "بوتیک", "مانتو", "کیف", "کفش", "جین"],
    intro:
      "بوتیک و فروشگاه پوشاک با تنوع سایز و رنگ سریع از کنترل خارج می‌شود. KAMIX کاری می‌کند که هر مدل، سایز و رنگ به‌صورت جدا کنترل شود و صندوق‌داری در چند ثانیه با اسکن موبایل انجام گیرد.",
    problems: [
      "نمی‌دونی از هر سایز چند تا مونده و اشتباهی به مشتری می‌گی موجوده",
      "قیمت‌گذاری دستی وقت‌گیر و پرخطاست",
      "نمی‌دونی این فصل کدوم مدل بیشترین سود رو داد",
    ],
    benefits: [
      { icon: "package", title: "بارکد اختصاصی هر مدل/سایز/رنگ",
        detail: "برای هر تنوع محصول بارکد چاپ کن و روی لباس بچسبان؛ صندوق‌داری با اسکن دوربین موبایل انجام می‌شود، بدون خرید دستگاه بارکدخوان." },
      { icon: "check", title: "کنترل جدا موجودی هر سایز و رنگ",
        detail: "دیگر لباس تمام‌شده را به اشتباه نمی‌فروشی؛ هشدار کمبود در لحظه." },
      { icon: "users", title: "باشگاه مشتریان و بدهکاران",
        detail: "مشتریان دائمی و بدهی هرکدام را ثبت کن و لیست بدهکاران را در یک نگاه ببین." },
      { icon: "chart", title: "گزارش پرفروش‌ترین مدل‌ها",
        detail: "سود واقعی هر فصل را ببین تا خرید بعدی‌ات دقیق و هوشمندانه باشد." },
      { icon: "file", title: "فاکتور رسمی PDF با لوگو",
        detail: "فاکتور تمیز و حرفه‌ای برای مشتری بفرست؛ ارسال با پیامک/واتس‌اپ." },
    ],
    roi: "با یک اشتباه انبارگردانی کمتر در ماه، هزینه اشتراک برنامه جبران می‌شود.",
  },
  {
    key: "cafe",
    label: "کافه و رستوران",
    emoji: "☕",
    keywords: ["کافه", "رستوران", "فست فود", "کافی", "قهوه", "بار", "کترینگ"],
    intro:
      "کافه و رستوران به منوی همیشه‌به‌روز و صورتحساب سریع نیاز دارد. KAMIX با منوی دیجیتال QR و فاکتور آنی، تجربه‌ای حرفه‌ای برای مشتری و کنترل کامل برای شما می‌سازد.",
    problems: [
      "قیمت تغییر می‌کند و منوی چاپی قدیمی می‌شود",
      "نمی‌دونی چه ساعت‌هایی و چه آیتم‌هایی بیشترین فروش را دارند",
      "کنترل موجودی مواد اولیه سخت و شلوغ است",
    ],
    benefits: [
      { icon: "rocket", title: "منوی دیجیتال با QR کد",
        detail: "روی هر میز QR بچسبان؛ مشتری اسکن می‌کند و منو با عکس و قیمت باز می‌شود — بدون هزینه چاپ." },
      { icon: "check", title: "بروزرسانی فوری قیمت‌ها",
        detail: "قیمت را در برنامه تغییر بده — همان لحظه در منوی مشتریان دیده می‌شود." },
      { icon: "file", title: "فاکتور سریع میز",
        detail: "محاسبه خودکار مالیات و سرویس، امکان تخفیف و چاپ فوری." },
      { icon: "package", title: "کنترل مواد اولیه",
        detail: "وقتی چیزی رو به اتمام است هشدار می‌گیری تا سفارش به‌موقع بدهی." },
      { icon: "chart", title: "گزارش ساعت‌های اوج و پرفروش‌ها",
        detail: "بفهم چه ساعت‌هایی شلوغ‌تر است و چه آیتم‌هایی بیشترین سود را دارند." },
    ],
    roi: "منوی QR هزینه چاپ مجدد را حذف می‌کند و فروش را به‌طور میانگین بیشتر می‌کند.",
  },
  {
    key: "supermarket",
    label: "سوپرمارکت / خواربار",
    emoji: "🛒",
    keywords: ["سوپر", "خواربار", "بقالی", "هایپر", "مواد غذایی"],
    intro:
      "سوپرمارکت با هزاران کالا و ده‌ها بدهکار محله، بدون یک سیستم دقیق دچار خطای فروش و ضرر پنهان می‌شود. KAMIX موبایل‌محور است و کل کار را از روی گوشی انجام می‌دهی.",
    problems: [
      "بدهی مشتری‌ها را در دفتر می‌نویسی و گم می‌شود",
      "نمی‌دونی کدوم کالاها سود واقعی دارند",
      "خرید بارکدخوان گران است و نمی‌صرفه",
    ],
    benefits: [
      { icon: "package", title: "اسکن بارکد با دوربین موبایل",
        detail: "بدون خرید دستگاه گران، هزاران کالا را اسکن و قیمت‌گذاری کن." },
      { icon: "check", title: "کنترل موجودی هزاران کالا",
        detail: "هشدار کمبود کالا و جلوگیری از فروش ناموجود." },
      { icon: "users", title: "دفتر بدهکاران دیجیتال",
        detail: "بدهی هر مشتری، تاریخ و مبلغ ثبت می‌شود؛ لیست کامل بدهکاران در یک صفحه." },
      { icon: "chart", title: "گزارش سود روزانه و ماهانه",
        detail: "بفهم روی کدوم اجناس واقعاً سود می‌کنی و کدوم فقط دردسر دارند." },
      { icon: "rocket", title: "ورود دسته‌ای از اکسل",
        detail: "برای شروع سریع، کل لیست کالاها را از فایل اکسل وارد کن." },
    ],
    roi: "فقط با پیدا کردن یک بدهی فراموش‌شده در ماه، اشتراک برنامه سود ده است.",
  },
  {
    key: "pharmacy",
    label: "داروخانه / آرایشی بهداشتی",
    emoji: "💊",
    keywords: ["داروخانه", "آرایشی", "بهداشتی", "لوازم آرایش", "عطر"],
    intro:
      "در آرایشی بهداشتی و داروخانه، تعدد برند و کد محصول کار را پیچیده می‌کند. KAMIX هر برند و کد را دقیق کنترل می‌کند و مشتریان دائمی را برای شما نگه می‌دارد.",
    problems: [
      "تعداد برندها زیاد است و کنترل موجودی سخت",
      "مشتری برمی‌گرده و یادت نیست قبلاً چه خریده",
      "نمی‌دونی روی کدوم برند بیشتر سرمایه‌گذاری کنی",
    ],
    benefits: [
      { icon: "package", title: "بارکد و کد اختصاصی هر برند",
        detail: "اسکن بارکد استاندارد یا چاپ بارکد اختصاصی برای محصولات بدون بارکد." },
      { icon: "users", title: "تاریخچه خرید هر مشتری",
        detail: "همیشه بدونی مشتری قبلاً چه خریده و پیشنهاد بهتری بدی." },
      { icon: "chart", title: "گزارش پرفروش‌ترین برندها",
        detail: "سفارش بعدی را بر اساس داده واقعی بده، نه حدس." },
      { icon: "file", title: "فاکتور رسمی با لوگو",
        detail: "فاکتور حرفه‌ای PDF برای مشتریان عمده و همکاران." },
      { icon: "shield", title: "امنیت و پشتیبان ابری",
        detail: "داده‌ها روی گوشی امن و روی سرور پشتیبان‌گیری می‌شود." },
    ],
    roi: "تاریخچه مشتری باعث افزایش خرید تکراری و وفاداری می‌شود.",
  },
  {
    key: "mobile",
    label: "موبایل و لوازم جانبی",
    emoji: "📱",
    keywords: ["موبایل", "گوشی", "لوازم جانبی", "دیجیتال", "کامپیوتر", "لپ‌تاپ"],
    intro:
      "فروشگاه موبایل به کنترل دقیق سریال، گارانتی و سود هر مدل نیاز دارد. KAMIX همه اینها را در یک برنامه موبایل‌محور جمع کرده است.",
    problems: [
      "سریال دستگاه و گارانتی را در کاغذ می‌نویسی",
      "نمی‌دونی سود واقعی هر مدل چقدر است",
      "لوازم جانبی کوچک زیاد است و قیمتشان گم می‌شود",
    ],
    benefits: [
      { icon: "package", title: "بارکد و سریال هر دستگاه",
        detail: "برای هر گوشی/قاب/شارژر بارکد اختصاصی، ثبت سریال و گارانتی." },
      { icon: "check", title: "موجودی هر مدل و رنگ جدا",
        detail: "کنترل دقیق مدل‌ها و رنگ‌ها بدون قاطی‌شدن." },
      { icon: "users", title: "پیگیری گارانتی مشتری",
        detail: "مشتری با شماره تماس یا سریال پیدا می‌شود؛ پیگیری در ثانیه." },
      { icon: "file", title: "فاکتور رسمی با سریال",
        detail: "فاکتور PDF قابل ارسال به مشتری با تمام جزییات دستگاه." },
      { icon: "trend", title: "سود واقعی هر مدل",
        detail: "بفهم روی کدوم مدل واقعاً سود می‌کنی تا سفارش هوشمندانه بدی." },
    ],
    roi: "پیگیری گارانتی حرفه‌ای اعتبار فروشگاه را چند برابر می‌کند.",
  },
  {
    key: "gold",
    label: "طلا و جواهر",
    emoji: "💍",
    keywords: ["طلا", "جواهر", "نقره", "زیورآلات"],
    intro:
      "در طلافروشی نرخ لحظه‌ای، وزن دقیق و اجرت را باید هر ثانیه حساب کنی. KAMIX این محاسبات را خودکار می‌کند و امنیت اطلاعات مالی را تضمین می‌کند.",
    problems: [
      "محاسبه دستی اجرت و مالیات خطاپذیر است",
      "ثبت وزن و مشخصات هر قطعه وقت‌گیر است",
      "نگرانی از گم شدن اطلاعات مشتریان VIP",
    ],
    benefits: [
      { icon: "package", title: "ثبت وزن و اجرت هر قطعه",
        detail: "بارکد اختصاصی برای هر قطعه با وزن، عیار و اجرت ثبت‌شده." },
      { icon: "file", title: "فاکتور خودکار طلا",
        detail: "محاسبه خودکار قیمت طلا × وزن + اجرت + مالیات + سود." },
      { icon: "users", title: "مدیریت مشتریان VIP",
        detail: "تاریخچه خرید هر مشتری، سلیقه و خریدهای قبلی." },
      { icon: "chart", title: "گزارش سود بر اساس نرخ لحظه‌ای",
        detail: "نرخ روز را وارد کن و سود واقعی روزانه را ببین." },
      { icon: "shield", title: "امنیت داده و پشتیبان ابری",
        detail: "اطلاعات حساس با رمزنگاری در پشتیبان امن ذخیره می‌شود." },
    ],
    roi: "حذف خطای محاسبه اجرت در یک فاکتور بزرگ، هزینه سالانه برنامه را جبران می‌کند.",
  },
  {
    key: "bakery",
    label: "قنادی / نانوایی",
    emoji: "🍰",
    keywords: ["قنادی", "شیرینی", "نانوایی", "کیک", "شکلات"],
    intro:
      "قنادی و نانوایی به ثبت سفارش کیک، کنترل مواد اولیه و منوی جذاب نیاز دارد. KAMIX همه این کارها را یکجا انجام می‌دهد.",
    problems: [
      "سفارش کیک روی کاغذ ثبت می‌شود و فراموش می‌شود",
      "کنترل مواد اولیه و کمبود شکر/آرد سخت است",
      "منوی محصولات با عکس ندارید که مشتری راحت انتخاب کند",
    ],
    benefits: [
      { icon: "rocket", title: "منوی دیجیتال با عکس محصول",
        detail: "مشتری با QR منو را می‌بیند و راحت‌تر سفارش می‌دهد." },
      { icon: "file", title: "ثبت سفارش کیک با تاریخ تحویل",
        detail: "سفارش‌ها با تاریخ و مشتری ثبت می‌شود؛ هشدار روز تحویل." },
      { icon: "package", title: "کنترل موجودی مواد اولیه",
        detail: "هشدار کمبود شکر، آرد، شکلات و ... قبل از تمام‌شدن." },
      { icon: "check", title: "فاکتور سریع فروش روزانه",
        detail: "برای فروش تک‌فروشی سریع، بدون معطلی." },
      { icon: "chart", title: "پرفروش‌ترین‌ها هر فصل",
        detail: "بفهم شب یلدا/عید کدوم شیرینی بیشتر می‌فروشد و آماده باش." },
    ],
    roi: "هر سفارش کیک فراموش‌شده که جبران شود، هزینه چند ماه اشتراک است.",
  },
  {
    key: "hardware",
    label: "ابزار و لوازم خانگی",
    emoji: "🔧",
    keywords: ["ابزار", "یراق", "لوازم خانگی", "برقی", "ساختمانی"],
    intro:
      "فروشگاه ابزار و یراق‌آلات با هزاران قطعه کوچک، بدون بارکد کنترل نمی‌شود. KAMIX بارکد و موجودی هر قطعه را دقیق نگه می‌دارد.",
    problems: [
      "قیمت قطعات کوچک گم می‌شود",
      "مشتری عمده بدهکار می‌ماند و پیگیری سخت است",
      "نمی‌دونی چه برند و چه اندازه‌ای بیشتر سود دارد",
    ],
    benefits: [
      { icon: "package", title: "بارکد هر قطعه، حتی کوچک",
        detail: "قیمت هرگز گم نمی‌شود؛ اسکن سریع در صندوق." },
      { icon: "check", title: "کنترل موجودی هر برند و اندازه",
        detail: "دسته‌بندی دقیق برند، اندازه و نوع." },
      { icon: "file", title: "فاکتور عمده و خرده",
        detail: "فاکتور رسمی برای مشتریان عمده با تخفیف و شرایط ویژه." },
      { icon: "users", title: "اعتبار مشتریان دائمی",
        detail: "لیست بدهکاران و اعتبار هر مشتری در یک صفحه." },
      { icon: "chart", title: "گزارش پرفروش برای سفارش هوشمند",
        detail: "خرید بعدی را بر اساس داده واقعی بده." },
    ],
    roi: "پیدا کردن یک بدهی عمده فراموش‌شده، چند سال هزینه برنامه را جبران می‌کند.",
  },
  {
    key: "book",
    label: "کتاب و لوازم‌التحریر",
    emoji: "📚",
    keywords: ["کتاب", "لوازم التحریر", "نوشت‌افزار", "دفتر"],
    intro:
      "کتابفروشی و نوشت‌افزار در فصل مدرسه ترافیک بالایی دارد. KAMIX با اسکن ISBN و مدیریت دقیق موجودی، مهرماه شلوغ را برایتان راحت می‌کند.",
    problems: [
      "هزاران عنوان کتاب و کنترل موجودی سخت",
      "فصل مدرسه شلوغ است و صندوق‌داری کند",
      "نمی‌دونی کدوم لوازم بیشتر می‌فروشد",
    ],
    benefits: [
      { icon: "package", title: "اسکن ISBN استاندارد کتاب",
        detail: "بارکد پشت کتاب مستقیم اسکن می‌شود؛ عنوان و قیمت را وارد کن." },
      { icon: "check", title: "کنترل موجودی هزاران عنوان",
        detail: "هشدار کمبود و آماده‌سازی برای فصل مدرسه." },
      { icon: "file", title: "فاکتور سریع مدرسه/دانشجویی",
        detail: "برای سفارش‌های عمده مدارس، فاکتور و لیست کامل." },
      { icon: "users", title: "مدیریت مشتریان دائمی",
        detail: "مدارس و مشتریان ثابت با اعتبار و بدهی مشخص." },
      { icon: "chart", title: "گزارش فصل تحصیلی",
        detail: "بفهم مهرماه چی بیشتر می‌فروشد و آماده باش." },
    ],
    roi: "یک مهرماه بدون کمبود کالا، سود چند ماه برنامه است.",
  },
];

const GENERIC: Benefit[] = [
  { icon: "package", title: "بارکد اختصاصی برای هر محصول",
    detail: "چاپ بارکد و اسکن با دوربین موبایل، بدون خرید دستگاه گران." },
  { icon: "check", title: "کنترل دقیق موجودی انبار",
    detail: "هشدار کمبود کالا و جلوگیری از فروش ناموجود." },
  { icon: "file", title: "فاکتور رسمی PDF با لوگو",
    detail: "ارسال فاکتور برای مشتری با پیامک و واتس‌اپ." },
  { icon: "users", title: "مدیریت مشتریان و بدهکاران",
    detail: "لیست بدهی هر مشتری در یک صفحه." },
  { icon: "chart", title: "گزارش سود روزانه و ماهانه",
    detail: "پرفروش‌ترین محصولات و سود واقعی هر دسته." },
  { icon: "rocket", title: "کاملاً موبایل‌محور با اپ اندروید",
    detail: "همه چیز از روی گوشی، حتی بدون اینترنت." },
];

const GENERIC_INTRO =
  "KAMIX برای همه صنف‌ها طراحی شده — بارکد، انبار، فاکتور، مشتریان و گزارش سود، همه در یک برنامه موبایل ساده.";

function matchGuide(text: string): Guide | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  for (const g of GUIDES) {
    if (g.keywords.some((k) => t.includes(k.toLowerCase()))) return g;
  }
  return null;
}

export function BusinessGuideDialog() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Guide | null>(null);
  const [customText, setCustomText] = useState("");
  const [showCustomResult, setShowCustomResult] = useState(false);

  const close = () => {
    setOpen(false);
    // پاک‌کردن با تاخیر تا انیمیشن بسته‌شدن دیده نشود
    setTimeout(() => {
      setSelected(null);
      setCustomText("");
      setShowCustomResult(false);
    }, 150);
  };

  const customGuide = useMemo(() => matchGuide(customText), [customText]);

  const activeGuide: Guide | null = selected ?? (showCustomResult ? customGuide : null);
  const showResult = selected != null || showCustomResult;

  const activeBenefits: Benefit[] = activeGuide?.benefits ?? GENERIC;
  const activeIntro: string = activeGuide?.intro ?? GENERIC_INTRO;
  const activeProblems: string[] = activeGuide?.problems ?? [];
  const activeRoi: string | null = activeGuide?.roi ?? null;
  const activeTitle: string = activeGuide
    ? `${activeGuide.emoji} ${activeGuide.label}`
    : `✨ ${customText.trim() || "کسب‌وکار شما"}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary transition hover:bg-primary/15"
      >
        <Sparkles className="h-4 w-4" />
        راهنمای هوشمند: این برنامه برای کسب‌وکار من چه می‌کند؟
      </button>

      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-elegant">
            <div className="flex items-center justify-between border-b border-border bg-gradient-to-l from-primary/10 to-transparent px-5 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold">
                  {showResult ? "برنامه برای کسب‌وکار شما چه می‌کند؟" : "کسب‌وکار شما چیست؟"}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="بستن"
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
              {!showResult && (
                <>
                  <p className="mb-3 text-xs leading-6 text-muted-foreground">
                    یکی از دسته‌ها را انتخاب کنید یا نوع کسب‌وکارتان را بنویسید تا مزایای برنامه را دقیقاً برای شما توضیح دهم.
                    <br />
                    <span className="text-[10px] opacity-70">(اختیاری — می‌توانید بدون پاسخ‌دادن ادامه دهید.)</span>
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    {GUIDES.map((g) => (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setSelected(g)}
                        className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-right text-xs font-semibold text-foreground transition hover:border-primary/40 hover:bg-primary/5"
                      >
                        <span className="text-lg">{g.emoji}</span>
                        <span>{g.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 border-t border-border pt-4">
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      یا خودتان بنویسید:
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={customText}
                        onChange={(e) => setCustomText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && customText.trim()) setShowCustomResult(true);
                        }}
                        placeholder="مثلاً: گل‌فروشی، اسباب‌بازی، ..."
                        className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        disabled={!customText.trim()}
                        onClick={() => setShowCustomResult(true)}
                        className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        نمایش
                      </button>
                    </div>
                  </div>
                </>
              )}

              {showResult && (
                <>
                  <div className="mb-3 rounded-2xl bg-gradient-to-l from-primary/15 to-primary/5 px-4 py-3">
                    <div className="text-base font-extrabold text-primary">{activeTitle}</div>
                    <p className="mt-1.5 text-xs leading-6 text-foreground/90">{activeIntro}</p>
                  </div>

                  {activeProblems.length > 0 && (
                    <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                      <div className="mb-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                        الان این چالش‌ها را داری؟
                      </div>
                      <ul className="space-y-1">
                        {activeProblems.map((p, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11px] leading-6 text-foreground/80">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mb-2 text-[11px] font-bold text-muted-foreground">
                    KAMIX برای شما این کارها را می‌کند:
                  </div>
                  <ul className="space-y-2">
                    {activeBenefits.map((b, i) => {
                      const Icon = iconMap[b.icon];
                      return (
                        <li key={i} className="flex items-start gap-2.5 rounded-xl border border-border bg-background px-3 py-2.5">
                          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-foreground">{b.title}</div>
                            <div className="mt-0.5 text-[11px] leading-6 text-muted-foreground">{b.detail}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {activeRoi && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                      <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <p className="text-[11px] leading-6 text-emerald-800 dark:text-emerald-200">
                        <strong>برگشت سرمایه: </strong>{activeRoi}
                      </p>
                    </div>
                  )}

                  {showCustomResult && !customGuide && (
                    <p className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-[11px] leading-6 text-muted-foreground">
                      برای «{customText.trim()}» دسته‌ی دقیق نداشتم، ولی موارد بالا برای هر فروشگاهی کاربردی است.
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setShowCustomResult(false);
                      setCustomText("");
                    }}
                    className="mt-3 w-full rounded-xl border border-border bg-background py-2 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    بازگشت به انتخاب کسب‌وکار
                  </button>
                </>
              )}
            </div>

            <div className="border-t border-border bg-muted/40 px-5 py-2.5 text-center text-[11px] text-muted-foreground">
              پس از ثبت‌نام و ورود، تمام این امکانات در دسترس شماست.
            </div>
          </div>
        </div>
      )}
    </>
  );
}