import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/AuthGuard";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/AuthContext";
import {
  listCategories, listItems, createCategory, deleteCategory,
  createItem, updateItem, deleteItem, uploadMenuImage,
  type MenuCategory, type MenuItem,
} from "@/lib/menu";
import {
  UtensilsCrossed, Plus, Trash2, QrCode, Image as ImageIcon, Loader2, X, Eye, Pencil, Power,
} from "lucide-react";

export const Route = createFileRoute("/menu")({
  head: () => ({ meta: [{ title: "منوی دیجیتال | KAMIX" }] }),
  component: () => (
    <AuthGuard>
      <MenuPage />
    </AuthGuard>
  ),
});

function formatToman(n: number) {
  return new Intl.NumberFormat("fa-IR").format(n) + " تومان";
}

function MenuPage() {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.session.user.id : "";
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCat, setNewCat] = useState("");
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [showNew, setShowNew] = useState(false);

  const reload = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [c, i] = await Promise.all([listCategories(userId), listItems(userId)]);
      setCats(c); setItems(i);
    } catch (e: any) { alert(e?.message || "خطا در بارگذاری"); }
    setLoading(false);
  };

  useEffect(() => { void reload(); }, [userId]);

  const addCat = async () => {
    if (!newCat.trim()) return;
    try { await createCategory(userId, newCat); setNewCat(""); await reload(); }
    catch (e: any) { alert(e?.message); }
  };

  const removeCat = async (id: string) => {
    if (!confirm("این دسته حذف شود؟ (آیتم‌های مرتبط بدون دسته می‌شوند)")) return;
    await deleteCategory(id); await reload();
  };

  const toggleAvailable = async (it: MenuItem) => {
    await updateItem(it.id, { is_available: !it.is_available });
    await reload();
  };

  const removeItem = async (id: string) => {
    if (!confirm("این آیتم حذف شود؟")) return;
    await deleteItem(id); await reload();
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UtensilsCrossed className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold">منوی دیجیتال</h1>
        </div>
        <div className="flex gap-2">
          <Link to="/menu-qr" className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs">
            <QrCode className="h-3.5 w-3.5" /> QR منو
          </Link>
          <Link to="/m/$userId" params={{ userId }} className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs">
            <Eye className="h-3.5 w-3.5" /> پیش‌نمایش
          </Link>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">دسته‌بندی‌ها</h2>
        <div className="mb-2 flex flex-wrap gap-2">
          {cats.map((c) => (
            <span key={c.id} className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs">
              {c.name}
              <button onClick={() => removeCat(c.id)} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
            </span>
          ))}
          {cats.length === 0 && <span className="text-xs text-muted-foreground">هنوز دسته‌ای ایجاد نشده است.</span>}
        </div>
        <div className="flex gap-2">
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="مثلاً: نوشیدنی گرم"
            className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          <button onClick={addCat} className="flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
            <Plus className="h-4 w-4" /> افزودن
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">آیتم‌های منو ({items.length})</h2>
        <button onClick={() => { setEditing(null); setShowNew(true); }} className="flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs text-primary-foreground">
          <Plus className="h-3.5 w-3.5" /> آیتم جدید
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          هنوز آیتمی اضافه نشده. روی «آیتم جدید» بزنید.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const cat = cats.find((c) => c.id === it.category_id);
            return (
              <li key={it.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3">
                {it.image_url ? (
                  <img src={it.image_url} alt={it.name} className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                ) : (
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>
                )}
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{it.name}</div>
                      <div className="text-xs text-muted-foreground">{cat?.name ?? "بدون دسته"} • {formatToman(Number(it.price))}</div>
                      {it.description && <div className="mt-1 text-xs">{it.description}</div>}
                    </div>
                    {!it.is_available && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">ناموجود</span>}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => { setEditing(it); setShowNew(true); }} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] hover:bg-accent">
                      <Pencil className="h-3 w-3" /> ویرایش
                    </button>
                    <button onClick={() => toggleAvailable(it)} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] hover:bg-accent">
                      <Power className="h-3 w-3" /> {it.is_available ? "ناموجود" : "موجود"}
                    </button>
                    <button onClick={() => removeItem(it.id)} className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showNew && (
        <ItemModal
          userId={userId}
          categories={cats}
          initial={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={async () => { setShowNew(false); setEditing(null); await reload(); }}
        />
      )}
    </Layout>
  );
}

function ItemModal({
  userId, categories, initial, onClose, onSaved,
}: {
  userId: string;
  categories: MenuCategory[];
  initial: MenuItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [price, setPrice] = useState(String(initial?.price ?? ""));
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [catId, setCatId] = useState<string>(initial?.category_id ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.image_url ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const pickImage = async (f: File | null) => {
    if (!f) return;
    setUploading(true);
    try { setImageUrl(await uploadMenuImage(userId, f)); }
    catch (e: any) { alert(e?.message || "خطا در آپلود"); }
    setUploading(false);
  };

  const save = async () => {
    if (!name.trim()) { alert("نام آیتم لازم است."); return; }
    const p = Number(price.replace(/[^\d.]/g, "")) || 0;
    setSaving(true);
    try {
      if (initial) {
        await updateItem(initial.id, {
          name: name.trim(), price: p, description: desc.trim() || null,
          category_id: catId || null, image_url: imageUrl,
        });
      } else {
        await createItem(userId, {
          name: name.trim(), price: p, description: desc.trim() || null,
          category_id: catId || null, image_url: imageUrl,
        });
      }
      onSaved();
    } catch (e: any) { alert(e?.message); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/50 p-4 sm:items-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-elegant">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">{initial ? "ویرایش آیتم" : "آیتم جدید منو"}</h3>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">نام محصول</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">قیمت (تومان)</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" dir="ltr" className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">دسته‌بندی</label>
              <select value={catId} onChange={(e) => setCatId(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">توضیح (اختیاری)</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">عکس آیتم</label>
            {imageUrl && <img src={imageUrl} alt="" className="mb-2 max-h-40 rounded-xl object-contain" />}
            <input type="file" accept="image/*" onChange={(e) => pickImage(e.target.files?.[0] ?? null)} className="text-xs" />
            {uploading && <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />در حال آپلود…</div>}
          </div>
          <button onClick={save} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            ذخیره
          </button>
        </div>
      </div>
    </div>
  );
}