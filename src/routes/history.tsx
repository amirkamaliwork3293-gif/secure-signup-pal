import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Layout } from "@/components/Layout";
import { InvoiceActions } from "@/components/InvoiceActions";
import { invoice, formatToman, settings, type Invoice, type InvoiceItem } from "@/lib/store";
import {
  History as HistoryIcon,
  ChevronDown, ChevronUp,
  User, Pencil, Trash2, Check, X,
  Minus, Plus,
} from "lucide-react";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "تاریخچه فاکتورها | حساب‌بان" },
      { name: "description", content: "تاریخچه فاکتورهای ثبت‌شده." },
    ],
  }),
  component: HistoryPage,
});

// ─── ویرایش یک آیتم ─────────────────────────────────────────────────────────

function EditableItem({
  item,
  onChange,
  onRemove,
}: {
  item: InvoiceItem;
  onChange: (updated: InvoiceItem) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item.name}</div>
        <div className="text-xs text-muted-foreground">
          {formatToman(item.price)} واحد
        </div>
      </div>
      {/* تعداد */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={() => onChange({ ...item, quantity: Math.max(1, item.quantity - 1) })}
          className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-6 text-center text-sm font-semibold">
          {item.quantity.toLocaleString("fa-IR")}
        </span>
        <button
          type="button"
          onClick={() => onChange({ ...item, quantity: item.quantity + 1 })}
          className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

// ─── یک فاکتور ──────────────────────────────────────────────────────────────

function InvoiceCard({ inv: initialInv }: { inv: Invoice }) {
  const [appSettings] = settings.useAll();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Invoice>(initialInv);
  // نگه داری آخرین نسخه ذخیره‌شده (برای نمایش بعد از save)
  const [saved, setSaved] = useState<Invoice>(initialInv);

  const customer = saved.customer;
  const hasCustomer = customer && (customer.firstName || customer.lastName || customer.phone);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft({ ...saved, shopName: saved.shopName || appSettings.shopName });
    setEditing(true);
    setIsOpen(true);
  };

  const cancelEdit = () => {
    setDraft(saved);
    setEditing(false);
  };

  const saveEdit = () => {
    // محاسبه مجدد جمع کل
    const total = draft.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const updated = { ...draft, total };
    invoice.updateHistory(updated);
    setSaved(updated);
    setDraft(updated);
    setEditing(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("آیا این فاکتور حذف شود؟")) {
      invoice.deleteFromHistory(saved.id);
    }
  };

  const updateItem = (idx: number, updated: InvoiceItem) => {
    setDraft((d) => {
      const items = d.items.map((it, i) => (i === idx ? updated : it));
      return { ...d, items };
    });
  };

  const removeItem = (idx: number) => {
    setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
  };

  // فاکتور آماده برای InvoiceActions (با shopName)
  const printInv = { ...saved, shopName: saved.shopName || appSettings.shopName };

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {/* هدر */}
      <button
        onClick={() => !editing && setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-right"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-primary">{formatToman(saved.total)}</span>
            {hasCustomer && <User className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {new Date(saved.createdAt).toLocaleString("fa-IR")} · {saved.items.length} قلم
          </div>
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {/* اکشن‌های فاکتور */}
          <InvoiceActions inv={printInv} size="sm" />

          {/* ویرایش */}
          <button
            type="button"
            onClick={startEdit}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            title="ویرایش فاکتور"
          >
            <Pencil className="h-4 w-4" />
          </button>

          {/* حذف */}
          <button
            type="button"
            onClick={handleDelete}
            className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
            title="حذف فاکتور"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          {isOpen
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {/* محتوا */}
      {isOpen && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">

          {/* اطلاعات مشتری */}
          {hasCustomer && !editing && (
            <div className="rounded-lg bg-accent px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">مشتری: </span>
              {[customer?.firstName, customer?.lastName].filter(Boolean).join(" ")}
              {customer?.phone && (
                <span className="mr-2" dir="ltr">{customer.phone}</span>
              )}
            </div>
          )}

          {/* حالت نمایش */}
          {!editing && (
            <ul className="space-y-1">
              {saved.items.map((item) => (
                <li key={item.productId} className="flex justify-between text-xs text-muted-foreground">
                  <span>{item.name} × {item.quantity.toLocaleString("fa-IR")}</span>
                  <span>{formatToman(item.price * item.quantity)}</span>
                </li>
              ))}
            </ul>
          )}

          {/* حالت ویرایش */}
          {editing && (
            <div className="space-y-3">
              {/* نام مشتری */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={draft.customer?.firstName ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, customer: { ...d.customer, firstName: e.target.value } }))
                  }
                  placeholder="نام"
                  className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <input
                  value={draft.customer?.lastName ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, customer: { ...d.customer, lastName: e.target.value } }))
                  }
                  placeholder="نام خانوادگی"
                  className="rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <input
                value={draft.customer?.phone ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, customer: { ...d.customer, phone: e.target.value } }))
                }
                placeholder="تلفن"
                inputMode="tel"
                dir="ltr"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />

              {/* اقلام */}
              <ul className="space-y-2">
                {draft.items.map((item, idx) => (
                  <EditableItem
                    key={item.productId}
                    item={item}
                    onChange={(u) => updateItem(idx, u)}
                    onRemove={() => removeItem(idx)}
                  />
                ))}
              </ul>

              {/* جمع موقت */}
              <div className="text-left text-sm font-semibold text-primary">
                جمع کل:{" "}
                {formatToman(
                  draft.items.reduce((s, i) => s + i.price * i.quantity, 0)
                )}
              </div>

              {/* دکمه‌های ذخیره/لغو */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={draft.items.length === 0}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  ذخیره تغییرات
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm"
                >
                  <X className="h-4 w-4" />
                  لغو
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ─── صفحه اصلی ────────────────────────────────────────────────────────────────

function HistoryPageInner() {
  const [list] = invoice.useHistory();

  return (
    <Layout>
      <h1 className="mb-4 text-lg font-bold">تاریخچه فاکتورها</h1>
      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <HistoryIcon className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">هنوز فاکتوری ثبت نشده است.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((inv) => (
            <InvoiceCard key={inv.id} inv={inv} />
          ))}
        </ul>
      )}
    </Layout>
  );
}

function HistoryPage() {
  return <AuthGuard><HistoryPageInner /></AuthGuard>;
}
