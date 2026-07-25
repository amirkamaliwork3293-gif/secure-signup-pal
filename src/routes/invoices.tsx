import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { InvoiceActions } from "@/components/InvoiceActions";
import {
  invoice,
  purchases,
  formatToman,
  formatNumber,
  formatJalaliDateTime,
  PAYMENT_LABEL,
} from "@/lib/store";
import {
  Receipt,
  ShoppingBag,
  Plus,
  User,
  Truck,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  ListChecks,
} from "lucide-react";

export const Route = createFileRoute("/invoices")({
  head: () => ({
    meta: [
      { title: "فاکتورها | KAMIX" },
      { name: "description", content: "همه‌ی فاکتورهای فروش و خرید، دسته‌بندی‌شده در یک جا." },
    ],
  }),
  component: InvoicesPage,
});

type Tab = "sales" | "purchases";

function InvoicesPageInner() {
  const [tab, setTab] = useState<Tab>("sales");
  const [salesHistory] = invoice.useHistory();
  const [purchaseHistory] = purchases.useHistory();

  const salesTotal = useMemo(() => salesHistory.reduce((s, i) => s + i.total, 0), [salesHistory]);
  const purchasesTotal = useMemo(
    () => purchaseHistory.reduce((s, p) => s + p.total, 0),
    [purchaseHistory],
  );

  const recentSales = salesHistory.slice(0, 15);
  const recentPurchases = purchaseHistory.slice(0, 15);

  return (
    <Layout>
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <ListChecks className="h-5 w-5 text-primary" />
          فاکتورها
        </h1>
        <p className="text-xs text-muted-foreground">
          فاکتورهای فروش و خرید — همه در یک جا، دسته‌بندی‌شده
        </p>
      </div>

      {/* تب‌های فروش / خرید */}
      <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-1.5 shadow-card">
        <button
          type="button"
          onClick={() => setTab("sales")}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition ${
            tab === "sales"
              ? "bg-gradient-primary text-primary-foreground shadow-elegant"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          <Receipt className="h-4 w-4" />
          فاکتور فروش
        </button>
        <button
          type="button"
          onClick={() => setTab("purchases")}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition ${
            tab === "purchases"
              ? "bg-gradient-primary text-primary-foreground shadow-elegant"
              : "text-muted-foreground hover:bg-accent"
          }`}
        >
          <ShoppingBag className="h-4 w-4" />
          فاکتور خرید
        </button>
      </div>

      {tab === "sales" ? (
        <>
          {/* آمار فروش */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-elegant">
              <div className="flex items-center justify-between">
                <TrendingUp className="h-6 w-6 opacity-80" />
                <span className="text-[10px] opacity-80">جمع کل فروش</span>
              </div>
              <div className="mt-2 text-lg font-bold">{formatToman(salesTotal)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <div className="flex items-center justify-between">
                <Receipt className="h-6 w-6 text-primary" />
                <span className="text-[10px] text-muted-foreground">تعداد فاکتور</span>
              </div>
              <div className="mt-2 text-lg font-bold">{formatNumber(salesHistory.length)}</div>
            </div>
          </div>

          <Link
            to="/"
            className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-elegant hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            فاکتور فروش جدید
          </Link>

          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">فاکتورهای اخیر</h2>
            <Link to="/history" className="flex items-center gap-1 text-xs font-medium text-primary">
              مشاهده همه در تاریخچه
              <ArrowLeft className="h-3 w-3" />
            </Link>
          </div>

          {recentSales.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <Receipt className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">هنوز فاکتور فروشی ثبت نشده است.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {recentSales.map((inv) => {
                const customerName = inv.customer
                  ? [inv.customer.firstName, inv.customer.lastName].filter(Boolean).join(" ")
                  : "";
                return (
                  <li
                    key={inv.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-card"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-primary">
                          {formatToman(inv.total)}
                        </span>
                        {inv.paymentMethod && (
                          <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {PAYMENT_LABEL[inv.paymentMethod]}
                          </span>
                        )}
                        {customerName && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <User className="h-3 w-3" />
                            {customerName}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {formatJalaliDateTime(inv.createdAt)} · {inv.items.length.toLocaleString("fa-IR")} قلم
                      </div>
                    </div>
                    <InvoiceActions inv={inv} size="sm" />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          {/* آمار خرید */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-gradient-primary p-4 text-primary-foreground shadow-elegant">
              <div className="flex items-center justify-between">
                <TrendingDown className="h-6 w-6 opacity-80" />
                <span className="text-[10px] opacity-80">جمع کل خرید</span>
              </div>
              <div className="mt-2 text-lg font-bold">{formatToman(purchasesTotal)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <div className="flex items-center justify-between">
                <ShoppingBag className="h-6 w-6 text-primary" />
                <span className="text-[10px] text-muted-foreground">تعداد فاکتور</span>
              </div>
              <div className="mt-2 text-lg font-bold">{formatNumber(purchaseHistory.length)}</div>
            </div>
          </div>

          <Link
            to="/purchases"
            className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-elegant hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            فاکتور خرید جدید
          </Link>

          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">فاکتورهای اخیر</h2>
            <Link to="/purchases" className="flex items-center gap-1 text-xs font-medium text-primary">
              مشاهده همه
              <ArrowLeft className="h-3 w-3" />
            </Link>
          </div>

          {recentPurchases.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">هنوز فاکتور خریدی ثبت نشده است.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {recentPurchases.map((p) => (
                <li key={p.id} className="rounded-xl border border-border bg-card p-3 shadow-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                      {p.supplierName || "بدون نام تامین‌کننده"}
                    </span>
                    {p.paymentMethod && (
                      <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {PAYMENT_LABEL[p.paymentMethod]}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatJalaliDateTime(p.createdAt)} · {p.items.length.toLocaleString("fa-IR")} قلم
                  </div>
                  <div className="mt-1 text-sm font-bold text-primary">{formatToman(p.total)}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Layout>
  );
}

function InvoicesPage() {
  return (
    <AuthGuard>
      <InvoicesPageInner />
    </AuthGuard>
  );
}
