import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Layout } from "@/components/Layout";
import { settings } from "@/lib/store";
import { Settings, Save } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "تنظیمات | سیستم حسابداری کمالی" }] }),
  component: SettingsPage,
});

function SettingsPageInner() {
  const [appSettings, setSettings] = settings.useAll();
  const [shopName, setShopName] = useState(appSettings.shopName);
  const [invoiceFontSize, setInvoiceFontSize] = useState(appSettings.invoiceFontSize ?? 13);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setSettings({ ...appSettings, shopName: shopName.trim() || "فروشگاه من", invoiceFontSize });
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

        <button
          onClick={save}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Save className="h-4 w-4" />
          {saved ? "ذخیره شد ✓" : "ذخیره تنظیمات"}
        </button>
      </div>
    </Layout>
  );
}

function SettingsPage() {
  return <AuthGuard><SettingsPageInner /></AuthGuard>;
}
