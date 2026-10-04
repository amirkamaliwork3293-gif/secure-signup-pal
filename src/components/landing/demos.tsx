/**
 * Self-playing product demos for the landing page (lazy chunk).
 *
 * These are visual re-enactments, not the real app: no microphone, camera,
 * storage or network access. The sentences used are ones the real voice
 * invoice parser and smart assistant understand (see
 * src/lib/voice/assistant-checklist.md), so what is shown is what the app does.
 * Each demo pauses while off-screen and parks on its most informative frame
 * when the visitor prefers reduced motion.
 */
import { useRef } from "react";
import {
  Bell,
  CheckCircle2,
  Mic,
  PackageSearch,
  Receipt,
  ScanLine,
  TrendingUp,
  UserRound,
  Zap,
} from "lucide-react";
import { BARCODE_PATTERN, useInView, useReducedMotion, useStepLoop } from "./hooks";
import { Mascot } from "./Mascot";

/* ─── Voice invoice ────────────────────────────────────────────────────────── */

const VOICE_ITEMS = [
  { said: "دو تا پیراهن مردانه", name: "پیراهن مردانه", qty: "۲", price: "۵۰۰٬۰۰۰" },
  { said: "یه شلوار جین", name: "شلوار جین", qty: "۱", price: "۴۲۰٬۰۰۰" },
  { said: "سه تا جوراب نخی", name: "جوراب نخی", qty: "۳", price: "۱۸۰٬۰۰۰" },
] as const;
const VOICE_TOTALS = ["۰", "۵۰۰٬۰۰۰", "۹۲۰٬۰۰۰", "۱٬۱۰۰٬۰۰۰"];

// idle, say1, add1, say2, add2, say3, add3, saved
const VOICE_STEPS = [1100, 1900, 800, 1700, 800, 1800, 1100, 2800] as const;

