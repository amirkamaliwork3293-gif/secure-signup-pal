/**
 * راهنمای هوشمند کسب‌وکار برای صفحه ورود/ثبت‌نام.
 * - کاملاً استاتیک و بدون هیچ تماس شبکه‌ای/AI — صفر مصرف کردیت.
 * - کاربر نوع کسب‌وکار خود را انتخاب می‌کند (یا آزادانه تایپ می‌کند)
 *   و مزایای مرتبط برنامه را می‌بیند تا ترغیب به خرید اشتراک شود.
 * - فیلد اختیاری است.
 */
import { useMemo, useState } from "react";
import { Sparkles, X, ArrowRight, CheckCircle2 } from "lucide-react";

type Guide = {
  key: string;
  label: string;
  emoji: string;
  keywords: string[];
  benefits: string[];
};

const GUIDES: Guide[] = [
  {
    key: "clothing",
    label: "پوشاک",
    emoji: "👕",
    keywords: ["پوشاک", "لباس", "بوتیک", "مانتو", "کیف", "کفش", "جین"],
    benefits: [
      "برای هر مدل/سایز/رنگ بارکد اختصاصی چاپ کن و روی لباس بچسبان؛ صندوق‌داری با اسکن موبایل در چند ثانیه.",
      "موجودی هر سایز و رنگ به‌صورت جدا کنترل می‌شود؛ دیگر لباس تمام‌شده را نمی‌فروشی.",
      "لیست مشتریان دائمی و بدهکاران را نگه دار و پیام یادآوری بفرست.",
      "گزارش پرفروش‌ترین مدل‌ها و سود واقعی هر فصل را ببین تا خرید بعدی‌ات هوشمندانه باشد.",
      "فاکتور رسمی PDF با لوگو و نام فروشگاه برای مشتری بفرست.",
    ],
  },
  {
    key: "cafe",
    label: "کافه و رستوران",
    emoji: "☕",
    keywords: ["کافه", "رستوران", "فست فود", "کافی", "قهوه", "بار", "کترینگ"],
    benefits: [
      "منوی دیجیتال با QR بساز؛ مشتری روی میز اسکن می‌کند و منو را می‌بیند (بدون نیاز به چاپ مجدد).",
      "قیمت‌ها را فوری در منو تغییر بده — دیگر منوی چاپی قدیمی نداری.",
      "فاکتور سریع میز با محاسبه خودکار مالیات و سرویس.",
      "کنترل موجودی مواد اولیه؛ وقتی چیزی رو به اتمام است هشدار می‌گیری.",
      "گزارش پرفروش‌ترین آیتم‌های منو و ساعت‌های اوج فروش.",
    ],
  },
  {
    key: "supermarket",
    label: "سوپرمارکت / خواربار",
    emoji: "🛒",
    keywords: ["سوپر", "خواربار", "بقالی", "هایپر", "مواد غذایی"],
    benefits: [
      "با دوربین موبایل بارکد اجناس را اسکن کن — بدون خرید دستگاه بارکدخوان گران.",
      "موجودی هزاران کالا را دقیق نگه دار و از فروش کالای ناموجود جلوگیری کن.",
      "بدهکاران محله را ثبت کن و لیست بدهی هر مشتری را در یک نگاه ببین.",
      "گزارش سود روزانه/ماهانه و پرفروش‌ترین کالاها.",
      "ورود دسته‌ای محصولات از فایل اکسل برای شروع سریع.",
    ],
  },
  {
    key: "pharmacy",
    label: "داروخانه / آرایشی بهداشتی",
    emoji: "💊",
    keywords: ["داروخانه", "آرایشی", "بهداشتی", "لوازم آرایش", "عطر"],
    benefits: [
      "کنترل دقیق موجودی هر برند و کد محصول با اسکن بارکد.",
      "ثبت مشتریان دائمی و تاریخچه خرید هر نفر.",
      "گزارش پرفروش‌ترین برندها برای سفارش هوشمندانه.",
      "فاکتور تمیز و رسمی با لوگوی فروشگاه.",
      "مدیریت بدهکاران و اعتبار مشتریان.",
    ],
  },
  {
    key: "mobile",
    label: "موبایل و لوازم جانبی",
    emoji: "📱",
    keywords: ["موبایل", "گوشی", "لوازم جانبی", "دیجیتال", "کامپیوتر", "لپ‌تاپ"],
    benefits: [
      "برای هر گوشی/قاب/شارژر بارکد اختصاصی چاپ کن.",
      "کنترل موجودی مدل‌های مختلف و رنگ‌ها به‌صورت جدا.",
      "ثبت گارانتی و اطلاعات مشتری برای پیگیری‌های بعدی.",
      "فاکتور رسمی PDF با سریال دستگاه برای مشتری.",
      "گزارش سود واقعی هر مدل تا بدانی روی کدام سرمایه‌گذاری کنی.",
    ],
  },
  {
    key: "gold",
    label: "طلا و جواهر",
    emoji: "💍",
    keywords: ["طلا", "جواهر", "نقره", "زیورآلات"],
    benefits: [
      "ثبت دقیق وزن و اجرت هر قطعه با بارکد اختصاصی.",
      "فاکتور رسمی با محاسبه خودکار اجرت، مالیات و سود.",
      "مدیریت مشتریان VIP و تاریخچه خرید هر مشتری.",
      "گزارش سود روزانه بر اساس نرخ لحظه‌ای که ثبت می‌کنی.",
      "امنیت داده‌ها روی دستگاه و پشتیبان ابری.",
    ],
  },
  {
    key: "bakery",
    label: "قنادی / نانوایی",
    emoji: "🍰",
    keywords: ["قنادی", "شیرینی", "نانوایی", "کیک", "شکلات"],
    benefits: [
      "منوی دیجیتال محصولات با عکس و قیمت برای مشتری.",
      "ثبت سفارش کیک و شیرینی با تاریخ تحویل.",
      "فاکتور سریع برای فروش روزانه.",
      "کنترل موجودی مواد اولیه و هشدار کمبود.",
      "گزارش پرفروش‌ترین محصولات هر فصل.",
    ],
  },
  {
    key: "hardware",
    label: "ابزار و لوازم خانگی",
    emoji: "🔧",
    keywords: ["ابزار", "یراق", "لوازم خانگی", "برقی", "ساختمانی"],
    benefits: [
      "بارکد برای هزاران قطعه کوچک — دیگر گم شدن قیمت نداری.",
      "کنترل موجودی هر برند و اندازه به‌صورت جدا.",
      "فاکتور رسمی برای مشتریان عمده و خرده.",
      "مدیریت بدهکاران و اعتبار مشتریان دائمی.",
      "گزارش پرفروش‌ترین کالاها برای سفارش هوشمند.",
    ],
  },
  {
    key: "book",
    label: "کتاب و لوازم‌التحریر",
    emoji: "📚",
    keywords: ["کتاب", "لوازم التحریر", "نوشت‌افزار", "دفتر"],
    benefits: [
      "بارکد استاندارد کتاب‌ها (ISBN) و لوازم را اسکن کن.",
      "کنترل موجودی هزاران عنوان کتاب.",
      "فاکتور سریع مدرسه/دانشجویی.",
      "مدیریت مشتریان دائمی و بدهکاران.",
      "گزارش پرفروش‌ترین‌ها بر اساس فصل تحصیلی.",
    ],
  },
];

