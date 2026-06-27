import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { fetchPublicMenu, type MenuCategory, type MenuItem } from "@/lib/menu";
import { fetchStoreProfile, type PublicStoreProfile } from "@/lib/storeProfile";
import { Loader2, UtensilsCrossed, Image as ImageIcon } from "lucide-react";

export const Route = createFileRoute("/m/$userId")({
  head: ({ params }) => ({
    meta: [
      { title: `منو | فروشگاه` },
      { name: "description", content: "منوی دیجیتال — فروشگاه" },
      { property: "og:title", content: `منوی فروشگاه` },
    ],
  }),
  component: PublicMenuPage,
});

function formatToman(n: number) {
  return new Intl.NumberFormat("fa-IR").format(n) + " تومان";
}

function PublicMenuPage() {
  const { userId } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [profile, setProfile] = useState<PublicStoreProfile | null>(null);
  const [activeCat, setActiveCat] = useState<string>("__all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [menu, prof] = await Promise.all([
          fetchPublicMenu(userId),
          fetchStoreProfile(userId).catch(() => null),
        ]);
        setCats(menu.categories);
        setItems(menu.items);
        setProfile(prof);
      } catch (e: any) {
        setError(e?.message || "خطا در بارگذاری منو.");
      }
      setLoading(false);
    })();
  }, [userId]);

  const visibleItems = useMemo(() => {
    if (activeCat === "__all") return items;
    if (activeCat === "__none") return items.filter((i) => !i.category_id);
    return items.filter((i) => i.category_id === activeCat);
  }, [items, activeCat]);

  const shopName = profile?.shopName || "منوی فروشگاه";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/60 pb-16">
      <header className="sticky top-0 z-20 border-b border-border/40 bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-4 text-center">
          <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-elegant">
            {profile?.logoUrl ? (
              <img src={profile.logoUrl} alt="" className="h-full w-full rounded-2xl object-cover" />
            ) : (
              <UtensilsCrossed className="h-6 w-6" />
            )}
          </div>
          <h1 className="text-xl font-bold kamali-brand">{shopName}</h1>
          {profile?.description && <p className="mt-1 text-xs text-muted-foreground">{profile.description}</p>}
        </div>

        {cats.length > 0 && (
          <nav className="mx-auto max-w-3xl overflow-x-auto px-3 pb-3">
            <div className="flex w-max gap-2">
              <Tab id="__all" label="همه" active={activeCat === "__all"} onClick={setActiveCat} />
              {cats.map((c) => (
                <Tab key={c.id} id={c.id} label={c.name} active={activeCat === c.id} onClick={setActiveCat} />
              ))}
              {items.some((i) => !i.category_id) && (
                <Tab id="__none" label="سایر" active={activeCat === "__none"} onClick={setActiveCat} />
              )}
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
            آیتمی برای نمایش وجود ندارد.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visibleItems.map((it) => (
              <li key={it.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card transition hover:shadow-elegant">
                {it.image_url ? (
                  <img src={it.image_url} alt={it.name} className="h-44 w-full object-cover" loading="lazy" />
                ) : (
                  <div className="grid h-44 w-full place-items-center bg-muted text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold">{it.name}</h3>
                    <span className="shrink-0 text-sm font-bold text-primary">{formatToman(Number(it.price))}</span>
                  </div>
                  {it.description && <p className="mt-1 text-xs leading-6 text-muted-foreground">{it.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-center text-[10px] text-muted-foreground">قدرت گرفته از کمالی حسابداری</p>
      </main>
    </div>
  );
}

function Tab({ id, label, active, onClick }: { id: string; label: string; active: boolean; onClick: (id: string) => void }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`whitespace-nowrap rounded-full border px-4 py-1.5 text-xs font-medium transition ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}