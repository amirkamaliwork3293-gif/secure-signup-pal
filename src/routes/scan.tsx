import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Layout } from "@/components/Layout";
import { Scanner } from "@/components/Scanner";
import { products, invoice, addProductToInvoice, formatToman, stockStatus } from "@/lib/store";
import { CheckCircle2, AlertCircle, Plus, Search, X, Package, Mic } from "lucide-react";

export const Route = createFileRoute("/scan")({
  head: () => ({
    meta: [
      { title: "اسکن بارکد | کمالی حسابداری" },
      { name: "description", content: "اسکن سریع QR و بارکد محصولات با دوربین موبایل." },
    ],
  }),
  component: ScanPage,
});

type LastScan =
  | { kind: "found"; name: string; price: number; code: string; stock: number }
  | { kind: "unknown"; code: string }
  | null;

function ScanPageInner() {
  const [last, setLast] = useState<LastScan>(null);
  const [paused, setPaused] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [allProducts] = products.useAll();
  const searchRef = useRef<HTMLInputElement>(null);

  const handleCode = (code: string) => {
    const product = products.findByCode(code);
    if (product) {
      const status = stockStatus(product);
      if (status === "out") {
        setLast({ kind: "unknown", code: `اتمام موجودی: ${product.name}` });
        setPaused(true);
        return;
      }
      const current = invoice.getCurrent();
      const next = addProductToInvoice(current, product);
      invoice.save(next);
      setLast({
        kind: "found",
        name: product.name,
        price: product.price,
        code,
        stock: product.stock,
      });
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(40);
    } else {
      setLast({ kind: "unknown", code });
      setPaused(true);
    }
  };

  const addFromSearch = (productId: string) => {
    const p = allProducts.find((x) => x.id === productId);
    if (!p) return;
    const status = stockStatus(p);
    if (status === "out") {
      alert(`محصول "${p.name}" موجودی ندارد.`);
      return;
    }
    const current = invoice.getCurrent();
    const next = addProductToInvoice(current, p);
    invoice.save(next);
    setLast({ kind: "found", name: p.name, price: p.price, code: p.code, stock: p.stock });
    setSearchQ("");
  };

  const filtered = searchQ.trim()
    ? allProducts.filter((p) => p.name.includes(searchQ) || p.code.includes(searchQ))
    : [];

  return (
    <Layout>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">اسکن محصول</h1>
        <Link
          to="/voice"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
        >
          <Mic className="h-3.5 w-3.5" />
          ثبت صوتی
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        کد QR یا بارکد محصول را داخل کادر دوربین قرار دهید.
      </p>

      <Scanner onDetected={handleCode} paused={paused} />

      {/* Manual search below scanner */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-3">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">یا جستجوی دستی محصول</div>
        <div className="relative">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            ref={searchRef}
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="نام یا بارکد محصول..."
            className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-8 text-sm outline-none focus:border-primary"
          />
          {searchQ && (
            <button
              onClick={() => setSearchQ("")}
              className="absolute left-2 top-2.5 text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {filtered.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {filtered.slice(0, 6).map((p) => {
              const s = stockStatus(p);
              return (
                <li key={p.id}>
                  <button
                    onClick={() => addFromSearch(p.id)}
                    disabled={s === "out"}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 text-right">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatToman(p.price)}
                        {s === "out" && <span className="mr-2 text-destructive">اتمام موجودی</span>}
                        {s === "low" && (
                          <span className="mr-2 text-amber-600">موجودی کم: {p.stock}</span>
                        )}
                      </div>
                    </div>
                    <Plus className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {searchQ.trim() && filtered.length === 0 && (
          <p className="mt-2 text-center text-xs text-muted-foreground py-2">محصولی یافت نشد</p>
        )}
      </div>

      {/* Scan result feedback */}
      <div className="mt-4 min-h-[88px]">
        {last?.kind === "found" && (
          <div className="flex items-start gap-3 rounded-2xl border border-success/30 bg-success/10 p-4 text-success-foreground">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div className="flex-1">
              <div className="font-semibold text-foreground">به فاکتور اضافه شد ✓</div>
              <div className="text-sm text-foreground/80">
                {last.name} — {formatToman(last.price)}
              </div>
              {last.stock <= 5 && last.stock > 0 && (
                <div className="mt-0.5 text-xs text-amber-600">
                  ⚠ موجودی کم: {last.stock.toLocaleString("fa-IR")} عدد
                </div>
              )}
              <div className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
                {last.code}
              </div>
            </div>
          </div>
        )}
        {last?.kind === "unknown" && (
          <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="flex-1">
              <div className="font-semibold">محصولی با این کد ثبت نشده</div>
              <div className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
                {last.code}
              </div>
              <div className="mt-3 flex gap-2">
                <Link
                  to="/products"
                  search={{ code: last.code }}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  افزودن محصول
                </Link>
                <button
                  onClick={() => {
                    setLast(null);
                    setPaused(false);
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs"
                >
                  ادامه اسکن
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function ScanPage() {
  return (
    <AuthGuard>
      <ScanPageInner />
    </AuthGuard>
  );
}
