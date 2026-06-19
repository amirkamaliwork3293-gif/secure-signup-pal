/**
 * ویدیوی معرفی کوتاه در صفحه‌ی ورود.
 * - autoplay, muted, loop, playsInline → روی موبایل و دسکتاپ بدون نیاز به کلیک پخش می‌شود
 * - بدون صدا و بدون کنترل‌های اضافه
 * - رسپانسیو، نسبت تصویر ۹:۱۶ مناسب موکاپ موبایل
 */
import videoAsset from "@/assets/mobile-accounting-animation.mp4.asset.json";
import { Sparkles } from "lucide-react";

export function LoginPromoVideo({ className = "" }: { className?: string }) {
  return (
    <div className={`w-full max-w-sm ${className}`}>
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-background shadow-card">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-card/60 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            معرفی برنامه در ۳۰ ثانیه
          </div>
          <span className="text-[10px] text-muted-foreground">بدون صدا</span>
        </div>
        <div className="relative w-full" style={{ aspectRatio: "9 / 16", maxHeight: "60vh" }}>
          <video
            src={videoAsset.url}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            controls={false}
            disablePictureInPicture
            className="absolute inset-0 h-full w-full object-cover"
            aria-label="ویدیوی معرفی برنامه‌ی کمالی حسابداری"
          />
        </div>
      </div>
    </div>
  );
}
