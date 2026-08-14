import { useNavigate } from "@tanstack/react-router";
import { PlayCircle, Sparkles, GraduationCap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveOnboardingChoice } from "@/lib/onboarding";

type Props = {
  open: boolean;
  userId: string;
  onClose: () => void;
};

/** پنجره خوش‌آمدگویی — پیشنهاد ویدیوی آموزشی برای اولین ورود به حساب خریداری‌شده */
export function WelcomeTutorialDialog({ open, userId, onClose }: Props) {
  const navigate = useNavigate();

  const goToTutorial = () => {
    saveOnboardingChoice(userId, "visited");
    onClose();
    navigate({ to: "/tutorial" });
  };

  const dismissForever = () => {
    saveOnboardingChoice(userId, "dismissed");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={() => { /* فقط با دو دکمه بسته می‌شود */ }}>
      <DialogContent
        className="max-w-md rounded-2xl border-primary/20 p-0 overflow-hidden [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-background px-6 pt-6 pb-2">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary shadow-card">
            <GraduationCap className="h-7 w-7" />
          </div>
          <DialogHeader className="text-center sm:text-center">
            <DialogTitle className="text-xl font-extrabold">به KAMIX خوش آمدید!</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-7 text-muted-foreground">
              حساب شما فعال شد. برای شروع سریع‌تر، ویدیوی آموزش کامل برنامه را ببینید —
              از صدور فاکتور و اسکن بارکد تا ثبت صوتی، همه‌چیز را در چند دقیقه یاد
              بگیرید.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex items-start gap-2 px-6 py-3 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>می‌توانید هر زمان از دکمه «برگشت به حساب من» به فاکتور برگردید.</span>
        </div>

        <DialogFooter className="flex-col gap-2 px-6 pb-6 sm:flex-col sm:space-x-0">
          <button
            type="button"
            onClick={goToTutorial}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground shadow-elegant transition hover:opacity-90"
          >
            <PlayCircle className="h-5 w-5" />
            برویم به ویدیوی آموزشی
          </button>
          <button
            type="button"
            onClick={dismissForever}
            className="w-full rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            نه، نیاز نیست
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
