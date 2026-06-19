/**
 * راهنمای سریع (FAQ) برای صفحه‌ی ورود.
 * - لیست ثابت ۸ سؤال/جواب
 * - بدون هیچ تماس شبکه/سرور/AI
 */
import { useEffect, useRef, useState } from "react";
import { HelpCircle, Phone, X } from "lucide-react";

const SUPPORT_PHONE = "09138413293";

const FAQ: { q: string; a: string }[] = [
  {
    q: "رمز عبور را فراموش کردم، چیکار کنم؟",
    a: "برای بازیابی رمز عبور با شماره ۰۹۱۳۸۴۱۳۲۹۳ تماس بگیرید تا حساب شما توسط ادمین بازیابی شود.",
  },
  {
    q: "این برنامه‌ی حسابداری چه کاری انجام می‌دهد؟",
    a: "با دوربین موبایل بارکد محصولات را اسکن می‌کنید و فاکتور به‌صورت خودکار صادر می‌شود. مدیریت محصولات، مشتریان و بدهکاران، گزارش سود و فروش، و یک دستیار هوشمند برای پاسخ به سؤالات مالی‌تان هم در برنامه وجود دارد.",
  },
  {
    q: "آیا امکان تست رایگان وجود دارد؟",
    a: "بله، یک نسخه‌ی تست رایگان یک ساعته برای آشنایی با محیط برنامه در دسترس است؛ از صفحه‌ی ثبت‌نام و انتخاب گزینه‌ی تست رایگان می‌توانید آن را فعال کنید.",
  },
  {
    q: "هزینه‌ی استفاده از برنامه چقدر است؟",
    a: "چند پلن مختلف یک، سه، شش و دوازده ماهه با قیمت‌های متفاوت وجود دارد. برای دیدن قیمت دقیق و فعلی هر پلن، وارد صفحه‌ی ثبت‌نام شوید.",
  },
  {
    q: "پرداخت چطور انجام می‌شود؟",
    a: "پرداخت به‌صورت کارت‌به‌کارت است. بعد از واریز، عکس رسید را در صفحه‌ی ثبت‌نام آپلود می‌کنید و حساب شما پس از تایید ادمین، معمولاً خیلی سریع، فعال می‌شود.",
  },
  {
    q: "آیا برای استفاده از برنامه نیاز به اینترنت دائمی است؟",
    a: "برای ورود و دریافت اطلاعات نیاز به اینترنت دارید، اما بسیاری از عملیات روزمره مثل ثبت فاکتور به‌صورت سریع و روان در دستگاه شما انجام می‌شود.",
  },
  {
    q: "آیا می‌توانم از گوشی موبایل استفاده کنم؟",
    a: "بله، برنامه کاملاً موبایل‌محور طراحی شده و یک نسخه‌ی اپلیکیشن اندروید هم در همین صفحه برای دانلود مستقیم در دسترس است.",
  },
  {
    q: "دستیار هوشمند برنامه چه کمکی می‌کند؟",
    a: "بعد از ورود، در صفحه‌ی گزارش‌ها می‌توانید سؤالاتی مثل امروز چقدر سود کردم یا پرفروش‌ترین محصولم چیه بپرسید و بر اساس داده‌های واقعی فروشگاهتان پاسخ فوری بگیرید.",
  },
];

export function LoginHelpDialog() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground"
      >
        <HelpCircle className="h-4 w-4" />
        راهنما / سؤالات پرتکرار
      </button>

      {open && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) close(); }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="relative max-h-[85vh] w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-elegant">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold">راهنما و سؤالات پرتکرار</h2>
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

            <div className="max-h-[60vh] overflow-y-auto px-3 py-3">
              <ul className="space-y-2">
                {FAQ.map((item, idx) => {
                  const isOpen = expanded === idx;
                  const isSpeaking = speakingIdx === idx;
                  return (
                    <li key={idx} className="rounded-xl border border-border bg-background">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : idx)}
                        className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-right text-xs font-semibold text-foreground"
                      >
                        <span className="leading-6">{item.q}</span>
                        <span className="mt-0.5 shrink-0 text-muted-foreground">{isOpen ? "−" : "+"}</span>
                      </button>
                      {isOpen && (
                        <div className="border-t border-border px-3 py-2.5">
                          <p className="text-xs leading-7 text-muted-foreground">{item.a}</p>
                          {speechSupported && (
                            <button
                              type="button"
                              onClick={() => speak(idx, item.a)}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition hover:bg-primary/10"
                            >
                              {isSpeaking ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                              {isSpeaking ? "توقف پخش" : "شنیدن پاسخ"}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="border-t border-border bg-muted/40 px-5 py-3 text-center text-xs">
              <span className="text-muted-foreground">پشتیبانی: </span>
              <a
                href={`tel:${SUPPORT_PHONE}`}
                className="inline-flex items-center gap-1 font-bold text-primary hover:underline"
                dir="ltr"
              >
                <Phone className="h-3.5 w-3.5" />
                {SUPPORT_PHONE}
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
