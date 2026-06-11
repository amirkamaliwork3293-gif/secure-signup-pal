/**
 * دکمه دانلود مستقیم APK اندروید — برای همه قابل دسترس است (با یا بدون ورود).
 * فایل از GitHub Releases ریپوی پروژه سرو می‌شود؛ workflow ساخت APK پس از هر
 * push آن را در تگ ثابت «apk-latest» منتشر می‌کند.
 */
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { isNativeApp } from "@/lib/print";

export const APK_DOWNLOAD_URL =
  "https://github.com/amirkamaliwork3293-gif/secure-signup-pal/releases/download/apk-latest/kamali-accounting.apk";

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
