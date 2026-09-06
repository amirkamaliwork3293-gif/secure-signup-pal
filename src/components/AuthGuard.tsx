import { lazy, Suspense, type ReactNode } from "react";
import { useAuth } from "@/lib/AuthContext";
import { LandingPage } from "@/components/LandingPage";
import { isWebView } from "@/lib/isWebView";
import { ApkDownloadButton } from "@/components/ApkDownloadButton";
import { SubscriptionAccessProvider } from "@/components/SubscriptionAccess";
import { ShieldOff, Clock } from "lucide-react";
import { shouldShowAdminLogin } from "@/lib/account-isolation";

const LoginPage = lazy(() => import("@/routes/login").then((m) => ({ default: m.LoginPage })));

function LoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

type Props = {
  children: ReactNode;
  adminOnly?: boolean;
};

export function AuthGuard({ children, adminOnly = false }: Props) {
  const { state, signOut, refreshProfile } = useAuth();

  if (state.status === "loading") {
    // مسیر ادمین یا داخل اپ (وب‌ویو) → همچنان اسپینر (این حالت‌ها اهمیتی برای
    // سئو ندارند و کاربر واقعی معمولاً خیلی سریع رد می‌شود).
    // در مرورگر وب برای بازدیدکننده‌ی معمولی/گوگل‌بات → همان صفحه‌ی معرفی
    // (Landing) بلافاصله نمایش داده می‌شود تا محتوای کامل صفحه از همان
    // ابتدا (حتی در HTML سمت سرور، پیش از اجرای جاوااسکریپت) در دسترس باشد.
    // اگر کاربر واقعاً لاگین بوده باشد، به‌محض تایید نشست، همین کامپوننت با
    // محتوای اصلی اپلیکیشن جایگزین می‌شود.
    if (adminOnly || isWebView()) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">در حال بررسی هویت...</p>
          </div>
        </div>
      );
    }
    return <LandingPage />;
  }

  if (
    shouldShowAdminLogin({
      adminOnly,
      status: state.status,
      isAdmin: state.status === "authenticated" && state.isAdmin,
    })
  ) {
    return (
      <Suspense fallback={<LoginFallback />}>
        <LoginPage adminMode />
      </Suspense>
    );
  }

  if (state.status === "unauthenticated") {
    // داخل اپلیکیشن (وب‌ویو) یا مسیر ادمین → مستقیم صفحه‌ی ورود.
    // در مرورگر وب → ابتدا صفحه‌ی معرفی نمایش داده می‌شود.
    return isWebView() ? (
      <Suspense fallback={<LoginFallback />}>
        <LoginPage adminMode={adminOnly} />
      </Suspense>
    ) : (
      <LandingPage />
    );
  }

  if (state.status === "pending") {
    return (
      <CenterMessage
        icon={<Clock className="h-8 w-8 text-amber-500" />}
        iconBg="bg-amber-500/10"
        title="حساب شما در انتظار تایید مدیر است"
        desc={
          <>
            کاربر <strong>{state.username}</strong> ثبت شده است.
            <br />
            به‌محض تایید مدیر، با زدن «بررسی مجدد» وارد می‌شوید.
          </>
        }
        action={
          <div className="flex gap-2">
            <button
              onClick={() => void refreshProfile()}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              بررسی مجدد
            </button>
            <SignOutBtn onClick={signOut} />
          </div>
        }
        extra={!isWebView() ? <PendingApkDownload /> : null}
      />
    );
  }

  if (state.status === "rejected") {
    return (
      <CenterMessage
        icon={<ShieldOff className="h-8 w-8 text-destructive" />}
        iconBg="bg-destructive/10"
        title="درخواست شما رد شده است"
        desc={<>برای اطلاعات بیشتر با مدیر تماس بگیرید.</>}
        action={<SignOutBtn onClick={signOut} />}
      />
    );
  }

  return <SubscriptionAccessProvider>{children}</SubscriptionAccessProvider>;
}

function CenterMessage({
  icon,
  iconBg,
  title,
  desc,
  action,
  extra,
}: {
  icon: ReactNode;
  iconBg: string;
  title: string;
  desc: ReactNode;
  action: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-10 text-center">
      <div className={`grid h-16 w-16 place-items-center rounded-2xl ${iconBg}`}>{icon}</div>
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </div>
      {action}
      {extra}
    </div>
  );
}

function PendingApkDownload() {
  return (
    <div className="w-full max-w-sm text-right">
      <p className="mb-1 text-sm font-bold text-foreground">تا تایید مدیر، اپلیکیشن را نصب کنید</p>
      <p className="mb-3 text-[11px] leading-6 text-muted-foreground">
        خیلی از کاربران لینک دانلود را نمی‌بینند؛ از همین‌جا فایل اندروید را بگیرید و طبق تصویر
        راهنما نصب کنید. بعد از تایید، با همان یوزرنیم وارد اپ شوید.
      </p>
      <ApkDownloadButton className="w-full" />
    </div>
  );
}

function SignOutBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent"
    >
      خروج از حساب
    </button>
  );
}
