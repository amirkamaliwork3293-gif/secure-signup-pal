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
      { title: "KAMIX (کامیکس) — فاکتور با صدا، انبار و حسابداری فروشگاهی روی موبایل" },
      { name: "description", content: "دفتر حساب کاغذی را بگذار کنار. با KAMIX فاکتور را با صدا بگو، بارکد را با دوربین موبایل بزن، انبار و بدهکاران را از روی گوشی جلو ببر. ثبت‌نام و دانلود اپ اندروید." },
      { name: "keywords", content: "کامیکس, حسابداری کامیکس, فاکتور با صدا, حسابداری فروشگاهی, فاکتور موبایل, صدور فاکتور, انبار موبایل, اسکن بارکد, QR, حسابداری اندروید" },
      { name: "enamad", content: "7209426" },
      { property: "og:url", content: HOME_URL },
      { property: "og:title", content: "KAMIX (کامیکس) — فاکتور با صدا، انبار و حسابداری فروشگاهی روی موبایل" },
      { property: "og:description", content: "دفتر حساب کاغذی را بگذار کنار. با KAMIX فاکتور را با صدا بگو، بارکد را با دوربین موبایل بزن و انبار را از روی گوشی جلو ببر." },
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