export function VoiceDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { rootMargin: "-10% 0px" });
  const reduced = useReducedMotion();
  const step = useStepLoop(VOICE_STEPS, inView, reduced);

  const listening = step === 1 || step === 3 || step === 5;
  const sayingIndex = listening ? (step - 1) / 2 : -1;
  const rows = step >= 7 ? 3 : Math.floor(step / 2);
  const saved = step === 7;
  const lastSaid = rows > 0 ? VOICE_ITEMS[rows - 1].said : "";

  return (
    <div ref={ref} className="kx-demo kx-voice-demo">
      <p className="sr-only">
        نمایش ثبت فاکتور با صدا: فروشنده می‌گوید «دو تا پیراهن مردانه»، «یه شلوار جین» و «سه تا
        جوراب نخی» و هر جمله بلافاصله یک ردیف فاکتور با قیمت از فهرست محصولات می‌سازد.
      </p>
      <div aria-hidden="true" className="kx-voice-card">
        <div className={`kx-voice-capture ${listening ? "is-on" : ""}`}>
          <span className="kx-voice-mic">
            <Mic />
            <span className="kx-voice-ring" />
          </span>
          <div className="kx-voice-text">
            <small>
              {listening ? "در حال شنیدن…" : saved ? "فاکتور آماده است" : "بگو چی فروختی"}
            </small>
            <span key={step} className={listening ? "kx-type" : ""}>
              {listening ? `«${VOICE_ITEMS[sayingIndex].said}»` : lastSaid ? `«${lastSaid}»` : "…"}
            </span>
          </div>
          <div className="kx-wave" data-on={listening ? "1" : "0"}>
            {Array.from({ length: 22 }, (_, i) => (
              <i key={i} style={{ animationDelay: `${(i % 7) * -0.13}s` }} />
            ))}
          </div>
        </div>

        <div className="kx-inv">
          <div className="kx-inv-head">
            <span>
              <Receipt /> فاکتور فروش #۱۸۴
            </span>
            <small>۱۴۰۵/۰۷/۱۲</small>
          </div>
          <div className="kx-inv-cols">
            <span>کالا</span>
            <span>تعداد</span>
            <span>مبلغ</span>
          </div>
          <ul className="kx-inv-rows">
            {VOICE_ITEMS.map((it, i) => (
              <li key={it.name} className={i < rows ? "is-in" : ""}>
                <span>{it.name}</span>
                <span>{it.qty}</span>
                <span>{it.price}</span>
              </li>
            ))}
          </ul>
          <div className="kx-inv-total">
            <span>جمع کل</span>
            <strong>
              {VOICE_TOTALS[rows]} <small>تومان</small>
            </strong>
          </div>
          <div className={`kx-inv-saved ${saved ? "is-on" : ""}`}>
            <CheckCircle2 /> ثبت شد · موجودی انبار هم کم شد
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Camera barcode scan ──────────────────────────────────────────────────── */

const SCAN_PRODUCTS = [
  { name: "شامپو ۴۰۰ میل", code: "6260100341234", price: "۸۵٬۰۰۰", tone: "a" },
  { name: "دستمال کاغذی ۲۰۰ برگ", code: "6261107710058", price: "۴۸٬۰۰۰", tone: "b" },
] as const;

// aim1, detect1, add1, aim2, detect2, add2(hold)
const SCAN_STEPS = [1500, 750, 1300, 1400, 750, 2600] as const;

export function ScanDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { rootMargin: "-10% 0px" });
  const reduced = useReducedMotion();
  const step = useStepLoop(SCAN_STEPS, inView, reduced, 5);

  const productIndex = step < 3 ? 0 : 1;
  const product = SCAN_PRODUCTS[productIndex];
  const detected = step === 1 || step === 2 || step === 4 || step === 5;
  const added = step === 2 || step === 5;
  const lines = step >= 5 ? 2 : step >= 2 ? 1 : 0;

  return (
    <div ref={ref} className="kx-demo kx-scan-demo">
      <p className="sr-only">
        نمایش اسکن بارکد با دوربین گوشی: دوربین روی بارکد کالا قرار می‌گیرد، کد شناسایی می‌شود و
        کالا با قیمتش بلافاصله به فاکتور اضافه می‌شود.
      </p>
      <div aria-hidden="true" className="kx-phone kx-scan-phone">
        <div className="kx-phone-notch" />
        <div className="kx-phone-screen kx-scan-screen">
          <div className="kx-cam">
            <div className="kx-cam-top">
              <ScanLine /> اسکن بارکد
            </div>
            <div key={productIndex} className={`kx-box kx-box--${product.tone}`}>
              <span className="kx-box-label">{product.name}</span>
              <span className="kx-box-code">
                {BARCODE_PATTERN.map((w, i) => (
                  <i key={i} style={{ width: `${w * 1.5}px` }} />
                ))}
              </span>
              <span className="kx-box-digits">{product.code}</span>
            </div>
            <div className={`kx-reticle ${detected ? "is-locked" : ""}`}>
              <span />
              <span />
              <span />
              <span />
              {!detected && <i className="kx-beam" />}
            </div>
            <div className={`kx-cam-toast ${added ? "is-on" : ""}`}>
              <CheckCircle2 />
              <span>
                <b>{product.name}</b>
                <small>{product.price} تومان · به فاکتور اضافه شد</small>
              </span>
            </div>
          </div>
          <div className="kx-scan-list">
            <div className="kx-scan-list-head">
              <span>فاکتور جاری</span>
              <b>{lines === 0 ? "۰" : lines === 1 ? "۱" : "۲"} قلم</b>
            </div>
            {SCAN_PRODUCTS.map((p, i) => (
              <div key={p.code} className={`kx-scan-line ${i < lines ? "is-in" : ""}`}>
                <span>{p.name}</span>
                <em>{p.price}</em>
              </div>
            ))}
            <div className="kx-scan-sum">
              <span>جمع</span>
              <strong>{lines === 0 ? "۰" : lines === 1 ? "۸۵٬۰۰۰" : "۱۳۳٬۰۰۰"} تومان</strong>
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className={`kx-scan-flash ${added ? "is-on" : ""}`}>
        <Zap /> کمتر از یک ثانیه
      </div>
    </div>
  );
}

/* ─── Smart assistant ──────────────────────────────────────────────────────── */

type AssistTurn = {
  ask: string;
  icon: "report" | "debt" | "stock" | "reminder";
  title: string;
  lines: string[];
  action?: string;
};

