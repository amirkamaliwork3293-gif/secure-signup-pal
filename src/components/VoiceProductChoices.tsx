import { useState, type ReactNode } from "react";
import { formatNumber, formatToman, type Product } from "@/lib/store";
import { VOICE_PRODUCT_CHOICE_LIMIT, type ParsedCandidate } from "@/lib/voice/persian-nlu";

/**
 * گزینه‌های کالای مشابه در ثبت صوتی / دستیار.
 * حداکثر ۵ نام دیده می‌شود؛ بقیه پشت «محصولات بیشتر» می‌مانند تا فهرست شلوغ نشود
 * و اسم کامل گفته‌شده همیشه خانه‌ی اول بماند.
 */
export function VoiceProductChoices({
  candidates,
  onPick,
  trailing,
}: {
  candidates: ParsedCandidate[];
  onPick: (product: Product) => void;
  trailing?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(0, candidates.length - VOICE_PRODUCT_CHOICE_LIMIT);
  const visible = expanded ? candidates : candidates.slice(0, VOICE_PRODUCT_CHOICE_LIMIT);

  return (
    <div
      className={
        expanded && hiddenCount > 0
          ? "w-full max-h-52 overflow-y-auto overscroll-contain"
          : "w-full"
      }
    >
      <div className="flex flex-wrap gap-2">
        {visible.map((c, i) => (
          <button
            key={c.product.id}
            type="button"
            onClick={() => onPick(c.product)}
            className={`rounded-xl border bg-background px-3 py-2 text-sm hover:bg-accent ${
              i === 0 && candidates.length > 1
                ? "border-primary font-medium shadow-sm"
                : "border-border"
            }`}
          >
            {c.product.name}
            <span className="mr-1 text-xs font-normal text-muted-foreground">
              {formatToman(c.product.price)}
            </span>
          </button>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-xl border border-dashed border-primary/50 px-3 py-2 text-sm text-primary hover:bg-primary/5"
          >
            {expanded ? "نمایش کمتر" : `محصولات بیشتر (${formatNumber(hiddenCount)})`}
          </button>
        )}
        {trailing}
      </div>
    </div>
  );
}
