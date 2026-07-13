import type { ReactNode } from "react";
import { useAuth } from "@/lib/AuthContext";
import { LoginPage } from "@/routes/login";
import { LandingPage } from "@/components/LandingPage";
import { isWebView } from "@/lib/isWebView";
import { ShieldOff, Lock, Clock, CalendarX } from "lucide-react";
import { Link } from "@tanstack/react-router";

type Props = {
  children: ReactNode;
  adminOnly?: boolean;
};

export function AuthGuard({ children, adminOnly = false }: Props) {
  const { state, signOut, refreshProfile } = useAuth();

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">در حال بررسی هویت...</p>
        </div>
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    // داخل اپلیکیشن (وب‌ویو) یا مسیر ادمین → مستقیم صفحه‌ی ورود.
    // در مرورگر وب → ابتدا صفحه‌ی معرفی نمایش داده می‌شود.
    return isWebView() || adminOnly ? <LoginPage /> : <LandingPage />;
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
            <br />به‌محض تایید مدیر، با زدن «بررسی مجدد» وارد می‌شوید.
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

  if (state.status === "expired") {
    return (
      <CenterMessage
        icon={<CalendarX className="h-8 w-8 text-destructive" />}
        iconBg="bg-destructive/10"
        title="اشتراک شما منقضی شده است"
        desc={
          <>
            مدت اشتراک <strong>{state.username}</strong> به پایان رسیده.
            <br />برای تمدید، درخواست جدیدی ثبت کنید.
          </>
        }
        action={
          <div className="flex gap-2">
            <Link
              to="/renew"
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              تمدید اشتراک
            </Link>
            <SignOutBtn onClick={signOut} />
          </div>
        }
      />
    );
  }

  if (adminOnly && !state.isAdmin) {
    return (
      <CenterMessage
        icon={<Lock className="h-8 w-8 text-amber-500" />}
        iconBg="bg-amber-500/10"
        title="دسترسی ممنوع"
        desc={<>این بخش فقط برای مدیر سیستم است.</>}
        action={
          <button
            onClick={() => window.history.back()}
            className="rounded-xl border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent"
          >
            بازگشت
          </button>
        }
      />
    );
  }

  return <>{children}</>;
}

function CenterMessage({
  icon, iconBg, title, desc, action,
}: { icon: ReactNode; iconBg: string; title: string; desc: ReactNode; action: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className={`grid h-16 w-16 place-items-center rounded-2xl ${iconBg}`}>{icon}</div>
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </div>
      {action}
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
