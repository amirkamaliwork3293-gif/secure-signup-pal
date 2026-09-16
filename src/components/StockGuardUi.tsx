import { type StockAddResult } from "@/lib/store";

/** بنر هشدار/اتمام موجودی روی فاکتور، اسکن و جستجو */
export function StockNoticeBanner({
  notice,
  onClose,
}: {
  notice: StockAddResult | null;
  onClose: () => void;
}) {
  if (!notice?.message) return null;
  const danger =
    !notice.ok || notice.kind === "out" || notice.kind === "last" || notice.kind === "insufficient";
  return (
    <div
      className={`mb-2 flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-xs leading-5 ${
        danger
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
      }`}
      role="status"
    >
      <span>{notice.message}</span>
      <button type="button" onClick={onClose} className="shrink-0 underline underline-offset-2">
        بستن
      </button>
    </div>
  );
}
