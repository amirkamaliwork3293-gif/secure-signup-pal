import { AuthGuard } from "@/components/AuthGuard";
import { RequireActiveSubscription } from "@/components/RequireActiveSubscription";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  products,
  production,
  settings,
  formatNumber,
  formatJalaliDateTime,
  parseNumberInput,
  getUnitDefs,
  addUnitDef,
  COUNT_UNIT,
  type Product,
} from "@/lib/store";
import {
  expandRecipeForQty,
  canProduce,
  consumptionByIngredient,
  SUGGESTED_PRODUCTION_UNITS,
  type RecipeIngredient,
  type ProductionEvent,
} from "@/lib/production";
import { filterAndRankSearch } from "@/lib/search";
import {
  Factory, Plus, Trash2, Search, ChefHat, FlaskConical, BarChart3,
  Scale, AlertTriangle, Check, X, Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/production")({
  head: () => ({
    meta: [
      { title: "تولید و فرمول | KAMIX" },
      { name: "description", content: "فرمول ساخت محصول، کسر مواد اولیه و گزارش مصرف." },
    ],
  }),
  component: () => (
    <AuthGuard>
      <RequireActiveSubscription feature="تولید">
        <ProductionPage />
      </RequireActiveSubscription>
    </AuthGuard>
  ),
});

type Tab = "formulas" | "produce" | "reports" | "units";

