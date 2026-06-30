import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { fetchPublicMenu, SubscriptionExpiredError, type MenuCategory, type MenuItem } from "@/lib/menu";
import { fetchStoreProfile, StoreSubscriptionExpiredError, type PublicStoreProfile } from "@/lib/storeProfile";
import { Loader2, UtensilsCrossed, Image as ImageIcon } from "lucide-react";

export const Route = createFileRoute("/m/$userId")({
  head: () => ({
    meta: [
      { title: `منو | فروشگاه` },
      { name: "description", content: "منوی دیجیتال — فروشگاه" },
      { property: "og:title", content: `منوی فروشگاه` },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,700;1,500&family=Vazirmatn:wght@400;500;700;800&display=swap",
      },
    ],
  }),
  component: PublicMenuPage,
});

// تم بصری منوی کافه/رستوران — هم‌خانواده با صفحه‌ی پروفایل عمومی.
const C = {
  ink: "#0b0608",
  ink2: "#140a0d",
  wine: "#5b0d1b",
  wineGlow: "#7a1428",
  bronze: "#c9a96a",
  cream: "#f3e9d2",
  creamMute: "rgba(243,233,210,0.72)",
  hair: "rgba(201,169,106,0.28)",
};

function formatToman(n: number) {
  return new Intl.NumberFormat("fa-IR").format(n) + " تومان";
}

function PublicMenuPage() {
  const { userId } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
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
        if (e instanceof SubscriptionExpiredError || e instanceof StoreSubscriptionExpiredError || e?.message === "SUBSCRIPTION_EXPIRED") {
          setExpired(true);
        } else {
          setError(e?.message || "خطا در بارگذاری منو.");
        }
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
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: C.ink, color: C.bronze }}
      >
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }
  if (expired) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center"
        style={{ background: C.ink, color: C.cream, fontFamily: "Vazirmatn, sans-serif" }}
        dir="rtl"
      >
        <UtensilsCrossed className="h-10 w-10" style={{ color: C.bronze }} />
        <h2 className="text-lg font-bold" style={{ color: C.bronze }}>منو موقتاً در دسترس نیست</h2>
        <p className="max-w-xs text-xs leading-6" style={{ color: C.creamMute }}>
          اشتراک این فروشگاه به پایان رسیده است. پس از تمدید اشتراک توسط مدیر فروشگاه، منو دوباره نمایش داده می‌شود.
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6 text-center text-sm"
        style={{ background: C.ink, color: C.creamMute, fontFamily: "Vazirmatn, sans-serif" }}
      >
        {error}
      </div>
    );
  }

  return (
    <div
      className="min-h-screen pb-16"
      dir="rtl"
      style={{
        background: `radial-gradient(900px 500px at 50% -10%, ${C.wineGlow}33, transparent 60%), linear-gradient(180deg, ${C.ink} 0%, ${C.ink2} 100%)`,
        color: C.cream,
        fontFamily: "Vazirmatn, sans-serif",
      }}
    >
      <header
        className="sticky top-0 z-20 backdrop-blur"
        style={{
          background: "rgba(11,6,8,0.82)",
          borderBottom: `1px solid ${C.hair}`,
        }}
      >
        <div className="mx-auto max-w-3xl px-4 pb-3 pt-6 text-center">
            <div className="relative mx-auto h-24 w-24">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(from 220deg, ${C.bronze}, #6f5224, ${C.bronze})`,
                padding: 2,
              }}
            >
              <div
                className="grid h-full w-full place-items-center overflow-hidden rounded-full"
                style={{ background: C.ink }}
              >
                {profile?.logoUrl ? (
                  <img src={profile.logoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UtensilsCrossed className="h-10 w-10" style={{ color: C.bronze }} />
                )}
              </div>
            </div>
          </div>
          <div
            className="mx-auto mt-3 h-px w-12"
            style={{ background: `linear-gradient(90deg, transparent, ${C.bronze}, transparent)` }}
          />
          <h1
            className="mt-2 text-2xl"
            style={{
              fontFamily: "'Cormorant Garamond', Vazirmatn, serif",
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: C.cream,
            }}
          >
            {shopName}
          </h1>
          <p
            className="mt-0.5 text-[10px]"
            style={{ color: C.bronze, letterSpacing: "0.32em" }}
          >
            M E N U
          </p>
          {profile?.description && (
            <p className="mt-2 text-xs leading-6" style={{ color: C.creamMute }}>
              {profile.description}
            </p>
          )}
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

      <main className="mx-auto max-w-3xl px-4 py-6">
        {visibleItems.length === 0 ? (
          <div
            className="rounded-2xl py-14 text-center text-sm"
            style={{
              border: `1px dashed ${C.hair}`,
              color: C.creamMute,
              background: `linear-gradient(180deg, ${C.ink2}, ${C.ink})`,
            }}
          >
            آیتمی برای نمایش وجود ندارد.
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {visibleItems.map((it) => (
              <li
                key={it.id}
                className="overflow-hidden rounded-2xl transition"
                style={{
                  background: `linear-gradient(180deg, ${C.ink2}, ${C.ink})`,
                  border: `1px solid ${C.hair}`,
                  boxShadow: "0 18px 40px -28px rgba(0,0,0,0.85)",
                }}
              >
                {it.image_url ? (
                  <div className="relative h-32 w-full overflow-hidden sm:h-44">
                    <img
                      src={it.image_url}
                      alt={it.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-20"
                      style={{
                        background: `linear-gradient(180deg, transparent, ${C.ink2})`,
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className="grid h-32 w-full place-items-center sm:h-40"
                    style={{ background: C.ink, color: C.bronze }}
                  >
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}
                <div className="p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3
                      className="leading-tight"
                      style={{
                        fontFamily: "'Cormorant Garamond', Vazirmatn, serif",
                        fontWeight: 700,
                        fontSize: "1rem",
                        color: C.cream,
                      }}
                    >
                      {it.name}
                    </h3>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold sm:text-xs"
                      style={{
                        background: `${C.wine}55`,
                        color: C.bronze,
                        border: `1px solid ${C.hair}`,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {formatToman(Number(it.price))}
                    </span>
                  </div>
                  {it.description && (
                    <>
                      <div
                        className="my-2 h-px"
                        style={{
                          background: `linear-gradient(90deg, ${C.hair}, transparent)`,
                        }}
                      />
                      <p className="line-clamp-3 text-[11px] leading-5 sm:text-xs sm:leading-6" style={{ color: C.creamMute }}>
                        {it.description}
                      </p>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <p
          className="mt-10 text-center text-[10px]"
          style={{ color: C.creamMute, letterSpacing: "0.18em" }}
        >
          قدرت گرفته از کمالی حسابداری
        </p>
      </main>
    </div>
  );
}

function Tab({ id, label, active, onClick }: { id: string; label: string; active: boolean; onClick: (id: string) => void }) {
  return (
    <button
      onClick={() => onClick(id)}
      className="whitespace-nowrap rounded-full px-4 py-1.5 text-xs transition"
      style={
        active
          ? {
              background: `linear-gradient(180deg, ${C.wine}, #3a0712)`,
              color: C.cream,
              border: `1px solid ${C.bronze}`,
              fontWeight: 700,
              letterSpacing: "0.04em",
              boxShadow: `0 6px 18px -8px ${C.wine}cc`,
            }
          : {
              background: "transparent",
              color: C.creamMute,
              border: `1px solid ${C.hair}`,
              fontWeight: 500,
            }
      }
    >
      {label}
    </button>
  );
}