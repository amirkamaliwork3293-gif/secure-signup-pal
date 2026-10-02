import { Users, UserPlus } from "lucide-react";
import { customerBalance, customerFullName, formatToman, type Customer } from "@/lib/store";

/**
 * وقتی نام/تلفن تایپ‌شده با چند مشتری ذخیره‌شده می‌خواند، برنامه حدس نمی‌زند:
 * کاربر انتخاب می‌کند فاکتور (و بدهی آن) مال کدام پرونده است، یا پروندهٔ جدید.
 */
export function CustomerChoiceDialog({
  candidates,
  typedName,
  onPick,
  onCancel,
  allowNew = true,
}: {
  candidates: Customer[];
  typedName?: string;
  onPick: (c: Customer | "new") => void;
  onCancel: () => void;
  allowNew?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-choice-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-t-3xl border border-border bg-card p-4 shadow-xl sm:rounded-2xl"
      >
        <div id="customer-choice-title" className="flex items-center gap-2 text-sm font-bold">
          <Users className="h-4 w-4 text-primary" />
          کدام مشتری؟
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          {typedName ? `«${typedName}» ` : ""}با {candidates.length.toLocaleString("fa-IR")} مشتری
          ذخیره‌شده می‌خواند. برای این‌که فاکتور و حساب اشتباهی ثبت نشود، پروندهٔ درست را انتخاب
          کنید.
        </p>
        <ul className="max-h-64 space-y-1.5 overflow-y-auto">
          {candidates.map((c) => {
            const b = customerBalance(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onPick(c)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-right hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {customerFullName(c)}
                    </span>
                    <span className="block text-[11px] text-muted-foreground" dir="ltr">
                      {c.phone || "بدون تلفن"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-[11px] ${b > 0 ? "text-destructive" : b < 0 ? "text-sky-600" : "text-muted-foreground"}`}
                  >
                    {b > 0
                      ? `بدهکار ${formatToman(b)}`
                      : b < 0
                        ? `طلبکار ${formatToman(-b)}`
                        : "تسویه"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {allowNew && (
          <button
            type="button"
            onClick={() => onPick("new")}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/50 py-2.5 text-sm font-medium text-primary"
          >
            <UserPlus className="h-4 w-4" /> مشتری جدید (شخص دیگری است)
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="w-full rounded-xl border border-border py-2.5 text-sm"
        >
          انصراف
        </button>
      </div>
    </div>
  );
}
