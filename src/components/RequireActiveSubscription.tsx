import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarX, RefreshCw } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useSubscriptionAccess } from "@/components/SubscriptionAccess";

type Props = {
  children: ReactNode;
  feature: string;
};

/**
 * صفحات کار جدید (اسکن، صدا، ثبت سریع، …): اگر اشتراک تمام شده باشد
 * دوربین/میکروفون اصلاً روشن نمی‌شود و پنجرهٔ تمدید باز می‌گردد.
 */
export function RequireActiveSubscription({ children, feature }: Props) {
  const { readOnly, openRenew } = useSubscriptionAccess();

  useEffect(() => {
    if (readOnly) openRenew();
  }, [readOnly, openRenew]);

  if (!readOnly) return <>{children}</>;

  return (
    <Layout>
      <div className="mx-auto max-w-sm rounded-3xl border border-red-500/25 bg-card p-5 text-center shadow-sm">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-red-500/10 text-red-600">
          <CalendarX className="h-6 w-6" />
        </div>
        <h1 className="text-base font-bold">برای «{feature}» باید تمدید کنید</h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          این قابلیت کار جدید می‌سازد. فاکتورها و مشتریان قبلی را از همان بخش‌ها ببینید، چاپ کنید یا
          اکسل بگیرید.
        </p>
        <Link
          to="/renew"
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <RefreshCw className="h-4 w-4" />
          تمدید اشتراک
        </Link>
        <Link
          to="/invoices"
          className="mt-2 block text-sm text-muted-foreground hover:text-foreground"
        >
          مشاهده فاکتورهای قبلی
        </Link>
      </div>
    </Layout>
  );
}
