/**
 * invoice-design.tsx — «طراح فاکتور»
 * کاربر ساختار فاکتور چاپی خودش را می‌چیند: بلوک‌های اکسل‌گونه، ستون‌های جدول،
 * امضا و مهر، رنگ و عنوان. پیش‌نمایش زنده در کنار فرم نمایش داده می‌شود.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Layout } from "@/components/Layout";
import { settings, type Invoice } from "@/lib/store";
import {
  normalizeTemplate,
  buildTemplatedInvoiceHTML,
  defaultTemplate,
  corporateTemplate,
  minimalTemplate,
  FIELD_CATALOG,
  COLUMN_LABELS,
  tplId,
  type InvoiceTemplate,
  type TplBlock,
  type TplField,
  type TplFieldKey,
} from "@/lib/invoice-template";
import {
  LayoutTemplate,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  Check,
  Eye,
  RotateCcw,
} from "lucide-react";

export const Route = createFileRoute("/invoice-design")({
  head: () => ({
    meta: [
      { title: "طراح فاکتور | KAMIX" },
      { name: "description", content: "چیدمان دلخواه فاکتور فروش: فیلدها، ستون‌ها، مهر و امضا." },
      { property: "og:title", content: "طراح فاکتور | KAMIX" },
      { property: "og:description", content: "فاکتور خود را دقیقاً مطابق کسب‌وکارتان بچینید." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AuthGuard>
      <InvoiceDesignPage />
    </AuthGuard>
  ),
});

const SAMPLE: Invoice = {
  id: "kx1024",
  createdAt: Date.now(),
  items: [
    { productId: "1", name: "پنیر محلی", price: 185000, quantity: 2.5, unit: "کیلوگرم" },
    { productId: "2", name: "روغن زیتون فرابکر", price: 420000, quantity: 3, unit: "بطری", discountPercent: 10, originalPrice: 466000 },
    { productId: "3", name: "بسته هدیه", price: 950000, quantity: 1, unit: "بسته" },
  ],
  total: 2_872_500,
  customer: { firstName: "علی", lastName: "محمدی", phone: "09120000000" },
  paymentMethod: "card",
  notes: "تحویل درب مغازه",
};

function InvoiceDesignPage() {
  const [appSettings, setSettings] = settings.useAll();
  const [tpl, setTpl] = useState<InvoiceTemplate>(() =>
    normalizeTemplate(appSettings.invoiceTemplate as Partial<InvoiceTemplate> | undefined),
  );
  const [saved, setSaved] = useState(false);

  const sample = useMemo<Invoice>(
    () => ({
      ...SAMPLE,
      shopName: appSettings.shopName || "فروشگاه من",
      shopAddress: appSettings.storeAddress,
      shopPhone: appSettings.storePhones?.[0],
      shopLogoUrl: appSettings.logoUrl,
    }),
    [appSettings],
  );

  const previewHtml = useMemo(
    () => buildTemplatedInvoiceHTML(sample, tpl, appSettings.invoiceFontSize ?? 13),
    [sample, tpl, appSettings.invoiceFontSize],
  );

  const patch = (p: Partial<InvoiceTemplate>) => setTpl((t) => ({ ...t, ...p }));

  const save = () => {
    setSettings({
      ...appSettings,
      invoiceTemplate: JSON.parse(JSON.stringify(tpl)),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── عملیات روی بلوک‌ها ─────────────────────────────────────────────────
  const updBlock = (id: string, p: Partial<TplBlock>) =>
    setTpl((t) => ({ ...t, blocks: t.blocks.map((b) => (b.id === id ? { ...b, ...p } : b)) }));

  const moveBlock = (i: number, dir: -1 | 1) =>
    setTpl((t) => {
      const b = [...t.blocks];
      const j = i + dir;
      if (j < 0 || j >= b.length) return t;
      [b[i], b[j]] = [b[j], b[i]];
      return { ...t, blocks: b };
    });

  const addBlock = () =>
    setTpl((t) => ({
      ...t,
      blocks: [...t.blocks, { id: tplId(), title: "بخش جدید", columns: 2, fields: [] }],
    }));

  const delBlock = (id: string) =>
    setTpl((t) => ({ ...t, blocks: t.blocks.filter((b) => b.id !== id) }));

  const addField = (blockId: string) =>
    setTpl((t) => ({
      ...t,
      blocks: t.blocks.map((b) =>
        b.id === blockId
          ? { ...b, fields: [...b.fields, { id: tplId(), label: "عنوان فیلد", key: "blank" as TplFieldKey }] }
          : b,
      ),
    }));

  const updField = (blockId: string, fieldId: string, p: Partial<TplField>) =>
    setTpl((t) => ({
      ...t,
      blocks: t.blocks.map((b) =>
        b.id === blockId
          ? { ...b, fields: b.fields.map((f) => (f.id === fieldId ? { ...f, ...p } : f)) }
          : b,
      ),
    }));

  const delField = (blockId: string, fieldId: string) =>
    setTpl((t) => ({
      ...t,
      blocks: t.blocks.map((b) =>
        b.id === blockId ? { ...b, fields: b.fields.filter((f) => f.id !== fieldId) } : b,
      ),
    }));

  const moveField = (blockId: string, i: number, dir: -1 | 1) =>
    setTpl((t) => ({
      ...t,
      blocks: t.blocks.map((b) => {
        if (b.id !== blockId) return b;
        const f = [...b.fields];
        const j = i + dir;
        if (j < 0 || j >= f.length) return b;
        [f[i], f[j]] = [f[j], f[i]];
        return { ...b, fields: f };
      }),
    }));

  const input =
    "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary";

  return (
    <Layout>
      {/* راهنمای بالای صفحه */}
      <div className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-primary">
          <LayoutTemplate className="h-5 w-5" />
          <h1 className="text-base font-bold">طراح فاکتور — فاکتور دلخواه خود را بچینید</h1>
        </div>
        <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
          در این بخش می‌توانید ساختار فاکتور چاپی خود را دقیقاً مطابق کسب‌وکارتان بچینید: افزودن
          فیلدهایی مثل کد ملی، شماره اقتصادی، کد پستی و نشانی، ساخت بخش‌های جداگانه برای فروشنده و
          خریدار به‌صورت جدولی (اکسل‌گونه)، انتخاب ستون‌های جدول کالاها و جای مهر و امضا. اگر این
          بخش را خاموش بگذارید، همان فاکتور پیش‌فرض برنامه چاپ می‌شود.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ─── فرم تنظیمات ─── */}
        <div className="space-y-4">
          {/* فعال‌سازی + قالب آماده */}
          <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">استفاده از فاکتور سفارشی</span>
              <input
                type="checkbox"
                checked={tpl.enabled}
                onChange={(e) => patch({ enabled: e.target.checked })}
                className="h-5 w-5 accent-[var(--primary)]"
              />
            </label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              خاموش = فاکتور پیش‌فرض برنامه (که همین‌طور هم خوب است).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTpl(minimalTemplate())}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
              >
                قالب ساده
              </button>
              <button
                type="button"
                onClick={() => setTpl(corporateTemplate())}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
              >
                قالب رسمی / شرکتی
              </button>
              <button
                type="button"
                onClick={() => setTpl(defaultTemplate())}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                بازنشانی
              </button>
            </div>
          </section>

          {/* سربرگ */}
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
            <h2 className="text-sm font-bold">سربرگ فاکتور</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">عنوان فاکتور</label>
                <input className={input} value={tpl.title} onChange={(e) => patch({ title: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">زیرعنوان (اختیاری)</label>
                <input
                  className={input}
                  value={tpl.subtitle || ""}
                  onChange={(e) => patch({ subtitle: e.target.value })}
                  placeholder="مثلاً: تولید و پخش لوازم خانگی"
                />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-muted-foreground">رنگ فاکتور</label>
                <input
                  type="color"
                  value={tpl.accent}
                  onChange={(e) => patch({ accent: e.target.value })}
                  className="h-8 w-14 cursor-pointer rounded border border-border bg-background"
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={tpl.showLogo}
                  onChange={(e) => patch({ showLogo: e.target.checked })}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                نمایش لوگوی فروشگاه
              </label>
            </div>
          </section>

          {/* بلوک‌ها */}
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">بخش‌های اطلاعاتی (جدولی)</h2>
              <button
                type="button"
                onClick={addBlock}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                بخش جدید
              </button>
            </div>

            {tpl.blocks.map((b, bi) => (
              <div key={b.id} className="rounded-xl border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${input} flex-1 min-w-40 font-semibold`}
                    value={b.title || ""}
                    placeholder="عنوان بخش (خالی = بدون عنوان)"
                    onChange={(e) => updBlock(b.id, { title: e.target.value })}
                  />
                  <select
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                    value={b.columns}
                    onChange={(e) => updBlock(b.id, { columns: Number(e.target.value) as 1 | 2 | 3 })}
                  >
                    <option value={1}>۱ ستون</option>
                    <option value={2}>۲ ستون</option>
                    <option value={3}>۳ ستون</option>
                  </select>
                  <button type="button" onClick={() => moveBlock(bi, -1)} className="rounded-lg border border-border p-1.5" title="بالا">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => moveBlock(bi, 1)} className="rounded-lg border border-border p-1.5" title="پایین">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => delBlock(b.id)}
                    className="rounded-lg border border-destructive/40 p-1.5 text-destructive"
                    title="حذف بخش"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-2 space-y-2">
                  {b.fields.map((f, fi) => (
                    <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-card p-2">
                      <input
                        className={`${input} w-36 flex-1`}
                        value={f.label}
                        placeholder="عنوان خانه (مثلاً کد ملی)"
                        onChange={(e) => updField(b.id, f.id, { label: e.target.value })}
                      />
                      <select
                        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                        value={f.key}
                        onChange={(e) => updField(b.id, f.id, { key: e.target.value as TplFieldKey })}
                      >
                        {["فروشنده", "خریدار", "فاکتور", "مبالغ", "دلخواه"].map((g) => (
                          <optgroup key={g} label={g}>
                            {FIELD_CATALOG.filter((c) => c.group === g).map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {f.key === "static" && (
                        <input
                          className={`${input} w-40`}
                          value={f.value || ""}
                          placeholder="مقدار ثابت"
                          onChange={(e) => updField(b.id, f.id, { value: e.target.value })}
                        />
                      )}
                      {(f.key === "static" || f.key === "blank") && (
                        <label
                          className={`flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] transition ${
                            f.askAtCheckout
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground"
                          }`}
                          title="این خانه هنگام ثبت فاکتور در برنامه از شما پرسیده می‌شود"
                        >
                          <input
                            type="checkbox"
                            checked={!!f.askAtCheckout}
                            onChange={(e) => updField(b.id, f.id, { askAtCheckout: e.target.checked })}
                            className="h-3.5 w-3.5 accent-[var(--primary)]"
                          />
                          هنگام ثبت فاکتور پر شود
                        </label>
                      )}
                      <button type="button" onClick={() => moveField(b.id, fi, -1)} className="rounded-lg border border-border p-1.5">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => moveField(b.id, fi, 1)} className="rounded-lg border border-border p-1.5">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => delField(b.id, f.id)}
                        className="rounded-lg border border-destructive/40 p-1.5 text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addField(b.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    افزودن فیلد
                  </button>
                </div>
              </div>
            ))}
          </section>

          {/* ستون‌های جدول کالا */}
          <section className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-card">
            <h2 className="text-sm font-bold">ستون‌های جدول کالاها</h2>
            {tpl.columns.map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) =>
                    patch({
                      columns: tpl.columns.map((x) =>
                        x.key === c.key ? { ...x, enabled: e.target.checked } : x,
                      ),
                    })
                  }
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                <span className="w-28 text-xs text-muted-foreground">{COLUMN_LABELS[c.key]}</span>
                <input
                  className={`${input} flex-1`}
                  value={c.label}
                  onChange={(e) =>
                    patch({
                      columns: tpl.columns.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)),
                    })
                  }
                />
              </div>
            ))}
          </section>

          {/* پانویس و امضا */}
          <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
            <h2 className="text-sm font-bold">جمع‌بندی، امضا و پانویس</h2>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={tpl.showTotals}
                onChange={(e) => patch({ showTotals: e.target.checked })}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              نمایش جعبه جمع مبالغ
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={tpl.showSignatures}
                onChange={(e) => patch({ showSignatures: e.target.checked })}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              نمایش جای مهر و امضای فروشنده و خریدار
            </label>
            {tpl.showSignatures && (
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  className={input}
                  value={tpl.sellerSignLabel}
                  onChange={(e) => patch({ sellerSignLabel: e.target.value })}
                />
                <input
                  className={input}
                  value={tpl.buyerSignLabel}
                  onChange={(e) => patch({ buyerSignLabel: e.target.value })}
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">یادداشت پایین فاکتور (شرایط فروش…)</label>
              <textarea
                className={`${input} min-h-16`}
                value={tpl.footerNote}
                onChange={(e) => patch({ footerNote: e.target.value })}
              />
            </div>
          </section>

          <button
            type="button"
            onClick={save}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-elegant"
          >
            {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? "ذخیره شد" : "ذخیره چیدمان فاکتور"}
          </button>
        </div>

        {/* ─── پیش‌نمایش ─── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold">
            <Eye className="h-4 w-4 text-primary" />
            پیش‌نمایش زنده (با اطلاعات نمونه)
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-card">
            <iframe
              title="پیش‌نمایش فاکتور"
              srcDoc={previewHtml}
              className="h-[70vh] w-full border-0 bg-white"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}