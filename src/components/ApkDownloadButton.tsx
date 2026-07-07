/**
 * دکمه دانلود مستقیم APK اندروید — برای همه قابل دسترس است (با یا بدون ورود).
 * فایل مستقیماً از خود سایت سرو می‌شود (بدون انتقال به گیت‌هاب یا صفحه خارجی):
 * workflow ساخت APK آخرین نسخه را در public/kamali-accounting.apk کامیت می‌کند
 * و سایت آن را در آدرس ‎/kamali-accounting.apk ارائه می‌دهد.
 */
import { useEffect, useState } from "react";
import { Download, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { isNativeApp } from "@/lib/print";
import installGuideAsset from "@/assets/apk-install-guide.jpeg.asset.json";

export const APK_DOWNLOAD_URL = "/kamali-accounting.apk";

export function ApkDownloadButton({ className = "" }: { className?: string }) {
  // داخل خود اپ اندروید نمایش داده نمی‌شود (پس از hydration بررسی می‌شود)
  const [native, setNative] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  useEffect(() => { setNative(isNativeApp()); }, []);
  if (native) return null;

  return (
    <div className={`flex flex-col items-stretch gap-3 ${className}`}>
      <a
        href={APK_DOWNLOAD_URL}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary transition hover:bg-primary/10"
        download
      >
        <Download className="h-5 w-5" />
        دانلود اپلیکیشن اندروید (APK)
      </a>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="flex w-full items-center justify-between gap-2 bg-muted/50 px-3 py-2.5 text-right text-xs font-bold text-foreground"
        >
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            راهنمای تصویری نصب روی گوشی اندروید
          </span>
          {showGuide ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {showGuide && (
          <div className="space-y-3 px-3 pb-3 pt-2">
            <ol className="space-y-1.5 text-[11px] leading-6 text-muted-foreground">
              <li>۱) پس از دانلود، فایل APK را باز کنید.</li>
              <li>۲) اگر پیام «Google Play Protect» ظاهر شد، طبق تصویر زیر عمل کنید:</li>
              <li className="pl-3">• روی <strong className="text-foreground">More details</strong> بزنید.</li>
              <li className="pl-3">• سپس گزینه <strong className="text-foreground">Install anyway</strong> را انتخاب کنید.</li>
              <li>۳) نصب کامل می‌شود و آیکون برنامه در صفحه گوشی ظاهر خواهد شد.</li>
            </ol>
            <div className="rounded-xl border border-border bg-background p-2">
              <img
                src={installGuideAsset.url}
                alt="راهنمای تصویری نصب فایل APK کمالی حسابداری روی اندروید"
                loading="lazy"
                className="mx-auto w-full max-w-xs rounded-lg"
              />
            </div>
            <p className="rounded-lg bg-primary/5 px-2.5 py-2 text-[11px] leading-6 text-primary">
              این پیام امنیتی طبیعی است — فقط به این دلیل نمایش داده می‌شود که برنامه از خارج فروشگاه Google Play نصب می‌شود. برنامه کاملاً امن است.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
