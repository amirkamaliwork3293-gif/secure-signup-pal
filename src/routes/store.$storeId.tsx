import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { fetchStoreProfile, type PublicStoreProfile } from "@/lib/storeProfile";
import { openExternal, toIntlPhone } from "@/lib/openExternal";
import {
  Store,
  MapPin,
  Phone,
  Clock,
  Instagram,
  Send,
  MessageCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X as XIcon,
} from "lucide-react";

export const Route = createFileRoute("/store/$storeId")({
  head: () => ({
    meta: [{ title: "معرفی فروشگاه" }, { name: "description", content: "صفحه‌ی معرفی فروشگاه" }],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,700;1,500&family=Vazirmatn:wght@400;500;700;800&display=swap",
      },
    ],
  }),
  component: StorePage,
});

// این صفحه عمومی است و بدون ورود (Auth) قابل مشاهده است.
// تم بصری: مشکی عمیق + زرشکی گرم + برنزی ملایم.
const C = {
  ink: "#0b0608", // پس‌زمینه‌ی اصلی، تقریباً مشکی با ته‌رنگ گرم
  ink2: "#140a0d",
  wine: "#5b0d1b", // زرشکی عمیق
  wineGlow: "#7a1428",
  bronze: "#c9a96a", // طلایی/برنزی ملایم
  cream: "#f3e9d2", // متن گرم
  creamMute: "rgba(243,233,210,0.72)",
  hair: "rgba(201,169,106,0.28)", // خط جداکننده
};

