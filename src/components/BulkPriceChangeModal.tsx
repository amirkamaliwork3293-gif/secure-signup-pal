import { useMemo, useState } from "react";
import { X, Percent, Banknote, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import {
  formatToman,
  formatNumber,
  parseNumberInput,
  type Product,
  type Category,
} from "@/lib/store";
import {
  applyBulkPriceChange,
  applyPriceDelta,
  PRICE_FIELD_LABEL,
  type PriceField,
  type BulkPriceMode,
  type BulkPriceDirection,
} from "@/lib/bulk-price";

const ROUND_OPTIONS = [
  { v: 0, label: "بدون گرد کردن" },
  { v: 100, label: "۱۰۰ تومان" },
  { v: 1000, label: "۱٬۰۰۰ تومان" },
  { v: 5000, label: "۵٬۰۰۰ تومان" },
  { v: 10000, label: "۱۰٬۰۰۰ تومان" },
] as const;

const ALL_FIELDS: PriceField[] = [
  "price",
  "buyPrice",
  "consumerPrice",
  "sellerPrice",
  "wholesalePrice",
];

type Scope = "all" | "filtered" | "selected" | "category";

export function BulkPriceChangeModal({
  products,
  filtered,
  selectedIds,
  categories,
  onClose,
  onApply,
}: {
  products: Product[];
  filtered: Product[];
  selectedIds: Set<string>;
  categories: Category[];
  onClose: () => void;
  onApply: (next: Product[]) => void;
}) {
  const [mode, setMode] = useState<BulkPriceMode>("percent");
  const [direction, setDirection] = useState<BulkPriceDirection>("up");
  const [valueStr, setValueStr] = useState("5");
  const [roundTo, setRoundTo] = useState(1000);
  const [fields, setFields] = useState<Set<PriceField>>(new Set(["price"]));
  const [applyEmpty, setApplyEmpty] = useState(false);
  const [scope, setScope] = useState<Scope>(selectedIds.size > 0 ? "selected" : "all");
  const [catName, setCatName] = useState(categories[0]?.name ?? "");
  const [err, setErr] = useState<string | null>(null);

  const value = parseNumberInput(valueStr);

  const targetList = useMemo(() => {
    if (scope === "selected") return products.filter((p) => selectedIds.has(p.id));
    if (scope === "filtered") return filtered;
    if (scope === "category") return products.filter((p) => p.category === catName);
    return products;
  }, [scope, products, filtered, selectedIds, catName]);

  const targetIds = useMemo(() => new Set(targetList.map((p) => p.id)), [targetList]);

  const preview = useMemo(() => {
    const sample = targetList.slice(0, 6);
    return sample.map((p) => ({
      id: p.id,
      name: p.name,
      old: p.price,
      next: applyPriceDelta(p.price, mode, direction, value, roundTo),
    }));
  }, [targetList, mode, direction, value, roundTo]);

  const toggleField = (f: PriceField) => {
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) {
        if (f === "price") return prev;
        next.delete(f);
      } else next.add(f);
      return next;
    });
  };

  const apply = () => {
    if (targetList.length === 0) {
      setErr("محصولی برای اعمال تغییر انتخاب نشده است.");
      return;
    }
    if (value <= 0) {
      setErr(mode === "percent" ? "درصد را وارد کنید." : "مبلغ را وارد کنید.");
      return;
    }
    const verb = direction === "up" ? "افزایش" : "کاهش";
    const how =
      mode === "percent" ? `${formatNumber(value)} درصد ${verb}` : `${formatToman(value)} ${verb}`;
    if (
      !confirm(
        `${how} روی قیمت ${formatNumber(targetList.length)} محصول اعمال شود؟ این عمل روی قیمت‌های ذخیره‌شده ثبت می‌گردد.`,
      )
    )
      return;
    const next = applyBulkPriceChange(products, targetIds, {
      mode,
      direction,
      value,
      roundTo,
      fields: Array.from(fields),
      applyEmpty,
    });
    onApply(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold">تغییر قیمت گروهی</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              یک‌جا قیمت همه یا بخشی از محصولات را درصدی یا مبلغی عوض کنید.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-secondary"
            aria-label="بستن"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setMode("percent")}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition ${
              mode === "percent"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border bg-background text-muted-foreground"
            }`}
          >
            <Percent className="h-3.5 w-3.5" />
            تغییر درصدی
          </button>
          <button
            type="button"
            onClick={() => setMode("amount")}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition ${
              mode === "amount"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border bg-background text-muted-foreground"
            }`}
          >
            <Banknote className="h-3.5 w-3.5" />
            مبلغ ثابت
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setDirection("up")}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
              direction === "up"
                ? "bg-emerald-600 text-white"
                : "border border-border bg-background text-muted-foreground"
            }`}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            افزایش
          </button>
          <button
            type="button"
            onClick={() => setDirection("down")}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition ${
              direction === "down"
                ? "bg-destructive text-destructive-foreground"
                : "border border-border bg-background text-muted-foreground"
            }`}
          >
            <TrendingDown className="h-3.5 w-3.5" />
            کاهش
          </button>
        </div>

        {mode === "percent" && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[5, 10, 15, 20, 30].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setValueStr(String(n))}
                className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                  value === n
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background text-muted-foreground"
                }`}
              >
                {direction === "up" ? "+" : "−"}٪{formatNumber(n)}
              </button>
            ))}
          </div>
        )}

        <label className="mb-3 block">
          <span className="mb-1.5 block text-[11px] text-muted-foreground">
            {mode === "percent" ? "درصد تغییر" : "مبلغ (تومان)"}
          </span>
          <input
            value={valueStr ? (mode === "amount" ? formatNumber(value) : valueStr) : ""}
            onChange={(e) => setValueStr(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            placeholder={mode === "percent" ? "مثلاً ۵" : "مثلاً ۱۰۰۰۰۰"}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </label>

        <div className="mb-3">
          <div className="mb-1.5 text-[11px] text-muted-foreground">اعمال روی</div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { k: "all" as const, label: `همه (${formatNumber(products.length)})` },
                { k: "filtered" as const, label: `نتایج فیلتر (${formatNumber(filtered.length)})` },
                ...(selectedIds.size > 0
                  ? [
                      {
                        k: "selected" as const,
                        label: `انتخاب‌شده (${formatNumber(selectedIds.size)})`,
                      },
                    ]
                  : []),
                ...(categories.length > 0 ? [{ k: "category" as const, label: "یک دسته" }] : []),
              ] as const
            ).map((o) => (
              <button
                key={o.k}
                type="button"
                onClick={() => setScope(o.k)}
                className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                  scope === o.k
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background text-muted-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {scope === "category" && categories.length > 0 && (
            <select
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="mb-3">
          <div className="mb-1.5 text-[11px] text-muted-foreground">کدام قیمت‌ها؟</div>
          <div className="flex flex-wrap gap-1.5">
            {ALL_FIELDS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleField(f)}
                className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                  fields.has(f)
                    ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                    : "border border-border bg-background text-muted-foreground"
                }`}
              >
                {PRICE_FIELD_LABEL[f]}
              </button>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={applyEmpty}
              onChange={(e) => setApplyEmpty(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            قیمت‌های خالی (خرید/همکار/عمده) هم پر شوند
          </label>
        </div>

        <div className="mb-3">
          <div className="mb-1.5 text-[11px] text-muted-foreground">گرد کردن نتیجه</div>
          <div className="flex flex-wrap gap-1.5">
            {ROUND_OPTIONS.map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setRoundTo(o.v)}
                className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                  roundTo === o.v
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background text-muted-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {preview.length > 0 && value > 0 && (
          <div className="mb-3 rounded-xl border border-border bg-background p-3">
            <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
              پیش‌نمایش قیمت فروش
            </div>
            <ul className="space-y-1.5">
              {preview.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="shrink-0 tabular-nums" dir="ltr">
                    <span className="text-muted-foreground">{formatToman(r.old)}</span>
                    <span className="mx-1 text-muted-foreground">←</span>
                    <span
                      className={
                        direction === "up"
                          ? "font-semibold text-emerald-700"
                          : "font-semibold text-destructive"
                      }
                    >
                      {formatToman(r.next)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {targetList.length > preview.length && (
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                و {formatNumber(targetList.length - preview.length)} محصول دیگر…
              </div>
            )}
          </div>
        )}

        {err && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={apply}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-elegant"
        >
          اعمال روی {formatNumber(targetList.length)} محصول
        </button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          قیمت فاکتورهای قبلی تغییر نمی‌کند؛ فقط قیمت محصولات انبار به‌روز می‌شود.
        </p>
      </div>
    </div>
  );
}