const ASSIST_TURNS: AssistTurn[] = [
  {
    ask: "امروز چقدر سود داشتم؟",
    icon: "report",
    title: "گزارش امروز",
    lines: ["سود امروز: ۲٬۸۴۰٬۰۰۰ تومان", "از ۲۳ فاکتور · فروش ۱۱٬۶۰۰٬۰۰۰ تومان"],
  },
  {
    ask: "آقای شهریاری ۲۵۰ هزار تومان بدهکار است",
    icon: "debt",
    title: "ثبت بدهی مشتری",
    lines: ["۲۵۰٬۰۰۰ تومان به حساب «شهریاری» اضافه شد", "مانده‌ی جدید: ۱٬۱۵۰٬۰۰۰ تومان بدهکار"],
    action: "ثبت شد",
  },
  {
    ask: "کالاهای رو به اتمام چیه؟",
    icon: "stock",
    title: "موجودی انبار",
    lines: ["۳ کالا رو به اتمام:", "شیر پرچرب (۲)، روغن ۸۱۰ گرمی (۳)، برنج ۵ کیلویی (۱)"],
  },
  {
    ask: "یادآوری پرداخت چک فردا ساعت ۱۰",
    icon: "reminder",
    title: "یادآوری ساخته شد",
    lines: ["پرداخت چک", "فردا · ساعت ۱۰:۰۰"],
    action: "در برنامه هفته",
  },
];

const ASSIST_ICONS = {
  report: TrendingUp,
  debt: UserRound,
  stock: PackageSearch,
  reminder: Bell,
} as const;

// Per turn: typing, thinking, answer → 3 steps × 4 turns.
const ASSIST_STEPS = ASSIST_TURNS.flatMap(() => [1500, 650, 2600]);

export function AssistantDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { rootMargin: "-10% 0px" });
  const reduced = useReducedMotion();
  const step = useStepLoop(ASSIST_STEPS, inView, reduced, 5);

  const turn = Math.floor(step / 3);
  const phase = step % 3; // 0 typing · 1 thinking · 2 answered
  // Show the previous turn (completed) above the current one for context.
  const visible: Array<{ t: AssistTurn; idx: number; done: boolean; showAsk: boolean }> = [];
  if (turn > 0)
    visible.push({ t: ASSIST_TURNS[turn - 1], idx: turn - 1, done: true, showAsk: true });
  visible.push({ t: ASSIST_TURNS[turn], idx: turn, done: phase === 2, showAsk: phase > 0 });

  return (
    <div ref={ref} className="kx-demo kx-assist-demo">
      <p className="sr-only">
        نمایش دستیار هوشمند: سؤال‌هایی مثل «امروز چقدر سود داشتم؟» یا دستورهایی مثل «آقای شهریاری
        ۲۵۰ هزار تومان بدهکار است» گفته یا تایپ می‌شود و دستیار از روی داده‌های خود حساب جواب می‌دهد
        یا کار را ثبت می‌کند.
      </p>
      <div aria-hidden="true" className="kx-assist">
        <div className="kx-assist-head">
          <span className="kx-assist-avatar">
            <Mascot wave={false} />
          </span>
          <span>
            <b>دستیار هوشمند KAMIX</b>
            <small>با صدا یا تایپ، به فارسی</small>
          </span>
        </div>

        <div className="kx-assist-body">
          {visible.map(({ t, idx, done, showAsk }) => {
            const Icon = ASSIST_ICONS[t.icon];
            return (
              <div key={idx} className="kx-turn">
                {showAsk && <div className="kx-bubble-user">{t.ask}</div>}
                {showAsk && !done && (
                  <div className="kx-thinking">
                    <i />
                    <i />
                    <i />
                  </div>
                )}
                {done && (
                  <div className={`kx-answer kx-answer--${t.icon}`}>
                    <div className="kx-answer-title">
                      <span className="kx-answer-ic">
                        <Icon />
                      </span>
                      {t.title}
                      {t.action && (
                        <span className="kx-answer-badge">
                          <CheckCircle2 /> {t.action}
                        </span>
                      )}
                    </div>
                    {t.lines.map((l) => (
                      <p key={l}>{l}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="kx-assist-input">
          <span className="kx-assist-typed">
            {phase === 0 ? (
              <span key={step} className="kx-type">
                {ASSIST_TURNS[turn].ask}
              </span>
            ) : (
              <span className="kx-placeholder">بپرس یا دستور بده…</span>
            )}
          </span>
          <span className={`kx-assist-mic ${phase === 0 ? "is-on" : ""}`}>
            <Mic />
          </span>
        </div>
      </div>
    </div>
  );
}