function ProductionPage() {
  const [list, setList] = products.useAll();
  const [events] = production.useAll();
  const [appSettings] = settings.useAll();
  const [tab, setTab] = useState<Tab>("formulas");

  if (!appSettings.showProductionFeature) {
    return (
      <Layout>
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <Factory className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <h1 className="text-base font-bold">تولید و فرمول ساخت</h1>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-6 text-muted-foreground">
            این بخش برای کارگاه، کافه و تولیدی است. از تنظیمات فعالش کنید تا با فروش محصول، مواد فرمول از انبار کم شود.
          </p>
          <Link
            to="/settings"
            className="mt-4 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            رفتن به تنظیمات
          </Link>
        </div>
      </Layout>
    );
  }

  const withRecipe = list.filter((p) => p.recipe && p.recipe.length > 0);

  return (
    <Layout>
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <Factory className="h-5 w-5 text-primary" />
          تولید و فرمول
        </h1>
        <p className="text-xs text-muted-foreground">
          برای هر محصول ساخته‌شده مواد اولیه تعریف کنید. با فروش، موجودی مواد خودکار کم می‌شود.
        </p>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
        {(
          [
            { id: "formulas" as Tab, label: "فرمول‌ها", icon: FlaskConical },
            { id: "produce" as Tab, label: "تولید دسته", icon: ChefHat },
            { id: "reports" as Tab, label: "گزارش", icon: BarChart3 },
            { id: "units" as Tab, label: "واحدها", icon: Scale },
          ]
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium ${
              tab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "formulas" && (
        <FormulasTab list={list} setList={setList} withRecipe={withRecipe} />
      )}
      {tab === "produce" && <ProduceTab list={list} withRecipe={withRecipe} />}
      {tab === "reports" && <ReportsTab list={list} events={events} />}
      {tab === "units" && <UnitsTab />}
    </Layout>
  );
}

function FormulasTab({
  list,
  setList,
  withRecipe,
}: {
  list: Product[];
  setList: (v: Product[] | ((p: Product[]) => Product[])) => void;
  withRecipe: Product[];
}) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [pickQ, setPickQ] = useState("");
  const matches = pickQ.trim()
    ? filterAndRankSearch(list, pickQ, (p) => [p.name, p.code]).slice(0, 8)
    : [];

  const saveRecipe = (productId: string, recipe: RecipeIngredient[]) => {
    setList(list.map((p) => (p.id === productId ? { ...p, recipe: recipe.length ? recipe : undefined } : p)));
    setEditing(null);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-[11px] leading-6 text-muted-foreground">
        <Sparkles className="mb-1 inline h-3.5 w-3.5 text-primary" />{" "}
        مثال: برای «شیک نوتلا» ۱ لیتر شیر + خامه تعریف می‌کنید. هر بار که شیک فروخته شود، همان مقدار از موجودی شیر و خامه کم می‌شود.
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={pickQ}
          onChange={(e) => setPickQ(e.target.value)}
          placeholder="جستجوی محصول برای تعریف فرمول..."
          className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
        />
        {matches.length > 0 && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
            {matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setEditing(p); setPickQ(""); }}
                className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-right text-xs last:border-0 hover:bg-accent"
              >
                <span className="truncate font-medium">{p.name}</span>
                <span className="text-muted-foreground">
                  {p.recipe?.length ? `${p.recipe.length.toLocaleString("fa-IR")} ماده` : "بدون فرمول"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <RecipeEditor
          product={editing}
          catalog={list}
          onCancel={() => setEditing(null)}
          onSave={(recipe) => saveRecipe(editing.id, recipe)}
        />
      )}

      {withRecipe.length === 0 && !editing && (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
          هنوز فرمولی تعریف نشده. محصول ساخته‌شده را جستجو کنید.
        </div>
      )}

      <ul className="space-y-2">
        {withRecipe.map((p) => (
          <li key={p.id} className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{p.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  موجودی: {formatNumber(p.stock)} {p.unit || COUNT_UNIT}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditing(p)}
                className="rounded-lg border border-border px-2.5 py-1 text-[11px]"
              >
                ویرایش
              </button>
            </div>
            <ul className="mt-2 space-y-1">
              {(p.recipe || []).map((ing) => (
                <li key={ing.productId} className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{ing.name}</span>
                  <span dir="ltr">
                    {formatNumber(ing.quantity)} {ing.unit}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecipeEditor({
  product,
  catalog,
  onCancel,
  onSave,
}: {
  product: Product;
  catalog: Product[];
  onCancel: () => void;
  onSave: (recipe: RecipeIngredient[]) => void;
}) {
  const [rows, setRows] = useState<RecipeIngredient[]>(
    () => (product.recipe || []).map((r) => ({ ...r })),
  );
  const [q, setQ] = useState("");
  const candidates = q.trim()
    ? filterAndRankSearch(
        catalog.filter((p) => p.id !== product.id && !rows.some((r) => r.productId === p.id)),
        q,
        (p) => [p.name, p.code],
      ).slice(0, 6)
    : [];

  const addIng = (p: Product) => {
    setRows((prev) => [
      ...prev,
      { productId: p.id, name: p.name, quantity: 1, unit: p.unit || COUNT_UNIT },
    ]);
    setQ("");
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-bold">فرمول «{product.name}»</div>
          <div className="text-[11px] text-muted-foreground">مواد لازم برای ساخت ۱ {product.unit || "عدد"}</div>
        </div>
        <button type="button" onClick={onCancel} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="افزودن ماده اولیه از محصولات..."
          className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
        />
        {candidates.length > 0 && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            {candidates.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addIng(p)}
                className="flex w-full items-center justify-between px-3 py-2 text-right text-xs hover:bg-accent"
              >
                <span>{p.name}</span>
                <span className="text-muted-foreground">{p.unit || COUNT_UNIT}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">هنوز ماده‌ای اضافه نشده</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.productId} className="flex items-center gap-2 rounded-xl border border-border bg-background px-2 py-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{r.name}</span>
              <input
                defaultValue={r.quantity}
                key={`${r.productId}-${r.quantity}`}
                onBlur={(e) => {
                  const n = parseNumberInput(e.target.value);
                  setRows((prev) =>
                    prev.map((x) => (x.productId === r.productId ? { ...x, quantity: n > 0 ? n : x.quantity } : x)),
                  );
                }}
                inputMode="decimal"
                dir="ltr"
                className="h-8 w-16 rounded-lg border border-input bg-card px-2 text-center text-xs outline-none focus:border-primary"
              />
              <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{r.unit}</span>
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((x) => x.productId !== r.productId))}
                className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onSave(rows.filter((r) => r.quantity > 0))}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Check className="h-4 w-4" />
          ذخیره فرمول
        </button>
        {product.recipe?.length ? (
          <button
            type="button"
            onClick={() => {
              if (!confirm("فرمول این محصول حذف شود؟ فروش بعدی فقط موجودی خود محصول را کم می‌کند.")) return;
              onSave([]);
            }}
            className="rounded-xl border border-destructive/40 px-3 py-2.5 text-xs text-destructive"
          >
            حذف فرمول
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ProduceTab({ list, withRecipe }: { list: Product[]; withRecipe: Product[] }) {
  const [productId, setProductId] = useState(withRecipe[0]?.id || "");
  const [qtyStr, setQtyStr] = useState("1");
  const [note, setNote] = useState("");
  const product = list.find((p) => p.id === productId);
  const qty = parseNumberInput(qtyStr) || 0;
  const usage = product && qty > 0 ? expandRecipeForQty(product, qty, list) : [];
  const check = product && qty > 0 ? canProduce(product, qty, list) : { ok: true, missing: [] };

  const run = () => {
    if (!product || qty <= 0) {
      alert("محصول و تعداد معتبر انتخاب کنید.");
      return;
    }
    if (!check.ok) {
      const msg = check.missing
        .map((m) => `${m.name}: کمبود ${formatNumber(m.quantity)} ${m.unit}`)
        .join("\n");
      if (!confirm(`موجودی مواد کافی نیست:\n${msg}\n\nبا این حال تولید انجام شود؟`)) return;
    }
    const event = production.produce(product.id, qty, note.trim() || undefined);
    if (!event) {
      alert("برای این محصول فرمول تعریف نشده است.");
      return;
    }
    alert(`${formatNumber(qty)} ${product.unit || "عدد"} «${product.name}» به انبار اضافه شد.`);
    setQtyStr("1");
    setNote("");
  };

  if (withRecipe.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
        اول در زبانه «فرمول‌ها» مواد یک محصول را تعریف کنید.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-6 text-muted-foreground">
        تولید دسته برای وقتی است که از قبل آماده می‌کنید (مثلاً پخت شیرینی). مواد کم و موجودی محصول نهایی زیاد می‌شود. اگر همان لحظه‌ی فروش می‌سازید (مثل شیک)، نیازی به این مرحله نیست — فروش خودش مواد را کم می‌کند. محصولاتی که با تولید دسته ساخته شده‌اند، هنگام فروش دوباره از مواد کم نمی‌کنند.
      </p>
      <label className="block text-xs text-muted-foreground">محصول نهایی</label>
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
      >
        {withRecipe.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <label className="block text-xs text-muted-foreground">تعداد تولید</label>
      <input
        value={qtyStr}
        onChange={(e) => setQtyStr(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="یادداشت (اختیاری)"
        className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
      />

      {usage.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="mb-2 text-xs font-semibold">مواد مصرفی این دسته</div>
          <ul className="space-y-1">
            {usage.map((u) => {
              const have = list.find((p) => p.id === u.productId)?.stock ?? 0;
              const short = have + 1e-9 < u.quantity;
              return (
                <li key={u.productId} className="flex items-center justify-between text-xs">
                  <span>{u.name}</span>
                  <span className={short ? "font-medium text-destructive" : "text-muted-foreground"}>
                    {formatNumber(u.quantity)} {u.unit}
                    <span className="mr-1 text-[10px]">(موجودی {formatNumber(have)})</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {!check.ok && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              بعضی مواد کمتر از حد نیاز هستند.
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={run}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
      >
        <ChefHat className="h-4 w-4" />
        ثبت تولید
      </button>
    </div>
  );
}

function ReportsTab({ list, events }: { list: Product[]; events: ProductionEvent[] }) {
  const [kind, setKind] = useState<"all" | "sale" | "produce">("all");
  const filtered = useMemo(
    () => (kind === "all" ? events : events.filter((e) => e.kind === kind)),
    [events, kind],
  );
  const consumed = useMemo(() => consumptionByIngredient(filtered), [filtered]);
  const lowIngredients = list.filter((p) => {
    const usedAsIng = consumed.some((c) => c.productId === p.id);
    if (!usedAsIng) return false;
    const s = p.stock || 0;
    return s <= (p.lowStockThreshold ?? 5);
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {([
          { id: "all" as const, label: "همه" },
          { id: "sale" as const, label: "از فروش" },
          { id: "produce" as const, label: "تولید دسته" },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setKind(t.id)}
            className={`flex-1 rounded-lg py-1.5 text-xs ${kind === t.id ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="text-[10px] text-muted-foreground">تعداد رویداد</div>
          <div className="text-lg font-bold">{filtered.length.toLocaleString("fa-IR")}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="text-[10px] text-muted-foreground">مواد مصرف‌شده</div>
          <div className="text-lg font-bold">{consumed.length.toLocaleString("fa-IR")}</div>
        </div>
      </div>

      {lowIngredients.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" /> مواد رو به اتمام
          </div>
          <ul className="space-y-1 text-[11px]">
            {lowIngredients.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.name}</span>
                <span>{formatNumber(p.stock)} {p.unit || COUNT_UNIT}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="mb-2 text-xs font-semibold">مصرف مواد اولیه</div>
        {consumed.length === 0 ? (
          <p className="text-xs text-muted-foreground">هنوز مصرفی ثبت نشده است.</p>
        ) : (
          <ul className="space-y-1.5">
            {consumed.map((c) => (
              <li key={c.productId} className="flex items-center justify-between text-xs">
                <span className="truncate">{c.name}</span>
                <span className="text-muted-foreground">{formatNumber(c.quantity)} {c.unit}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="mb-2 text-xs font-semibold">سوابق اخیر</div>
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">سابقه‌ای نیست.</p>
        ) : (
          <ul className="space-y-2">
            {filtered.slice(0, 40).map((e) => (
              <li key={e.id} className="rounded-xl border border-border bg-background px-3 py-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {e.kind === "sale" ? "فروش" : "تولید"} {e.outputName} × {formatNumber(e.outputQty)}
                  </span>
                  <span className="text-muted-foreground">{formatJalaliDateTime(e.createdAt)}</span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {e.ingredients.map((i) => `${i.name} ${formatNumber(i.quantity)} ${i.unit}`).join("، ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function UnitsTab() {
  const [appSettings] = settings.useAll();
  const [name, setName] = useState("");
  const [allowDecimal, setAllowDecimal] = useState(true);
  const defs = getUnitDefs();
  const unusedSuggestions = SUGGESTED_PRODUCTION_UNITS.filter(
    (s) => !defs.some((d) => d.name === s.name),
  );

  const add = (n: string, dec: boolean) => {
    const trimmed = n.trim();
    if (!trimmed) return;
    addUnitDef({ name: trimmed, allowDecimal: dec });
    setName("");
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-6 text-muted-foreground">
        واحدهایی مثل لیتر و گرم را خودتان می‌سازید. همین واحدها در فرم محصول و فرمول تولید استفاده می‌شوند.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {defs.map((u) => (
          <span key={u.name} className="rounded-full border border-border bg-card px-3 py-1 text-xs">
            {u.name}
            {u.allowDecimal ? " · اعشار" : ""}
          </span>
        ))}
      </div>
      {unusedSuggestions.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] text-muted-foreground">پیشنهاد سریع</div>
          <div className="flex flex-wrap gap-1.5">
            {unusedSuggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => add(s.name, s.allowDecimal)}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary"
              >
                <Plus className="h-3 w-3" />
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="واحد سفارشی (مثلاً پیمانه)"
          className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={allowDecimal} onChange={(e) => setAllowDecimal(e.target.checked)} />
          اعشار
        </label>
        <button
          type="button"
          onClick={() => add(name, allowDecimal)}
          className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
        >
          افزودن
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">واحد «عدد» قابل حذف نیست. واحدهای دیگر را از فرم محصول هم می‌توانید مدیریت کنید.</p>
      <span className="hidden">{appSettings.units?.length}</span>
    </div>
  );
}
