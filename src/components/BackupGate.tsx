import { useState } from "react";
import { DatabaseBackup, Loader2, ShieldCheck } from "lucide-react";
import { saveFullBackup } from "@/lib/full-backup";

/** مرحلهٔ «پشتیبان اول» — تا پشتیبان در همین نشست ذخیره نشود، دکمهٔ اصلاح فعال نیست */
export function BackupGate({ done, onDone }: { done: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div
      className={`rounded-2xl border p-3 ${done ? "border-success/40 bg-success/5" : "border-primary/30 bg-primary/5"}`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        {done ? (
          <ShieldCheck className="h-4 w-4 text-success" />
        ) : (
          <DatabaseBackup className="h-4 w-4 text-primary" />
        )}
        {done ? "پشتیبان ذخیره شد" : "قدم اول: پشتیبان کامل بگیرید"}
      </div>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
        پیش از هر اصلاح، یک فایل کامل از همهٔ اطلاعات روی دستگاه شما ذخیره می‌شود تا در هر حالتی
        قابل بازگشت باشد. سرور هم نسخه‌های خودکار نگه می‌دارد.
      </p>
      {!done && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setErr(null);
            setBusy(true);
            try {
              const ok = await saveFullBackup("before-data-fix");
              if (ok) onDone();
              else
                setErr(
                  "ذخیرهٔ فایل ممکن نشد. از صفحهٔ «پشتیبان‌گیری» فایل کامل بگیرید و دوباره تلاش کنید.",
                );
            } finally {
              setBusy(false);
            }
          }}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <DatabaseBackup className="h-4 w-4" />
          )}
          ذخیرهٔ پشتیبان کامل
        </button>
      )}
      {err && <p className="mt-2 text-[11px] text-destructive">{err}</p>}
    </div>
  );
}
