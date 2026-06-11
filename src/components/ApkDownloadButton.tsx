/**
 * دکمه دانلود مستقیم APK اندروید — برای همه قابل دسترس است (با یا بدون ورود).
 * فایل مستقیماً از خود سایت سرو می‌شود (بدون انتقال به گیت‌هاب یا صفحه خارجی):
 * workflow ساخت APK آخرین نسخه را در public/kamali-accounting.apk کامیت می‌کند
 * و سایت آن را در آدرس ‎/kamali-accounting.apk ارائه می‌دهد.
 */
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { isNativeApp } from "@/lib/print";

export const APK_DOWNLOAD_URL = "/kamali-accounting.apk";

export function ApkDownloadButton({ className = "" }: { className?: string }) {
  // داخل خود اپ اندروید نمایش داده نمی‌شود (پس از hydration بررسی می‌شود)
  const [native, setNative] = useState(false);
  useEffect(() => { setNative(isNativeApp()); }, []);
  if (native) return null;

  return (
    <a
      href={APK_DOWNLOAD_URL}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-2.5 text-xs font-semibold text-primary transition hover:bg-primary/10 ${className}`}
      download
    >
      <Download className="h-4 w-4" />
      دانلود اپلیکیشن اندروید (APK)
    </a>
  );
}