function StorePage() {
  const { storeId } = Route.useParams();
  const [profile, setProfile] = useState<PublicStoreProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetchStoreProfile(storeId)
      .then((p) => {
        if (!alive) return;
        if (
          p &&
          (p.shopName ||
            p.address ||
            (p.phones && p.phones.length) ||
            p.description ||
            p.logoUrl ||
            (p.portfolioImages && p.portfolioImages.length))
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

  const portfolio = profile?.portfolioImages ?? [];
  const closeLb = useCallback(() => setLightboxIdx(null), []);
  const stepLb = useCallback(
    (dir: -1 | 1) =>
      setLightboxIdx((i) =>
        i === null ? i : (i + dir + portfolio.length) % portfolio.length,
      ),
    [portfolio.length],
  );
  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLb();
      if (e.key === "ArrowRight") stepLb(1);
      if (e.key === "ArrowLeft") stepLb(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightboxIdx, closeLb, stepLb]);

  if (state === "loading") {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: C.ink, color: C.bronze }}
        dir="rtl"
      >
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (state === "notfound" || !profile) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center"
        style={{ background: C.ink, color: C.cream, fontFamily: "Vazirmatn, sans-serif" }}
        dir="rtl"
      >
        <div
          className="grid h-16 w-16 place-items-center rounded-2xl"
          style={{ background: C.ink2, border: `1px solid ${C.hair}`, color: C.bronze }}
        >
          <Store className="h-8 w-8" />
        </div>
        <p className="text-sm" style={{ color: C.creamMute }}>
          اطلاعات این فروشگاه هنوز ثبت نشده است.
        </p>
      </div>
    );
  }

  const socials = profile.socials ?? {};
  const hasSocial = !!(
    socials.instagram ||
    socials.telegram ||
    socials.whatsapp ||
    socials.rubika ||
    socials.eitaa ||
    socials.bale
  );

  return (
    <div
      className="min-h-screen pb-14"
      style={{
        background: `radial-gradient(1100px 600px at 50% -10%, ${C.wineGlow}33, transparent 60%), linear-gradient(180deg, ${C.ink} 0%, ${C.ink2} 100%)`,
        color: C.cream,
        fontFamily: "Vazirmatn, sans-serif",
      }}
      dir="rtl"
    >
      {/* هدر برند — حس بوتیک، با ترکیب مشکی/زرشکی و خط طلایی ظریف */}
      <header
        className="relative overflow-hidden px-6 pb-10 pt-14 text-center"
        style={{
          background: `linear-gradient(160deg, ${C.wine} 0%, #2a060f 55%, ${C.ink} 100%)`,
        }}
      >
        {/* بافت ظریف نقطه‌ای */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)",
            backgroundSize: "18px 18px",
          }}
        />
        {/* قاب طلایی دور لوگو */}
        <div className="relative mx-auto h-28 w-28">
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
              {profile.logoUrl ? (
                <img src={profile.logoUrl} alt={profile.shopName ?? ""} className="h-full w-full object-cover" />
              ) : (
                <Store className="h-10 w-10" style={{ color: C.bronze }} />
              )}
            </div>
          </div>
        </div>

        <div className="relative mt-5">
          <div
            className="mx-auto mb-2 h-px w-16"
            style={{ background: `linear-gradient(90deg, transparent, ${C.bronze}, transparent)` }}
          />
          {profile.shopName && (
            <h1
              className="text-3xl leading-tight"
              style={{
                fontFamily: "'Cormorant Garamond', Vazirmatn, serif",
                fontWeight: 700,
                letterSpacing: "0.02em",
                color: C.cream,
              }}
            >
              {profile.shopName}
            </h1>
          )}
          <div
            className="mx-auto mt-2 h-px w-16"
            style={{ background: `linear-gradient(90deg, transparent, ${C.bronze}, transparent)` }}
          />
          {profile.description && (
            <p
              className="mx-auto mt-3 max-w-md text-[13px] leading-7"
              style={{ color: C.creamMute }}
            >
              {profile.description}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto -mt-6 max-w-md space-y-3 px-4">
        {profile.address && (
          <InfoCard icon={<MapPin className="h-4 w-4" />} title="آدرس">
            <p className="text-sm leading-7" style={{ color: C.cream }}>{profile.address}</p>
          </InfoCard>
        )}

        {profile.phones && profile.phones.length > 0 && (
          <InfoCard icon={<Phone className="h-4 w-4" />} title="تماس">
            <div className="flex flex-col gap-2">
              {profile.phones.map((ph, i) => (
                <button
                  key={i}
                  onClick={() => openExternal(`tel:${ph}`)}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition active:scale-[0.99]"
                  style={{ background: C.ink, border: `1px solid ${C.hair}`, color: C.cream }}
                >
                  <span dir="ltr" className="font-medium tracking-wide">{ph}</span>
                  <span className="text-[11px]" style={{ color: C.bronze }}>تماس ›</span>
                </button>
              ))}
            </div>
          </InfoCard>
        )}

        {profile.hours && (
          <InfoCard icon={<Clock className="h-4 w-4" />} title="ساعات کاری">
            <p className="text-sm leading-7" style={{ color: C.cream }}>{profile.hours}</p>
          </InfoCard>
        )}

        {hasSocial && (
          <InfoCard icon={<Send className="h-4 w-4" />} title="شبکه‌های اجتماعی">
            <div className="flex flex-wrap gap-2">
              {socials.instagram && (
                <SocialButton icon={<Instagram className="h-4 w-4" />} label="اینستاگرام"
                  onClick={() => openExternal(normalizeInstagram(socials.instagram!))} />
              )}
              {socials.telegram && (
                <SocialButton icon={<Send className="h-4 w-4" />} label="تلگرام"
                  onClick={() => openExternal(normalizeTelegram(socials.telegram!))} />
              )}
              {socials.whatsapp && (
                <SocialButton icon={<MessageCircle className="h-4 w-4" />} label="واتساپ"
                  onClick={() => openExternal(`https://wa.me/${toIntlPhone(socials.whatsapp!)}`)} />
              )}
              {socials.rubika && (
                <SocialButton icon={<MessageCircle className="h-4 w-4" />} label="روبیکا"
                  onClick={() => openExternal(normalizeRubika(socials.rubika!))} />
              )}
              {socials.eitaa && (
                <SocialButton icon={<Send className="h-4 w-4" />} label="ایتا"
                  onClick={() => openExternal(normalizeEitaa(socials.eitaa!))} />
              )}
              {socials.bale && (
                <SocialButton icon={<Send className="h-4 w-4" />} label="بله"
                  onClick={() => openExternal(normalizeBale(socials.bale!))} />
              )}
            </div>
          </InfoCard>
        )}

        {/* نمونه کار — فقط اگر تصویری ثبت شده باشد */}
        {portfolio.length > 0 && (
          <section
            className="rounded-2xl p-4"
            style={{
              background: `linear-gradient(180deg, ${C.ink2}, ${C.ink})`,
              border: `1px solid ${C.hair}`,
              boxShadow: "0 18px 40px -28px rgba(0,0,0,0.8)",
            }}
          >
            <div className="mb-3 flex items-center justify-center gap-3">
              <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, ${C.bronze}66)` }} />
              <h2
                className="text-[15px]"
                style={{
                  fontFamily: "'Cormorant Garamond', Vazirmatn, serif",
                  fontWeight: 700,
                  color: C.bronze,
                  letterSpacing: "0.18em",
                }}
              >
                نمونه کار
              </h2>
              <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${C.bronze}66, transparent)` }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {portfolio.map((url, i) => (
                <button
                  key={url + i}
                  onClick={() => setLightboxIdx(i)}
                  className="group relative aspect-square overflow-hidden rounded-xl"
                  style={{ border: `1px solid ${C.hair}` }}
                >
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.06]"
                  />
                  <span
                    className="pointer-events-none absolute inset-0"
                    style={{ boxShadow: `inset 0 0 0 1px ${C.bronze}22` }}
                  />
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer
        className="mt-10 text-center text-[11px]"
        style={{ color: C.creamMute, letterSpacing: "0.08em" }}
      >
        ساخته‌شده با کمالی حسابداری
      </footer>

      {/* لایت‌باکس */}
      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(5,2,3,0.95)" }}
          onClick={closeLb}
        >
          <button
            aria-label="بستن"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full"
            style={{ background: "rgba(255,255,255,0.08)", color: C.cream }}
            onClick={(e) => {
              e.stopPropagation();
              closeLb();
            }}
          >
            <XIcon className="h-5 w-5" />
          </button>
          {portfolio.length > 1 && (
            <>
              <button
                aria-label="قبلی"
                className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full sm:right-6"
                style={{ background: "rgba(255,255,255,0.08)", color: C.cream }}
                onClick={(e) => {
                  e.stopPropagation();
                  stepLb(-1);
                }}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
              <button
                aria-label="بعدی"
                className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full sm:left-6"
                style={{ background: "rgba(255,255,255,0.08)", color: C.cream }}
                onClick={(e) => {
                  e.stopPropagation();
                  stepLb(1);
                }}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            </>
          )}
          <img
            src={portfolio[lightboxIdx]}
            alt=""
            className="max-h-[88vh] max-w-[94vw] rounded-xl object-contain"
            style={{ boxShadow: `0 0 0 1px ${C.bronze}33, 0 30px 80px rgba(0,0,0,0.6)` }}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs"
            style={{ background: "rgba(255,255,255,0.08)", color: C.cream }}
          >
            {lightboxIdx + 1} / {portfolio.length}
          </div>
        </div>
      )}
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

function normalizeRubika(v: string): string {
  const t = v.trim();
  if (/^https?:\/\//i.test(t)) return t;
  const id = t.replace(/^@/, "").replace(/\s+/g, "");
  return `https://rubika.ir/${id}`;
}

function normalizeEitaa(v: string): string {
  const t = v.trim();
  if (/^https?:\/\//i.test(t)) return t;
  const id = t.replace(/^@/, "").replace(/\s+/g, "");
  return `https://eitaa.com/${id}`;
}

function normalizeBale(v: string): string {
  const t = v.trim();
  if (/^https?:\/\//i.test(t)) return t;
  const id = t.replace(/^@/, "").replace(/\s+/g, "");
  return `https://ble.ir/${id}`;
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
    <section
      className="rounded-2xl p-4"
      style={{
        background: `linear-gradient(180deg, ${C.ink2}, ${C.ink})`,
        border: `1px solid ${C.hair}`,
        boxShadow: "0 14px 30px -22px rgba(0,0,0,0.8)",
      }}
    >
      <h2
        className="mb-3 flex items-center gap-2 text-[12px]"
        style={{ color: C.bronze, letterSpacing: "0.16em", fontWeight: 700 }}
      >
        <span className="grid h-7 w-7 place-items-center rounded-full"
          style={{ background: `${C.wine}33`, border: `1px solid ${C.hair}`, color: C.bronze }}>
          {icon}
        </span>
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
      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition active:scale-[0.98]"
      style={{
        background: C.ink,
        border: `1px solid ${C.hair}`,
        color: C.cream,
      }}
    >
      <span style={{ color: C.bronze }}>{icon}</span>
      {label}
    </button>
  );
}
