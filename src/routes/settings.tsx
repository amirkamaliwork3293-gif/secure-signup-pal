import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Layout } from "@/components/Layout";
import { settings } from "@/lib/store";
import { ApkDownloadButton } from "@/components/ApkDownloadButton";
import { Settings, Save, Scale } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "تنظیمات | کمالی حسابداری" }] }),
  component: SettingsPage,
});

function SettingsPageInner() {
  const [appSettings, setSettings] = settings.useAll();
  const [shopName, setShopName] = useState(appSettings.shopName);
  const [invoiceFontSize, setInvoiceFontSize] = useState(appSettings.invoiceFontSize ?? 13);
  const [weightUnits, setWeightUnits] = useState(!!appSettings.weightUnits);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setSettings({ ...appSettings, shopName: shopName.trim() || "فروشگاه من", invoiceFontSize, weightUnits });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center gap-2">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold">تنظیمات</h1>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        {/* نام فروشگاه */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">نام فروشگاه</label>
          <input
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="فروشگاه من"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">این نام در هدر سیستم و فاکتورها نمایش داده می‌شود.</p>
        </div>

        {/* سایز فونت فاکتور */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            سایز فونت فاکتور — {invoiceFontSize}px
          </label>
          <input
            type="range"
            min={10}
            max={18}
            step={1}
            value={invoiceFontSize}
            onChange={(e) => setInvoiceFontSize(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>کوچک (۱۰)</span>
            <span>پیش‌فرض (۱۳)</span>
            <span>بزرگ (۱۸)</span>
          </div>
          {/* Preview */}
          <div
            className="mt-2 rounded-xl border border-dashed border-border bg-background p-3 text-center text-muted-foreground"
            style={{ fontSize: invoiceFontSize }}
          >
            نمونه متن فاکتور — ۱۲۵,۰۰۰ تومان
          </div>
        </div>

        {/* فروش وزنی — قابلیت پیشرفته اختیاری؛ برای فروشگاه‌های عادی مخفی می‌ماند */}
        <div className="rounded-xl border border-border bg-background p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Scale className="h-4 w-4 text-primary" />
              فروش وزنی (کیلوگرم / گرم)
            </span>
            <input
              type="checkbox"
              checked={weightUnits}
              onChange={(e) => setWeightUnits(e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </label>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            مخصوص فروشگاه‌های عمده و وزنی. با فعال‌شدن، در فرم محصول واحد فروش
            (عدد/کیلوگرم/گرم) اضافه می‌شود و در فاکتور می‌توانید مقدار اعشاری
            (مثلاً ۲٫۵ کیلوگرم) وارد کنید. در حالت غیرفعال هیچ چیز اضافه‌ای نمایش داده نمی‌شود.
          </p>
        </div>

        <button
          onClick={save}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Save className="h-4 w-4" />
          {saved ? "ذخیره شد ✓" : "ذخیره تنظیمات"}
        </button>
      </div>

      {/* دانلود نسخه اندروید — همیشه در دسترس */}
      <div className="mt-4 text-center">
        <ApkDownloadButton className="w-full" />
      </div>
    </Layout>
  );
}

function SettingsPage() {
  return <AuthGuard><SettingsPageInner /></AuthGuard>;
}
