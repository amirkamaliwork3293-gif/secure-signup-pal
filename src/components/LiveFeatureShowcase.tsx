/**
 * نمایشگر زنده‌ی قابلیت‌ها — بازسازی بصری مستقل برای صفحه‌ی معرفی.
 * هیچ لینک/کد واقعی از صفحات اپ و هیچ تماس شبکه‌ای ندارد.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Bell,
  Check,
  Coins,
  DatabaseBackup,
  LayoutGrid,
  Mic,
  QrCode,
  ScanLine,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

type TabId = "scan" | "voice" | "assistant" | "hub";

type TabDef = {
  id: TabId;
  title: string;
  hint: string;
  icon: LucideIcon;
  sr: string;
};

const TABS: TabDef[] = [
  {
    id: "scan",
    title: "اسکن با دوربین",
    hint: "بارکد رو نشون بده، قیمت خودش میاد",
    icon: ScanLine,
    sr: "نمایش اسکن بارکد: خط اسکنر روی بارکد حرکت می‌کند و کارت محصول با قیمت ظاهر می‌شود.",
  },
  {
    id: "voice",
    title: "فاکتور با صدا",
    hint: "بگو چی فروختی، خودش می‌نویسه",
    icon: Mic,
    sr: "نمایش ثبت فاکتور با صدا: جمله گفته می‌شود و ردیف فاکتور به لیست اضافه می‌گردد.",
  },
  {
    id: "assistant",
    title: "دستیار هوشمند",
    hint: "بدهی، هزینه، قیمت، یادآوری، همه با یک جمله",
    icon: Sparkles,
    sr: "نمایش دستیار هوشمند: دستور نمونه تایپ می‌شود و کارت تأیید سبز ظاهر می‌گردد.",
  },
  {
    id: "hub",
    title: "همه‌چیز در یک اپ",
    hint: "سود، مشتری، طلا، منو، یادآوری، پشتیبان‌گیری",
    icon: LayoutGrid,
    sr: "نمایش پیشخوان: کارت‌های سود امروز، بدهکاران، نرخ طلا و یادآوری‌های امروز.",
  },
];

const AUTOPLAY_MS = 9500;
const USER_HOLD_MS = 18000;

const SCAN_BARS = [7, 16, 9, 18, 8, 15, 11, 7, 18, 10, 16, 8, 17, 9, 14, 18, 8, 12, 16, 7, 15, 11, 18, 8, 13, 9, 16, 7, 12, 18];

const VOICE_LINES = [
  { spoken: "۲ عدد پیراهن ۲۵۰ هزار تومان", name: "پیراهن مردانه", qty: "۲", amount: "۲۵۰٬۰۰۰" },
  { spoken: "یک شلوار جین ۴۲۰ هزار", name: "شلوار جین", qty: "۱", amount: "۴۲۰٬۰۰۰" },
  { spoken: "۳ تا جوراب ۶۰ هزار", name: "جوراب نخی", qty: "۳", amount: "۶۰٬۰۰۰" },
] as const;

const ASSIST_TURNS = [
  {
    command: "آقای رضایی ۲۰۰ هزار تومان بدهکاره",
    reply: "ثبت شد: ۲۰۰٬۰۰۰ تومان بدهی برای آقای رضایی",
  },
  {
    command: "ماهانه ۴۵ میلیون هزینه اجاره",
    reply: "ثبت شد: هزینه اجاره ۴۵٬۰۰۰٬۰۰۰ تومان",
  },
  {
    command: "پرسودترین کالام چیه؟",
    reply: "پیراهن مردانه — سود امروز ۴۲۰ هزار تومان",
  },
] as const;

const HUB_TARGETS = { profit: 1_850_000, debtors: 12, gold: 4_280_000, reminders: 3 };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return visible;
}

function createCancellableWait() {
  let cancelled = false;
  let tid = 0;
  let resolveWait: (() => void) | null = null;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      if (cancelled) {
        resolve();
        return;
      }
      resolveWait = resolve;
      tid = window.setTimeout(() => {
        resolveWait = null;
        resolve();
      }, ms);
    });

  const cancel = () => {
    cancelled = true;
    window.clearTimeout(tid);
    resolveWait?.();
    resolveWait = null;
  };

  const isCancelled = () => cancelled;
  return { wait, cancel, isCancelled };
}

function faNum(n: number): string {
  return Math.round(n).toLocaleString("fa-IR");
}

function ScreenChrome({ title }: { title: string }) {
  return (
    <div className="lfs-chrome">
      <div className="lfs-status" dir="ltr">
        <span className="lfs-time">9:41</span>
        <span className="lfs-island" aria-hidden="true" />
        <span className="lfs-sig">
          <i />
          <i />
          <i />
          <svg viewBox="0 0 24 12" width="20" height="10" aria-hidden="true">
            <rect x="0.5" y="1" width="18" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <rect x="2" y="2.6" width="13" height="6.8" rx="1" fill="currentColor" />
            <rect x="19.2" y="4" width="2.2" height="4" rx="0.6" fill="currentColor" />
          </svg>
        </span>
      </div>
      <div className="lfs-appbar">
        <span>{title}</span>
        <span className="lfs-brand">KAMIX</span>
      </div>
    </div>
  );
}

function ScanScene({ live, reduced }: { live: boolean; reduced: boolean }) {
  const [hit, setHit] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setHit(true);
      return;
    }
    if (!live) return;
    const { wait, cancel, isCancelled } = createCancellableWait();
    const run = async () => {
      while (!isCancelled()) {
        setHit(false);
        await wait(2600);
        if (isCancelled()) return;
        setHit(true);
        await wait(2200);
      }
    };
    void run();
    return cancel;
  }, [live, reduced]);

  return (
    <div className={`lfs-scan ${hit ? "is-hit" : ""}`}>
      <ScreenChrome title="اسکن محصول" />
      <div className="lfs-cam">
        <div className="lfs-cam-shelf" aria-hidden="true" />
        <div className="lfs-finder" dir="ltr">
          <span className="lfs-corner lfs-tl" />
          <span className="lfs-corner lfs-tr" />
          <span className="lfs-corner lfs-bl" />
          <span className="lfs-corner lfs-br" />
          <div className="lfs-fake-barcode" aria-hidden="true">
            {SCAN_BARS.map((h, i) => (
              <i key={i} style={{ height: `${h}px` }} />
            ))}
          </div>
          {!reduced && !hit && <span className="lfs-laser" />}
        </div>
        {hit && (
          <div className="lfs-scan-card">
            <span className="lfs-check">
              <Check strokeWidth={3} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-extrabold">پیراهن مردانه</div>
              <div className="lfs-mono mt-0.5 text-[11px] opacity-70">۲۵۰٬۰۰۰ تومان</div>
            </div>
            <span className="text-[10px] font-bold text-emerald-300">افزوده شد</span>
          </div>
        )}
      </div>
    </div>
  );
}

function VoiceScene({ live, reduced }: { live: boolean; reduced: boolean }) {
  const [typed, setTyped] = useState(reduced ? VOICE_LINES[2].spoken : "");
  const [rows, setRows] = useState(reduced ? VOICE_LINES.length : 0);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (reduced) {
      setTyped(VOICE_LINES[2].spoken);
      setRows(VOICE_LINES.length);
      setListening(false);
      return;
    }
    if (!live) return;
    const { wait, cancel, isCancelled } = createCancellableWait();
    const run = async () => {
      while (!isCancelled()) {
        setTyped("");
        setRows(0);
        setListening(false);
        await wait(350);
        for (let i = 0; i < VOICE_LINES.length; i++) {
          if (isCancelled()) return;
          const text = VOICE_LINES[i].spoken;
          setListening(true);
          setTyped("");
          for (let c = 0; c < text.length; c++) {
            if (isCancelled()) return;
            setTyped(text.slice(0, c + 1));
            await wait(36);
          }
          setListening(false);
          await wait(240);
          if (isCancelled()) return;
          setRows(i + 1);
          await wait(700);
        }
        await wait(1600);
      }
    };
    void run();
    return cancel;
  }, [live, reduced]);

  const visible = VOICE_LINES.slice(0, rows);

  return (
    <div className="lfs-voice">
      <ScreenChrome title="ثبت با صدا" />
      <div className="lfs-voice-body">
        <div className={`lfs-mic-wrap ${listening ? "is-on" : ""}`}>
          <span className="lfs-mic-ring" aria-hidden="true" />
          <span className="lfs-mic-ring lfs-mic-ring-2" aria-hidden="true" />
          <span className="lfs-mic-core">
            <Mic className="h-5 w-5" />
          </span>
        </div>
        <div className={`lfs-bars ${listening ? "is-on" : ""}`} aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <p className="lfs-spoken">
          {typed || (rows === 0 && !listening ? "بگو چی فروختی…" : "")}
          {listening && <span className="lfs-caret" />}
        </p>
        <div className="lfs-mini-receipt">
          {visible.length === 0 ? (
            <div className="py-3 text-center text-[11px] opacity-50">منتظر صدا…</div>
          ) : (
            visible.map((line) => (
              <div key={line.name} className="lfs-inv-row">
                <span>{line.name}</span>
                <span className="opacity-50">× {line.qty}</span>
                <span>{line.amount}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantScene({ live, reduced }: { live: boolean; reduced: boolean }) {
  const last = ASSIST_TURNS[ASSIST_TURNS.length - 1];
  const [idx, setIdx] = useState(reduced ? ASSIST_TURNS.length - 1 : 0);
  const [typed, setTyped] = useState(reduced ? last.command : "");
  const [replied, setReplied] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setIdx(ASSIST_TURNS.length - 1);
      setTyped(last.command);
      setReplied(true);
      return;
    }
    if (!live) return;
    const { wait, cancel, isCancelled } = createCancellableWait();
    const run = async () => {
      while (!isCancelled()) {
        for (let i = 0; i < ASSIST_TURNS.length; i++) {
          if (isCancelled()) return;
          const turn = ASSIST_TURNS[i];
          setIdx(i);
          setReplied(false);
          setTyped("");
          await wait(280);
          for (let c = 0; c < turn.command.length; c++) {
            if (isCancelled()) return;
            setTyped(turn.command.slice(0, c + 1));
            await wait(32);
          }
          await wait(380);
          if (isCancelled()) return;
          setReplied(true);
          await wait(2200);
        }
      }
    };
    void run();
    return cancel;
  }, [live, reduced, last.command]);

  const turn = ASSIST_TURNS[idx];

  return (
    <div className="lfs-assist">
      <ScreenChrome title="دستیار هوشمند" />
      <div className="lfs-assist-body">
        <div className="lfs-bubble">
          <span className="lfs-bubble-mark" aria-hidden="true">
            <Sparkles className="h-3 w-3" />
          </span>
          <p>
            {typed}
            {!replied && typed && <span className="lfs-caret" />}
          </p>
        </div>
        {replied && (
          <div className="lfs-reply">
            <span className="lfs-check lfs-check-sm">
              <Check strokeWidth={3} />
            </span>
            <p>{turn.reply}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function HubScene({ live, reduced }: { live: boolean; reduced: boolean }) {
  const [vals, setVals] = useState(
    reduced ? HUB_TARGETS : { profit: 0, debtors: 0, gold: 0, reminders: 0 },
  );
  const rafRef = useRef(0);

  useEffect(() => {
    if (reduced) {
      setVals(HUB_TARGETS);
      return;
    }
    if (!live) return;
    const { wait, cancel, isCancelled } = createCancellableWait();

    const countUp = (duration: number) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const step = (now: number) => {
          if (isCancelled()) {
            resolve();
            return;
          }
          const t = Math.min(1, (now - start) / duration);
          const e = 1 - (1 - t) ** 3;
          setVals({
            profit: Math.round(HUB_TARGETS.profit * e),
            debtors: Math.round(HUB_TARGETS.debtors * e),
            gold: Math.round(HUB_TARGETS.gold * e),
            reminders: Math.round(HUB_TARGETS.reminders * e),
          });
          if (t < 1) rafRef.current = requestAnimationFrame(step);
          else resolve();
        };
        rafRef.current = requestAnimationFrame(step);
      });

    const run = async () => {
      while (!isCancelled()) {
        setVals({ profit: 0, debtors: 0, gold: 0, reminders: 0 });
        await countUp(1100);
        await wait(3800);
      }
    };
    void run();
    return () => {
      cancel();
      cancelAnimationFrame(rafRef.current);
    };
  }, [live, reduced]);

  const cards = [
    { label: "سود امروز", value: `${faNum(vals.profit)}`, unit: "تومان", icon: TrendingUp, tone: "profit" },
    { label: "بدهکاران", value: faNum(vals.debtors), unit: "نفر", icon: Users, tone: "debt" },
    { label: "طلای ۱۸ عیار", value: faNum(vals.gold), unit: "تومان", icon: Coins, tone: "gold" },
    { label: "یادآوری امروز", value: faNum(vals.reminders), unit: "مورد", icon: Bell, tone: "bell" },
  ] as const;

  return (
    <div className="lfs-hub">
      <ScreenChrome title="پیشخوان" />
      <div className="lfs-hub-grid">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className={`lfs-stat lfs-stat-${c.tone}`}>
              <Icon className="h-3.5 w-3.5 opacity-80" />
              <div className="lfs-stat-label">{c.label}</div>
              <div className="lfs-stat-val">
                {c.value}
                <small>{c.unit}</small>
              </div>
            </div>
          );
        })}
      </div>
      <div className="lfs-chips">
        <span>
          <QrCode className="h-3 w-3" /> منوی QR
        </span>
        <span>
          <Users className="h-3 w-3" /> مشتریان
        </span>
        <span>
          <DatabaseBackup className="h-3 w-3" /> پشتیبان
        </span>
      </div>
    </div>
  );
}

export function LiveFeatureShowcase() {
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const [active, setActive] = useState(0);
  const [hold, setHold] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const progressRef = useRef<HTMLSpanElement | null>(null);
  const panelId = useId();
  const tablistId = useId();

  const goTo = useCallback((index: number, fromUser: boolean) => {
    setActive((index + TABS.length) % TABS.length);
    if (fromUser) {
      setHold(true);
      setEpoch((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    if (reduced) {
      if (progressRef.current) progressRef.current.style.transform = "scaleX(0)";
      return;
    }
    const dwell = hold ? USER_HOLD_MS : AUTOPLAY_MS;
    let elapsed = 0;
    let last = performance.now();
    let raf = 0;
    let stopped = false;

    const paint = (p: number) => {
      const el = progressRef.current;
      if (el) el.style.transform = `scaleX(${p})`;
    };
    paint(0);

    const tick = (now: number) => {
      if (stopped) return;
      elapsed += now - last;
      last = now;
      const p = Math.min(1, elapsed / dwell);
      paint(p);
      if (p >= 1) {
        setHold(false);
        setActive((i) => (i + 1) % TABS.length);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    };

    document.addEventListener("visibilitychange", onVis);
    if (!document.hidden) start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, hold, reduced, epoch]);

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    let next = active;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = active + 1;
    else next = active - 1;
    next = (next + TABS.length) % TABS.length;
    goTo(next, true);
    tabRefs.current[next]?.focus();
  };

  const current = TABS[active];

  return (
    <section id="live-showcase" className="lfs scroll-mt-28" data-glow={current.id} aria-labelledby="lfs-heading">
      <div className="lfs-bg" aria-hidden="true">
        <span className="lfs-orb lfs-orb-a" />
        <span className="lfs-orb lfs-orb-b" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className="mb-3 inline-flex items-center gap-2 text-[13px] font-bold text-[color:var(--lfs-accent)]">
            <span className="lfs-live-pill">
              <i />
              نمایش زنده
            </span>
            بدون ثبت‌نام · بدون دانلود
          </p>
          <h2 id="lfs-heading" className="text-[1.65rem] font-extrabold leading-[1.4] tracking-tight sm:text-4xl sm:leading-[1.35]">
            قبل از نصب، ببین داخل اپ دقیقاً چه کار می‌کند
          </h2>
          <p className="lp-body mx-auto mt-3 max-w-xl text-sm leading-8 text-[color:var(--lfs-muted)] sm:text-[15px]">
            این ویدیو نیست — خودت تب بزن. اسکن، فاکتور صوتی، دستیار و پیشخوان را زنده می‌بینی؛ همان چیزی که بعد از ورود در اپ واقعی رخ می‌دهد.
          </p>
        </div>

        <div className="lfs-layout">
          <div
            className="lfs-tabs"
            role="tablist"
            aria-label="قابلیت‌های اصلی KAMIX"
            id={tablistId}
            onKeyDown={onTabKeyDown}
          >
            {TABS.map((tab, i) => {
              const Icon = tab.icon;
              const on = i === active;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`${tablistId}-${tab.id}`}
                  aria-selected={on}
                  aria-controls={panelId}
                  tabIndex={on ? 0 : -1}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  onClick={() => goTo(i, true)}
                  className={`lfs-tab ${on ? "is-on" : ""}`}
                >
                  <span className="lfs-tab-icon" aria-hidden="true">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-right">
                    <span className="block text-[13px] font-extrabold leading-6 sm:text-sm">{tab.title}</span>
                    <span className="lp-body mt-0.5 block text-[11px] leading-5 text-[color:var(--lfs-muted)] sm:text-xs sm:leading-6">
                      {tab.hint}
                    </span>
                  </span>
                  {on && (
                    <span className="lfs-tab-bar" aria-hidden="true">
                      <span ref={progressRef} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="lfs-phone-col">
            <div className="lfs-aura" aria-hidden="true" />
            <div className="lfs-phone">
              <span className="lfs-side lfs-silent" />
              <span className="lfs-side lfs-vol-up" />
              <span className="lfs-side lfs-vol-dn" />
              <span className="lfs-side lfs-power" />
              <div
                className="lfs-screen"
                role="tabpanel"
                id={panelId}
                aria-labelledby={`${tablistId}-${current.id}`}
              >
                <p className="sr-only">{current.sr}</p>
                <div className="lfs-scenes" aria-hidden="true">
                  <div className={`lfs-scene ${active === 0 ? "is-on" : ""}`}>
                    <ScanScene live={visible && active === 0} reduced={reduced} />
                  </div>
                  <div className={`lfs-scene ${active === 1 ? "is-on" : ""}`}>
                    <VoiceScene live={visible && active === 1} reduced={reduced} />
                  </div>
                  <div className={`lfs-scene ${active === 2 ? "is-on" : ""}`}>
                    <AssistantScene live={visible && active === 2} reduced={reduced} />
                  </div>
                  <div className={`lfs-scene ${active === 3 ? "is-on" : ""}`}>
                    <HubScene live={visible && active === 3} reduced={reduced} />
                  </div>
                </div>
                <span className="lfs-home" />
              </div>
            </div>
            <p className="lp-body mt-4 text-center text-[11px] text-[color:var(--lfs-muted)]">
              نمایش شبیه‌سازی‌شده — داده واقعی لازم نیست
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
