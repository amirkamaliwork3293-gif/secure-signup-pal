/**
 * نوار «استوری» بالای صفحه‌ی معرفی — به‌سبک اینستاگرام.
 * دایره‌های افقی با عکس و کپشن؛ کلیک روی هرکدام یک لایتباکس تمام‌صفحه باز می‌کند.
 * اگر استوری‌ای ثبت نشده باشد، هیچ‌چیز نمایش داده نمی‌شود.
 */
import { useEffect, useState } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";
import type { LandingStory } from "@/lib/landing";

export function StoriesBar({ stories }: { stories: LandingStory[] }) {
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
      if (e.key === "ArrowLeft") setActive((i) => (i === null ? null : Math.min(stories.length - 1, i + 1)));
      if (e.key === "ArrowRight") setActive((i) => (i === null ? null : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stories.length]);

  if (!stories || stories.length === 0) return null;

  const current = active !== null ? stories[active] : null;

  return (
    <>
      <section className="mx-auto max-w-5xl px-3 py-4">
        <div
          dir="rtl"
          className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin] [-ms-overflow-style:none]"
        >
          {stories.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className="group flex w-20 shrink-0 flex-col items-center gap-1.5 text-center focus:outline-none"
              aria-label={s.caption || `استوری ${i + 1}`}
            >
              <span className="relative block rounded-full bg-gradient-to-tr from-primary via-primary-glow to-primary p-[2.5px] shadow-elegant transition group-hover:scale-105">
                <span className="block rounded-full bg-background p-[2px]">
                  <img
                    src={s.image_url}
                    alt={s.caption || "استوری KAMIX"}
                    loading="lazy"
                    className="h-16 w-16 rounded-full object-cover"
                  />
                </span>
              </span>
              <span className="line-clamp-1 text-[11px] font-semibold text-foreground/80">
                {s.caption || `استوری ${i + 1}`}
              </span>
            </button>
          ))}
        </div>
      </section>

      {current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setActive(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={(e) => { e.stopPropagation(); setActive(null); }}
            aria-label="بستن"
          >
            <X className="h-5 w-5" />
          </button>

          {active! > 0 && (
            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); setActive((i) => (i === null ? null : Math.max(0, i - 1))); }}
              aria-label="قبلی"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
          {active! < stories.length - 1 && (
            <button
              type="button"
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); setActive((i) => (i === null ? null : Math.min(stories.length - 1, i + 1))); }}
              aria-label="بعدی"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          <figure
            className="relative flex max-h-[90vh] max-w-md flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={current.image_url}
              alt={current.caption || "استوری KAMIX"}
              className="max-h-[80vh] w-auto rounded-2xl object-contain shadow-2xl"
            />
            {current.caption && (
              <figcaption className="mt-3 rounded-xl bg-black/60 px-4 py-2 text-center text-sm font-semibold text-white">
                {current.caption}
              </figcaption>
            )}
          </figure>
        </div>
      )}
    </>
  );
}