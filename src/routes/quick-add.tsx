import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Layout } from "@/components/Layout";
import { products, cryptoId, type Product } from "@/lib/store";
import { generateUniqueCode } from "@/lib/barcode";
import { BarcodePrintModal } from "@/components/BarcodePrintModal";
import { Plus, Trash2, Zap, Printer, ArrowRight } from "lucide-react";

type Draft = { id: string; name: string; price: string };

export const Route = createFileRoute("/quick-add")({
  head: () => ({ meta: [{ title: "ثبت سریع محصولات | کمالی حسابداری" }] }),
  component: () => <AuthGuard><QuickAdd /></AuthGuard>,
});

function QuickAdd() {
  const [drafts, setDrafts] = useState<Draft[]>([{ id: cryptoId(), name: "", price: "" }]);
  const [printItems, setPrintItems] = useState<Product[] | null>(null);

  const add = () => setDrafts((p) => [...p, { id: cryptoId(), name: "", price: "" }]);
  const update = (id: string, k: keyof Draft, v: string) => setDrafts((p) => p.map((d) => d.id === id ? { ...d, [k]: v } : d));
  const remove = (id: string) => setDrafts((p) => p.length > 1 ? p.filter((d) => d.id !== id) : p);

  const submit = (andPrint: boolean) => {
    const valid = drafts.filter((d) => d.name.trim() && Number(d.price));
    if (valid.length === 0) { alert("حداقل یک محصول با نام و قیمت وارد کنید."); return; }
    const existing = products.getAll();
    const taken = new Set(existing.map((p) => p.code).filter(Boolean));
    const created: Product[] = valid.map((d) => ({
      id: cryptoId(), name: d.name.trim(), price: Number(d.price), code: generateUniqueCode(taken),
      stock: 0, category: "",
    }));
    products.save([...created, ...existing]);
    if (andPrint) setPrintItems(created);
    else {
      alert(`${created.length.toLocaleString("fa-IR")} محصول با بارکد ثبت شد.`);
      setDrafts([{ id: cryptoId(), name: "", price: "" }]);
    }
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Zap className="h-5 w-5 text-primary" />ثبت سریع محصولات</h1>
          <p className="text-xs text-muted-foreground">فقط نام و قیمت — بارکد یکتا خودکار تولید می‌شود</p>
        </div>
        <Link to="/products" className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs">
          <ArrowRight className="h-3.5 w-3.5" /> محصولات
        </Link>
      </div>

      <div className="space-y-2">
        {drafts.map((d, i) => (
          <div key={d.id} className="flex gap-2 rounded-xl border border-border bg-card p-2">
            <span className="grid h-9 w-7 place-items-center text-xs text-muted-foreground">{(i + 1).toLocaleString("fa-IR")}</span>
            <input value={d.name} onChange={(e) => update(d.id, "name", e.target.value)} placeholder="نام محصول"
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <input value={d.price} onChange={(e) => update(d.id, "price", e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="قیمت"
              className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            <button onClick={() => remove(d.id)} className="grid h-9 w-9 place-items-center rounded-lg text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button onClick={add} className="mt-2 w-full inline-flex items-center justify-center gap-1 rounded-xl border border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground hover:bg-accent">
        <Plus className="h-4 w-4" /> افزودن ردیف
      </button>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={() => submit(false)} className="rounded-xl border border-border px-4 py-3 text-sm font-medium">ذخیره</button>
        <button onClick={() => submit(true)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground">
          <Printer className="h-4 w-4" /> ذخیره و چاپ بارکد
        </button>
      </div>

      {printItems && <BarcodePrintModal items={printItems} onClose={() => { setPrintItems(null); setDrafts([{ id: cryptoId(), name: "", price: "" }]); }} />}
    </Layout>
  );
}
