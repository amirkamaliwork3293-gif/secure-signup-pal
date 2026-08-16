/**
 * راهنمای هوشمند کسب‌وکار — نسخه‌ی صفحه‌ی معرفی (Landing).
 * - کاملاً استاتیک و بدون هیچ تماس شبکه‌ای/AI — صفر مصرف کردیت.
 * - کاربر نوع کسب‌وکار خود را انتخاب می‌کند (یا آزادانه تایپ می‌کند)
 *   و یک تحلیل اختصاصی + مزایای دقیق برنامه را می‌بیند تا ترغیب به
 *   ثبت‌نام و خرید اشتراک شود.
 * - جایگزین نسخه‌ی قبلی (BusinessGuideDialog) که به‌صورت یک دکمه‌ی
 *   کوچک در صفحه‌ی ورود بود؛ اینجا یک بخش کامل و برجسته در صفحه‌ی
 *   معرفی است تا بازدیدکننده قبل از ثبت‌نام، ارزش برنامه را برای
 *   کسب‌وکار خودش دقیقاً ببیند.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight, ArrowLeft, CheckCircle2, TrendingUp, XCircle,
  Package, Users, FileText, BarChart3, ShieldCheck, Rocket, Clock,
  Mic, Globe, ChevronLeft, ChevronRight, Receipt,
} from "lucide-react";

type Benefit = {
  icon: "package" | "users" | "file" | "chart" | "shield" | "rocket" | "trend" | "check" | "mic" | "globe";
  title: string;
  detail: string;
};

type Guide = {
  key: string;
  label: string;
  emoji: string;
  keywords: string[];
  intro: string;
  problems: string[];
  benefits: Benefit[];
  roi: string;
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
  mic: Mic,
  globe: Globe,
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
  { icon: "mic", title: "ثبت فاکتور با صدا",
    detail: "کافیه حرف بزنی؛ فاکتور خودش با صدای تو ثبت می‌شود، بدون تایپ." },
  { icon: "check", title: "کنترل دقیق موجودی انبار",
    detail: "هشدار کمبود کالا و جلوگیری از فروش ناموجود." },
  { icon: "file", title: "فاکتور رسمی PDF با لوگو",
    detail: "ارسال فاکتور برای مشتری با پیامک و واتس‌اپ." },
  { icon: "users", title: "مدیریت مشتریان و بدهکاران",
    detail: "لیست بدهی هر مشتری در یک صفحه." },
  { icon: "chart", title: "گزارش سود روزانه و ماهانه",
    detail: "پرفروش‌ترین محصولات و سود واقعی هر دسته." },
  { icon: "globe", title: "سایت تک‌صفحه‌ای معرفی فروشگاه",
    detail: "یک صفحه‌ی آنلاین حرفه‌ای برای معرفی فروشگاهت، آماده و رایگان." },
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

function suggestGuides(text: string): Guide[] {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const ranked: Array<{ g: Guide; score: number }> = [];
  for (const g of GUIDES) {
    const label = g.label.toLowerCase();
    if (label.includes(t) || t.includes(label)) {
      ranked.push({ g, score: 3 });
      continue;
    }
    const hit = g.keywords.find((k) => k.toLowerCase().includes(t) || t.includes(k.toLowerCase()));
    if (hit) ranked.push({ g, score: hit.length === t.length ? 2 : 1 });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.g);
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SmartBusinessGuide() {
  const [selected, setSelected] = useState<Guide | null>(null);
  const [customText, setCustomText] = useState("");
  const [showCustomResult, setShowCustomResult] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, on: false });
  const [canScroll, setCanScroll] = useState(false);

  const shelfRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const suggestBoxId = "sg-suggest-list";

  const customGuide = useMemo(() => matchGuide(customText), [customText]);
  const suggestions = useMemo(() => suggestGuides(customText), [customText]);
  const activeGuide: Guide | null = selected ?? (showCustomResult ? customGuide : null);
  const showResult = selected != null || showCustomResult;

  const activeBenefits: Benefit[] = activeGuide?.benefits ?? GENERIC;
  const activeIntro: string = activeGuide?.intro ?? GENERIC_INTRO;
  const activeProblems: string[] = activeGuide?.problems ?? [];
  const activeRoi: string | null = activeGuide?.roi ?? null;
  const activeTitle: string = activeGuide
    ? `${activeGuide.emoji} ${activeGuide.label}`
    : `${customText.trim() || "کسب‌وکار شما"}`;
  const printKey = selected?.key ?? (showCustomResult ? `custom:${customText.trim()}` : "");

  const pickGuide = (g: Guide) => {
    setSelected(g);
    setShowCustomResult(false);
    setSuggestOpen(false);
    setActiveIdx(-1);
  };

  const submitCustom = () => {
    if (!customText.trim()) return;
    if (activeIdx >= 0 && suggestions[activeIdx]) {
      pickGuide(suggestions[activeIdx]);
      setCustomText("");
      return;
    }
    const hit = matchGuide(customText);
    if (hit) {
      pickGuide(hit);
      return;
    }
    setSelected(null);
    setShowCustomResult(true);
    setSuggestOpen(false);
  };

  const reset = () => {
    setSelected(null);
    setShowCustomResult(false);
    setCustomText("");
    setSuggestOpen(false);
    setActiveIdx(-1);
    shelfRef.current?.scrollTo({ left: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  const measureIndicator = () => {
    const key = selected?.key;
    const card = key ? cardRefs.current[key] : null;
    const track = trackRef.current;
    if (!card || !track) {
      setIndicator((s) => ({ ...s, on: false }));
      return;
    }
    setIndicator({ left: card.offsetLeft, width: card.offsetWidth, on: true });
  };

  useLayoutEffect(() => {
    measureIndicator();
  }, [selected]);

  useEffect(() => {
    const shelf = shelfRef.current;
    if (!shelf) return;
    const update = () => {
      setCanScroll(shelf.scrollWidth > shelf.clientWidth + 8);
      measureIndicator();
    };
    update();
    shelf.addEventListener("scroll", measureIndicator, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      shelf.removeEventListener("scroll", measureIndicator);
      window.removeEventListener("resize", update);
    };
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const card = cardRefs.current[selected.key];
    card?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [selected]);

  const scrollShelf = (dir: 1 | -1) => {
    const el = shelfRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * 220,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && suggestions.length > 0) {
      e.preventDefault();
      setSuggestOpen(true);
      setActiveIdx((i) => (i + 1) % suggestions.length);
      return;
    }
    if (e.key === "ArrowUp" && suggestions.length > 0) {
      e.preventDefault();
      setSuggestOpen(true);
      setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      return;
    }
    if (e.key === "Escape") {
      setSuggestOpen(false);
      setActiveIdx(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submitCustom();
    }
  };

  const problemLines =
    activeProblems.length > 0
      ? activeProblems
      : ["مدیریت دستی و کاغذی، خطای انسانی زیاد", "بی‌خبری از سود و زیان واقعی هر ماه", "وقت زیادی صرف کارهای تکراری می‌شود"];

  return (
    <section id="smart-guide" className="relative overflow-x-clip py-14 sm:py-20">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--primary) 12%, transparent) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4">
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <p className="mb-3 inline-flex items-center gap-2 text-[13px] font-bold text-primary">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10">
              <Receipt className="h-3.5 w-3.5" />
            </span>
            فاکتور مخصوص صنف خودت
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            مغازه‌ت کدام قفسه است؟
          </h2>
          <p className="lp-body mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
            صنف را از روی قفسه بردار — رسید تحلیل همان لحظه از چاپگر بیرون می‌آید.
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-card/80 p-4 shadow-elegant sm:p-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="lp-body text-xs font-bold text-muted-foreground">قفسه صنوف</p>
            {canScroll && (
              <div className="hidden items-center gap-1 sm:flex">
                <button
                  type="button"
                  onClick={() => scrollShelf(1)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-background text-foreground hover:bg-accent"
                  aria-label="اسکرول به راست"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollShelf(-1)}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-background text-foreground hover:bg-accent"
                  aria-label="اسکرول به چپ"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div ref={shelfRef} className="sg-shelf" role="listbox" aria-label="انتخاب صنف">
            <div ref={trackRef} className="sg-track">
              {GUIDES.map((g) => {
                const on = selected?.key === g.key;
                return (
                  <button
                    key={g.key}
                    type="button"
                    role="option"
                    aria-selected={on}
                    data-kind={g.key}
                    ref={(el) => {
                      cardRefs.current[g.key] = el;
                    }}
                    onClick={() => pickGuide(g)}
                    className={`sg-trade ${on ? "is-on" : ""}`}
                  >
                    <span className="block text-xl leading-none" aria-hidden="true">
                      {g.emoji}
                    </span>
                    <span className="mt-2 block text-[13px] font-extrabold leading-6">{g.label}</span>
                  </button>
                );
              })}
              <span
                className="sg-indicator"
                style={{
                  left: indicator.left,
                  width: indicator.width,
                  opacity: indicator.on ? 1 : 0,
                }}
                aria-hidden="true"
              />
            </div>
          </div>

          <div className="relative mt-4 border-t border-dashed border-border pt-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <input
                  value={customText}
                  onChange={(e) => {
                    setCustomText(e.target.value);
                    setShowCustomResult(false);
                    setSuggestOpen(true);
                    setActiveIdx(-1);
                  }}
                  onFocus={() => setSuggestOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setSuggestOpen(false), 140);
                  }}
                  onKeyDown={onSearchKeyDown}
                  placeholder="صنف شما در قفسه نبود؟ اینجا بنویس… (مثلاً: گل‌فروشی)"
                  className="lp-body w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none focus-visible:border-primary"
                  role="combobox"
                  aria-expanded={suggestOpen && suggestions.length > 0}
                  aria-controls={suggestBoxId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    activeIdx >= 0 && suggestions[activeIdx]
                      ? `sg-opt-${suggestions[activeIdx].key}`
                      : undefined
                  }
                />
                {suggestOpen && suggestions.length > 0 && (
                  <ul
                    id={suggestBoxId}
                    role="listbox"
                    className="sg-suggest absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card py-1 shadow-elegant"
                  >
                    {suggestions.map((g, i) => (
                      <li key={g.key} role="presentation">
                        <button
                          type="button"
                          id={`sg-opt-${g.key}`}
                          role="option"
                          aria-selected={i === activeIdx}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            pickGuide(g);
                            setCustomText("");
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm ${
                            i === activeIdx ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-accent"
                          }`}
                        >
                          <span aria-hidden="true">{g.emoji}</span>
                          <span className="font-semibold">
                            <HighlightMatch text={g.label} query={customText} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                disabled={!customText.trim()}
                onClick={submitCustom}
                className="lp-btn lp-btn-primary inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                <ArrowRight className="h-4 w-4" />
                نمایش تحلیل من
              </button>
            </div>
          </div>

          {showResult && (
            <div className="mt-6">
              <div className="sg-printer" aria-hidden="true" />
              <div key={printKey} className="sg-print rounded-b-2xl px-4 py-5 sm:px-7 sm:py-7">
                <div className="sg-stagger sg-d1">
                  <div className="text-xl font-extrabold text-primary sm:text-2xl">{activeTitle}</div>
                  <p className="lp-body mt-2 max-w-xl text-sm leading-7 text-[color:var(--lp-ink)]/80 sm:text-[15px]">
                    {activeIntro}
                  </p>
                </div>

                <div className="sg-stagger sg-d2 mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sg-ledger px-4 py-4 pr-5">
                    <div className="mb-2.5 flex items-center gap-1.5 text-xs font-extrabold text-[#8a3b2a]">
                      <XCircle className="h-4 w-4" />
                      امروز، روی دفتر کاغذی
                    </div>
                    <ul className="space-y-2">
                      {problemLines.map((p, i) => (
                        <li key={i} className="lp-body flex items-start gap-2 text-[13px] leading-6">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c23b2e]" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="sg-digital p-4">
                    <div className="mb-2.5 flex items-center gap-1.5 text-xs font-extrabold text-primary">
                      <CheckCircle2 className="h-4 w-4" />
                      از فردا، روی گوشی با KAMIX
                    </div>
                    <ul className="space-y-2">
                      {activeBenefits.slice(0, 3).map((b, i) => (
                        <li key={i} className="lp-body flex items-start gap-2 text-[13px] leading-6 text-foreground/85">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span>{b.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="sg-stagger sg-d3 mt-5">
                  <div className="mb-2 text-xs font-bold text-muted-foreground">
                    همه‌ی امکاناتی که روی فاکتور این صنف می‌آید:
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {activeBenefits.map((b, i) => {
                      const Icon = iconMap[b.icon];
                      return (
                        <div
                          key={i}
                          className="flex items-start gap-3 rounded-2xl border border-border/80 bg-background/80 p-3.5"
                        >
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[13px] font-bold text-foreground">{b.title}</div>
                            <div className="lp-body mt-0.5 text-xs leading-6 text-muted-foreground">{b.detail}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {activeRoi && (
                  <div className="sg-stagger sg-d4 sg-roi mt-4 flex items-start gap-3 rounded-2xl px-4 py-3.5">
                    <span className="sg-roi-seal" aria-hidden="true">
                      مهر
                      <br />
                      سود
                    </span>
                    <p className="lp-body min-w-0 text-[13px] leading-7">
                      <strong className="ml-1 inline-flex items-center gap-1">
                        <TrendingUp className="h-3.5 w-3.5" />
                        برگشت سرمایه:
                      </strong>
                      {activeRoi}
                    </p>
                  </div>
                )}

                {showCustomResult && !customGuide && (
                  <p className="sg-stagger sg-d4 lp-body mt-4 rounded-2xl bg-muted/60 px-4 py-3 text-xs leading-7 text-muted-foreground">
                    برای «{customText.trim()}» دسته‌ی اختصاصی نداشتیم، ولی موارد بالا برای هر فروشگاهی کاربردی است — تیم پشتیبانی ما هم می‌تواند راهنمایی دقیق‌تری بدهد.
                  </p>
                )}

                <div className="sg-stagger sg-d5 lp-cta-slip mt-7 rounded-3xl p-6 text-center text-primary-foreground sm:p-8">
                  <p className="relative text-[11px] font-bold opacity-90">مخصوص همین صنف آماده است</p>
                  <h3 className="relative mt-1 text-xl font-extrabold sm:text-2xl">
                    KAMIX را برای «{activeGuide ? activeGuide.label : customText.trim() || "کسب‌وکار شما"}» راه بینداز
                  </h3>
                  <p className="lp-body relative mx-auto mt-2 max-w-md text-sm leading-7 opacity-90">
                    ثبت‌نام کمتر از دو دقیقه طول می‌کشد. با پلن‌های ۱، ۳، ۶ یا ۱۲ ماهه، همین امروز از روی گوشی فاکتور بزن.
                  </p>
                  <div className="relative mt-5 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
                    <Link
                      to="/register"
                      className="lp-btn lp-btn-primary flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-background px-7 py-3.5 text-sm font-extrabold text-primary sm:w-auto"
                    >
                      خرید اشتراک و شروع
                      <ArrowLeft className="h-4 w-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={reset}
                      className="lp-btn flex w-full max-w-xs items-center justify-center rounded-2xl border border-primary-foreground/40 px-7 py-3.5 text-sm font-bold text-primary-foreground hover:bg-primary-foreground/10 sm:w-auto"
                    >
                      بررسی صنف دیگر
                    </button>
                  </div>
                  <p className="relative mt-4 flex items-center justify-center gap-1.5 text-[11px] opacity-80">
                    <Clock className="h-3.5 w-3.5" />
                    فعال‌سازی سریع پس از پرداخت — همین امروز شروع کنید
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

