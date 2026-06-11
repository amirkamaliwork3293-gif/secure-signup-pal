/**
 * GlobalSearch — جستجوی سراسری و فوری روی محصولات، مشتریان، فاکتورها و بدهکاران.
 * همه داده‌ها محلی هستند؛ نتایج همزمان با تایپ نمایش داده می‌شوند.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  products, customers, invoice, customerBalance, customerFullName, formatToman,
  type Product, type Customer, type Invoice,
} from "@/lib/store";
import { Search, X, Package, Users, Receipt, Wallet, ChevronLeft } from "lucide-react";

const LIMIT = 5;

export function GlobalSearch() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
        title="جستجوی سراسری"
        aria-label="جستجو"
      >
        <Search className="h-4 w-4" />
      </button>
      {open && <SearchOverlay onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const query = q.trim();

  const results = useMemo(() => {
    if (!query) return null;
    const allProducts = products.getAll();
    const allCustomers = customers.getAll();
    const history = invoice.getHistory();

    const matchedProducts = allProducts
      .filter((p) => p.name.includes(query) || p.code.includes(query) || (p.category ?? "").includes(query))
      .slice(0, LIMIT);

    const matchedCustomers = allCustomers
      .filter((c) => customerFullName(c).includes(query) || (c.phone ?? "").includes(query))
      .slice(0, LIMIT);

    const matchedDebtors = matchedCustomers.filter((c) => customerBalance(c) > 0);

    const matchedInvoices = history
      .filter((inv) =>
        inv.id.toUpperCase().includes(query.toUpperCase()) ||
        [inv.customer?.firstName, inv.customer?.lastName].filter(Boolean).join(" ").includes(query) ||
        (inv.customer?.phone ?? "").includes(query) ||
        inv.items.some((i) => i.name.includes(query)),
      )
      .slice(0, LIMIT);

    return { matchedProducts, matchedCustomers, matchedDebtors, matchedInvoices };
  }, [query]);

  const go = (to: string, search?: Record<string, string>) => {
    onClose();
    navigate({ to, search } as never);
  };

  const empty =
    results &&
    results.matchedProducts.length === 0 &&
    results.matchedCustomers.length === 0 &&
    results.matchedInvoices.length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mx-auto mt-0 w-full max-w-md sm:mt-16 sm:rounded-3xl border border-border bg-card shadow-elegant overflow-hidden">
        {/* ورودی جستجو */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو: محصول، مشتری، فاکتور، بدهکار..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-2">
          {!query && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              نام محصول، بارکد، نام مشتری، شماره تلفن یا شماره فاکتور را تایپ کنید.
            </p>
          )}

          {empty && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">نتیجه‌ای یافت نشد.</p>
          )}

          {results && results.matchedProducts.length > 0 && (
            <Section icon={<Package className="h-3.5 w-3.5" />} title="محصولات">
              {results.matchedProducts.map((p: Product) => (
                <ResultRow
                  key={p.id}
                  title={p.name}
                  subtitle={`${formatToman(p.price)}${p.code ? ` · ${p.code}` : ""}`}
                  onClick={() => go("/products", { q: p.name })}
                />
              ))}
            </Section>
          )}

          {results && results.matchedDebtors.length > 0 && (
            <Section icon={<Wallet className="h-3.5 w-3.5" />} title="بدهکاران">
              {results.matchedDebtors.map((c: Customer) => (
                <ResultRow
                  key={`d-${c.id}`}
                  title={customerFullName(c)}
                  subtitle={`بدهی: ${formatToman(customerBalance(c))}`}
                  danger
                  onClick={() => go("/customers", { q: customerFullName(c) })}
                />
              ))}
            </Section>
          )}

          {results && results.matchedCustomers.length > 0 && (
            <Section icon={<Users className="h-3.5 w-3.5" />} title="مشتریان">
              {results.matchedCustomers.map((c: Customer) => (
                <ResultRow
                  key={c.id}
                  title={customerFullName(c)}
                  subtitle={c.phone || "بدون تلفن"}
                  onClick={() => go("/customers", { q: customerFullName(c) })}
                />
              ))}
            </Section>
          )}

          {results && results.matchedInvoices.length > 0 && (
            <Section icon={<Receipt className="h-3.5 w-3.5" />} title="فاکتورها">
              {results.matchedInvoices.map((inv: Invoice) => {
                const name = [inv.customer?.firstName, inv.customer?.lastName].filter(Boolean).join(" ");
                return (
                  <ResultRow
                    key={inv.id}
                    title={`${formatToman(inv.total)}${name ? ` — ${name}` : ""}`}
                    subtitle={`${new Date(inv.createdAt).toLocaleDateString("fa-IR")} · ${inv.id.toUpperCase()}`}
                    onClick={() => go("/history", { q: query })}
                  />
                );
              })}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
        {icon}
        {title}
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function ResultRow({
  title, subtitle, onClick, danger = false,
}: { title: string; subtitle?: string; onClick: () => void; danger?: boolean }) {
  return (
    <li>
      <button
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right hover:bg-accent"
      >
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-medium ${danger ? "text-destructive" : "text-foreground"}`}>{title}</div>
          {subtitle && <div className="truncate text-[11px] text-muted-foreground" dir="auto">{subtitle}</div>}
        </div>
        <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
