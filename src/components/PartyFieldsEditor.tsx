import { useId, useMemo, useState } from "react";
import { Pin, PinOff, Plus, X, IdCard } from "lucide-react";
import {
  customerFields,
  fieldId,
  normalizeFieldLabel,
  PRESET_FIELD_LABELS,
  type CustomerField,
  type InvoicePartyField,
} from "@/lib/customer-fields";
import type { Customer } from "@/lib/store";

const inputCls =
  "w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus:border-primary";

/**
 * ویرایش فیلدهای اختصاصی در پروندهٔ مشتری.
 * سنجاق = روی هر فاکتور جدید همین مشتری خودکار می‌آید (روی فاکتور قابل تغییر است).
 */
export function CustomerFieldsEditor({
  value,
  onChange,
  suggestions,
}: {
  value: CustomerField[];
  onChange: (next: CustomerField[]) => void;
  suggestions: string[];
}) {
  const listId = useId();
  const used = new Set(value.map((f) => normalizeFieldLabel(f.label)));
  const quick = suggestions.filter((s) => !used.has(normalizeFieldLabel(s))).slice(0, 6);
  const set = (id: string, patch: Partial<CustomerField>) =>
    onChange(value.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const add = (label = "") =>
    onChange([...value, { id: fieldId(), label, value: "", pinned: true }]);

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium">
        <IdCard className="h-3.5 w-3.5 text-primary" />
        اطلاعات تکمیلی (کد ملی، نام شرکت، نشانی، …)
      </div>
      <p className="mb-2 text-[11px] leading-5 text-muted-foreground">
        فیلدهای سنجاق‌شده <Pin className="inline h-3 w-3" /> روی هر فاکتور جدید این مشتری خودکار چاپ
        می‌شوند و لازم نیست دوباره تایپ کنید.
      </p>
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <ul className="space-y-2">
        {value.map((f) => (
          <li key={f.id} className="flex items-start gap-1.5">
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-1.5">
              <input
                value={f.label}
                onChange={(e) => set(f.id, { label: e.target.value })}
                list={listId}
                placeholder="عنوان"
                aria-label="عنوان فیلد"
                className={inputCls}
              />
              <input
                value={f.value}
                onChange={(e) => set(f.id, { value: e.target.value })}
                placeholder="مقدار"
                aria-label={f.label || "مقدار"}
                className={inputCls}
              />
            </div>
            <button
              type="button"
              onClick={() => set(f.id, { pinned: !f.pinned })}
              title={f.pinned ? "سنجاق‌شده: روی فاکتورها می‌آید" : "سنجاق نشده"}
              aria-pressed={!!f.pinned}
              aria-label="سنجاق روی فاکتور"
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${
                f.pinned
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {f.pinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x.id !== f.id))}
              aria-label="حذف فیلد"
              className="grid h-9 w-8 shrink-0 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {quick.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => add(s)}
            className="rounded-lg border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
          >
            + {s}
          </button>
        ))}
        <button
          type="button"
          onClick={() => add()}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-primary/50 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/5"
        >
          <Plus className="h-3 w-3" /> فیلد دلخواه
        </button>
      </div>
    </div>
  );
}

/**
 * اطلاعات مشتری که روی همین فاکتور چاپ می‌شود. از فیلدهای سنجاق‌شدهٔ مشتری پر
 * می‌شود؛ تغییر اینجا فقط همین فاکتور را عوض می‌کند (مگر «ذخیره در پرونده» تیک بخورد).
 */
export function InvoicePartyFieldsEditor({
  customer,
  value,
  onChange,
  saveToProfile,
  onSaveToProfileChange,
  title = "اطلاعات تکمیلی مشتری روی این فاکتور",
}: {
  customer?: Customer;
  value: InvoicePartyField[];
  onChange: (next: InvoicePartyField[]) => void;
  saveToProfile?: boolean;
  onSaveToProfileChange?: (v: boolean) => void;
  title?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const listId = useId();
  const used = new Set(value.map((f) => normalizeFieldLabel(f.label)));
  const extra = useMemo(
    () =>
      customerFields(customer).filter(
        (f) => f.value.trim() && f.label.trim() && !used.has(normalizeFieldLabel(f.label)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customer, value],
  );
  const differsFromProfile =
    !!customer &&
    value.some((f) => {
      const p = customerFields(customer).find(
        (x) => normalizeFieldLabel(x.label) === normalizeFieldLabel(f.label),
      );
      return !p || p.value.trim() !== f.value.trim() || !p.pinned;
    });

  if (!customer && value.length === 0 && !adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary"
      >
        <Plus className="h-3 w-3" /> کد ملی / نام شرکت / نشانی روی فاکتور
      </button>
    );
  }

  const commitNew = () => {
    const label = newLabel.trim();
    const v = newValue.trim();
    if (!label || !v) return;
    onChange([
      ...value.filter((f) => normalizeFieldLabel(f.label) !== normalizeFieldLabel(label)),
      { label, value: v },
    ]);
    setNewLabel("");
    setNewValue("");
    setAdding(false);
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        <IdCard className="h-3.5 w-3.5 text-primary" />
        {title}
      </div>
      {value.length === 0 && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          فیلد سنجاق‌شده‌ای برای این مشتری نیست.
        </p>
      )}
      <ul className="space-y-1.5">
        {value.map((f, i) => (
          <li key={`${f.label}-${i}`} className="flex items-center gap-1.5">
            <span
              className="w-24 shrink-0 truncate text-[11px] text-muted-foreground"
              title={f.label}
            >
              {f.label}
            </span>
            <input
              value={f.value}
              onChange={(e) =>
                onChange(value.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
              }
              aria-label={f.label}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={`حذف ${f.label} از این فاکتور`}
              className="grid h-9 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {extra.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {extra.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange([...value, { label: f.label.trim(), value: f.value.trim() }])}
              className="rounded-lg border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
            >
              + {f.label}
            </button>
          ))}
        </div>
      )}
      {adding ? (
        <div className="mt-2 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-1.5">
          <datalist id={listId}>
            {PRESET_FIELD_LABELS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            list={listId}
            placeholder="عنوان (مثلاً کد ملی)"
            className={inputCls}
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitNew();
              }
            }}
            placeholder="مقدار"
            className={inputCls}
          />
          <button
            type="button"
            onClick={commitNew}
            className="rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
          >
            افزودن
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary"
        >
          <Plus className="h-3 w-3" /> فیلد دیگر برای این فاکتور
        </button>
      )}
      {customer && onSaveToProfileChange && differsFromProfile && value.length > 0 && (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={!!saveToProfile}
            onChange={(e) => onSaveToProfileChange(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          این مقدارها در پروندهٔ «
          {[customer.firstName, customer.lastName].filter(Boolean).join(" ")}» هم ذخیره و سنجاق شوند
          (برای فاکتورهای بعدی)
        </label>
      )}
    </div>
  );
}
