import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** sm = آیکون داخل دکمه/لینک — lg = دکمه‌ی بزرگ صفحه ثبت صوتی */
  size?: "sm" | "lg";
  /** حالت ضبط فعال — پالس قرمز */
  active?: boolean;
  className?: string;
  iconClassName?: string;
};

/**
 * آیکون میکروفون با انیمیشن موج صوتی — کاربر را به «ضربه برای صحبت» راهنمایی می‌کند.
 */
export function VoiceMicIcon({
  size = "sm",
  active = false,
  className,
  iconClassName,
}: Props) {
  if (size === "lg") {
    return (
      <div className={cn("voice-mic-lg relative grid place-items-center", className)}>
        {!active && (
          <>
            <span className="voice-mic-ring voice-mic-ring-1" aria-hidden />
            <span className="voice-mic-ring voice-mic-ring-2" aria-hidden />
            <span className="voice-mic-ring voice-mic-ring-3" aria-hidden />
          </>
        )}
        {!active && (
          <div className="voice-mic-waves absolute -bottom-1 flex items-end gap-0.5" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="voice-mic-wave-bar" style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
        )}
        <div
          className={cn(
            "relative z-10 grid place-items-center rounded-full shadow-elegant transition-colors",
            active ? "h-24 w-24 bg-destructive animate-pulse" : "h-24 w-24 bg-gradient-primary voice-mic-core",
          )}
        >
          {active ? (
            <MicOff className={cn("h-10 w-10 text-primary-foreground", iconClassName)} />
          ) : (
            <Mic className={cn("h-10 w-10 text-primary-foreground", iconClassName)} />
          )}
        </div>
      </div>
    );
  }

  return (
    <span className={cn("voice-mic-sm relative inline-flex shrink-0", className)} aria-hidden>
      {!active && <span className="voice-mic-sm-ping" />}
      <Mic className={cn("relative z-10 h-4 w-4 voice-mic-sm-icon", iconClassName)} />
    </span>
  );
}
