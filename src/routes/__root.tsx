import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/AuthContext";
import { disableServiceWorker } from "@/registerSW";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

const BASE_URL = "https://secure-signup-pal.lovable.app";
const OG_IMAGE = "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d24b17c4-cf4d-4480-9c72-21d92987eeac/id-preview-cd8c23ad--6fd5b18e-fd9e-4418-ba82-813c8f9cfe32.lovable.app-1780049993579.png";

const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "KAMIX (کامیکس) — حسابداری فروشگاهی",
  url: BASE_URL,
  logo: `${BASE_URL}/icon-512.png`,
  sameAs: [],
  description: "سیستم حسابداری و صدور فاکتور فارسی با اسکن بارکد و QR روی موبایل.",
};

const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "KAMIX (کامیکس) — حسابداری فروشگاهی",
  url: BASE_URL,
  potentialAction: {
    "@type": "SearchAction",
    target: `${BASE_URL}/?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#3b82f6" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "KAMIX" },
      { title: "KAMIX (کامیکس) — حسابداری فروشگاهی، فاکتور و انبار موبایل" },
      { name: "description", content: "KAMIX (کامیکس) — سیستم حسابداری ساده فارسی برای فروشگاه، انبار و صدور فاکتور با اسکن بارکد و QR توسط دوربین موبایل. ثبت‌نام، دانلود APK و شروع رایگان." },
      { name: "keywords", content: "کامیکس, حسابداری کامیکس, حسابداری فروشگاهی, فاکتور موبایل, صدور فاکتور, انبار موبایل, اسکن بارکد, QR, حسابداری اندروید" },
      { name: "author", content: "Kamali" },
      { name: "robots", content: "index, follow" },
      { property: "og:site_name", content: "KAMIX (کامیکس)" },
      { property: "og:title", content: "KAMIX (کامیکس) — حسابداری فروشگاهی، فاکتور و انبار موبایل" },
      { property: "og:description", content: "KAMIX (کامیکس) — سیستم حسابداری ساده فارسی برای فروشگاه، انبار و صدور فاکتور با اسکن بارکد و QR توسط دوربین موبایل." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: BASE_URL },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:alt", content: "KAMIX — اپلیکیشن حسابداری موبایل" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "KAMIX (کامیکس) — حسابداری فروشگاهی، فاکتور و انبار موبایل" },
      { name: "twitter:description", content: "KAMIX (کامیکس) — سیستم حسابداری ساده فارسی برای فروشگاه، انبار و صدور فاکتور با اسکن بارکد و QR توسط دوربین موبایل." },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // نسخه PWA حذف شده — نصب از طریق APK اندروید انجام می‌شود
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
    scripts: [
      { type: "application/ld+json", children: JSON.stringify(organizationLd) },
      { type: "application/ld+json", children: JSON.stringify(websiteLd) },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  if (typeof window !== "undefined") {
    // PWA حذف شده: سرویس‌ورکرهای قبلی پاک می‌شوند تا کش قدیمی مزاحم نشود
    disableServiceWorker();
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </AuthProvider>
    </QueryClientProvider>
  );
}
