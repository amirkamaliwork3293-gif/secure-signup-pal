import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchStoreProfile, type PublicStoreProfile } from "@/lib/storeProfile";
import { openExternal, toIntlPhone } from "@/lib/openExternal";
import { Store, MapPin, Phone, Clock, Instagram, Send, MessageCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/store/$storeId")({
  head: () => ({
    meta: [{ title: "معرفی فروشگاه" }, { name: "description", content: "صفحه‌ی معرفی فروشگاه" }],
  }),
  component: StorePage,
});

// این صفحه عمومی است و بدون ورود (Auth) قابل مشاهده است.
function StorePage() {
  const { storeId } = Route.useParams();
  const [profile, setProfile] = useState<PublicStoreProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");

  useEffect(() => {
    let alive = true;
    fetchStoreProfile(storeId)
      .then((p) => {
        if (!alive) return;
        if (
          p &&
          (p.shopName || p.address || (p.phones && p.phones.length) || p.description || p.logoUrl)
        ) {
          setProfile(p);
          setState("ready");
        } else {
          setState("notfound");
        }
      })
      .catch(() => alive && setState("notfound"));
    return () => {
      alive = false;
    };
  }, [storeId]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" dir="rtl">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (state === "notfound" || !profile) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center"
        dir="rtl"
      >
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-muted">
          <Store className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">اطلاعات این فروشگاه هنوز ثبت نشده است.</p>
      </div>
    );
  }

  const socials = profile.socials ?? {};
  const hasSocial = !!(socials.instagram || socials.telegram || socials.whatsapp);

  return (
    <div className="min-h-screen bg-background pb-10" dir="rtl">
      {/* هدر برند */}
      <header className="bg-gradient-primary px-6 pb-8 pt-10 text-center text-primary-foreground">
        {profile.logoUrl ? (
          <img
            src={profile.logoUrl}
            alt={profile.shopName ?? "لوگو"}
            className="mx-auto h-24 w-24 rounded-2xl border-2 border-white/30 object-cover shadow-elegant"
          />
        ) : (
          <div className="mx-auto grid h-24 w-24 place-items-center rounded-2xl border-2 border-white/30 bg-white/15 shadow-elegant">
            <Store className="h-10 w-10" />
          </div>
        )}
        {profile.shopName && (
          <h1 className="mt-4 text-2xl font-bold kamali-brand">{profile.shopName}</h1>
        )}
        {profile.description && (
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-primary-foreground/90">
            {profile.description}
          </p>
        )}
      </header>

      <main className="mx-auto -mt-5 max-w-md space-y-3 px-4">
        {/* آدرس */}
        {profile.address && (
          <InfoCard icon={<MapPin className="h-5 w-5 text-primary" />} title="آدرس">
            <p className="text-sm leading-6">{profile.address}</p>
          </InfoCard>
        )}

        {/* تلفن‌ها */}
        {profile.phones && profile.phones.length > 0 && (
          <InfoCard icon={<Phone className="h-5 w-5 text-primary" />} title="تماس">
            <div className="flex flex-col gap-2">
              {profile.phones.map((ph, i) => (
                <button
                  key={i}
                  onClick={() => openExternal(`tel:${ph}`)}
                  className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm"
                >
                  <span dir="ltr" className="font-medium">
                    {ph}
                  </span>
                  <span className="text-xs text-primary">تماس</span>
                </button>
              ))}
            </div>
          </InfoCard>
        )}

        {/* ساعات کاری */}
        {profile.hours && (
          <InfoCard icon={<Clock className="h-5 w-5 text-primary" />} title="ساعات کاری">
            <p className="text-sm leading-6">{profile.hours}</p>
          </InfoCard>
        )}

        {/* شبکه‌های اجتماعی */}
        {hasSocial && (
          <InfoCard icon={<Send className="h-5 w-5 text-primary" />} title="شبکه‌های اجتماعی">
            <div className="flex flex-wrap gap-2">
              {socials.instagram && (
                <SocialButton
                  icon={<Instagram className="h-4 w-4" />}
                  label="اینستاگرام"
                  onClick={() => openExternal(normalizeInstagram(socials.instagram!))}
                />
              )}
              {socials.telegram && (
                <SocialButton
                  icon={<Send className="h-4 w-4" />}
                  label="تلگرام"
                  onClick={() => openExternal(normalizeTelegram(socials.telegram!))}
                />
              )}
              {socials.whatsapp && (
                <SocialButton
                  icon={<MessageCircle className="h-4 w-4" />}
                  label="واتساپ"
                  onClick={() => openExternal(`https://wa.me/${toIntlPhone(socials.whatsapp!)}`)}
                />
              )}
            </div>
          </InfoCard>
        )}
      </main>

      <footer className="mt-8 text-center text-[11px] text-muted-foreground">
        ساخته‌شده با کمالی حسابداری
      </footer>
    </div>
  );
}

function normalizeInstagram(v: string): string {
  if (/^https?:\/\//i.test(v)) return v;
  return `https://instagram.com/${v.replace(/^@/, "")}`;
}

function normalizeTelegram(v: string): string {
  if (/^https?:\/\//i.test(v)) return v;
  return `https://t.me/${v.replace(/^@/, "")}`;
}

function InfoCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function SocialButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
    >
      {icon}
      {label}
    </button>
  );
}