const GENERIC_BENEFITS: string[] = [
  "بارکد اختصاصی برای هر محصول چاپ کن و با دوربین موبایل اسکن کن — بدون خرید بارکدخوان.",
  "کنترل دقیق موجودی انبار و هشدار کمبود کالا.",
  "فاکتور رسمی PDF با لوگو و نام فروشگاه برای مشتری.",
  "مدیریت مشتریان دائمی و لیست بدهکاران در یک صفحه.",
  "گزارش سود روزانه/ماهانه و شناسایی پرفروش‌ترین محصولات.",
  "کاملاً موبایل‌محور با نسخه اپلیکیشن اندروید.",
];

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

  const activeBenefits: string[] | null = selected
    ? selected.benefits
    : showCustomResult
    ? customGuide?.benefits ?? GENERIC_BENEFITS
    : null;

  const activeTitle: string | null = selected
    ? `${selected.emoji} ${selected.label}`
    : showCustomResult
    ? customGuide
      ? `${customGuide.emoji} ${customGuide.label}`
      : `✨ ${customText.trim() || "کسب‌وکار شما"}`
    : null;

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
          <div className="relative max-h-[85vh] w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-elegant">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold">
                  {activeBenefits ? "مزایای برنامه برای شما" : "کسب‌وکار شما چیست؟"}
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

            <div className="max-h-[65vh] overflow-y-auto px-4 py-4">
              {!activeBenefits && (
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

              {activeBenefits && (
                <>
                  <div className="mb-3 rounded-xl bg-primary/10 px-3 py-2.5 text-sm font-bold text-primary">
                    {activeTitle}
                  </div>
                  <ul className="space-y-2.5">
                    {activeBenefits.map((b, i) => (
                      <li key={i} className="flex items-start gap-2 rounded-xl border border-border bg-background px-3 py-2.5">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="text-xs leading-6 text-foreground">{b}</span>
                      </li>
                    ))}
                  </ul>

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
                    className="mt-4 w-full rounded-xl border border-border bg-background py-2 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
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