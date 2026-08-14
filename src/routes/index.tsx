import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const HOME_URL = "https://kamixapp.ir/";

const InvoiceWorkspace = lazy(() =>
  import("@/components/InvoiceWorkspace").then((m) => ({ default: m.InvoiceWorkspace })),
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "KAMIX (کامیکس) — حسابداری فروشگاهی، فاکتور و انبار موبایل" },
      { name: "description", content: "KAMIX (کامیکس) — سیستم حسابداری ساده فارسی برای فروشگاه، انبار و صدور فاکتور با اسکن بارکد و QR توسط دوربین موبایل. ثبت‌نام، دانلود APK و شروع رایگان." },
      { name: "keywords", content: "کامیکس, حسابداری کامیکس, حسابداری فروشگاهی, فاکتور موبایل, صدور فاکتور, انبار موبایل, اسکن بارکد, QR, حسابداری اندروید" },
      { property: "og:url", content: HOME_URL },
      { property: "og:title", content: "KAMIX (کامیکس) — حسابداری فروشگاهی، فاکتور و انبار موبایل" },
      { property: "og:description", content: "KAMIX (کامیکس) — سیستم حسابداری ساده فارسی برای فروشگاه، انبار و صدور فاکتور با اسکن بارکد و QR توسط دوربین موبایل." },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "canonical", href: HOME_URL },
    ],
  }),
  // HTML لندینگ برای همه یکسان است (نشست در localStorage است، نه SSR).
  // CDN تا ۵ دقیقه سرو می‌کند؛ تغییر ادمین از سوپابیس سمت کلاینت می‌آید.
  headers: () => ({
    "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    Vary: "Accept, Accept-Encoding",
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        }
      >
        <InvoiceWorkspace />
      </Suspense>
    </AuthGuard>
  );
}
