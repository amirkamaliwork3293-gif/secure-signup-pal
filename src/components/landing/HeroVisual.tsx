/**
 * Hero product visual: dashboard window + phone in front + floating result chips.
 * Pure markup + CSS animation (transform/opacity only) so it is part of the
 * server-rendered first paint and costs no extra JS beyond a tiny parallax.
 * All figures are illustrative sample data, labelled as such for screen readers.
 */
import { useEffect, useRef } from "react";
import { BarChart3, Check, Mic, ScanLine, Sparkles, TrendingUp, Users } from "lucide-react";
import { KamixMark } from "./KamixMark";
import { prefersReducedMotion } from "./hooks";

const WEEK_BARS = [38, 52, 44, 66, 58, 81, 72];
const WEEK_DAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

export function HeroVisual() {
  const stageRef = useRef<HTMLDivElement>(null);

  // Subtle pointer parallax on devices with a fine pointer. Writes two CSS
  // variables once per frame; children translate with them (GPU-only).
  useEffect(() => {
    const el = stageRef.current;
    if (!el || prefersReducedMotion()) return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = (e.clientX - (r.left + r.width / 2)) / r.width;
      ty = (e.clientY - (r.top + r.height / 2)) / r.height;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          el.style.setProperty("--kx-px", tx.toFixed(3));
          el.style.setProperty("--kx-py", ty.toFixed(3));
        });
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={stageRef} className="kx-hero-stage">
      <p className="sr-only">
        تصویر نمونه از محیط KAMIX: پیشخوان فروش و سود هفته روی دسکتاپ، و فاکتوری که روی گوشی با صدا
        ثبت می‌شود. اعداد نمونه هستند.
      </p>
      <div className="kx-hero-glow" aria-hidden="true" />

      {/* Desktop dashboard window */}
      <div className="kx-dash kx-depth-1" aria-hidden="true">
        <div className="kx-dash-bar">
          <span className="kx-dot" />
          <span className="kx-dot" />
          <span className="kx-dot" />
          <span className="kx-dash-url">kamixapp.ir</span>
        </div>
        <div className="kx-dash-body">
          <div className="kx-dash-head">
            <KamixMark className="kx-dash-mark" />
            <div>
              <strong>پیشخوان امروز</strong>
              <small>شنبه · به‌روز شد همین الان</small>
            </div>
          </div>
          <div className="kx-kpis">
            <div className="kx-kpi">
              <small>فروش امروز</small>
              <strong>۱۸٬۴۲۰٬۰۰۰</strong>
              <span className="kx-up">
                <TrendingUp /> ۱۲٪
              </span>
            </div>
            <div className="kx-kpi">
              <small>سود خالص</small>
              <strong>۴٬۹۷۵٬۰۰۰</strong>
              <span className="kx-up">
                <TrendingUp /> ۸٪
              </span>
            </div>
            <div className="kx-kpi kx-kpi--hide-sm">
              <small>طلب از مشتری‌ها</small>
              <strong>۶٬۲۰۰٬۰۰۰</strong>
              <span className="kx-muted">
                <Users /> ۹ نفر
              </span>
            </div>
          </div>
          <div className="kx-chart">
            <div className="kx-chart-title">
              <BarChart3 /> فروش هفته
            </div>
            <div className="kx-bars">
              {WEEK_BARS.map((h, i) => (
                <span key={i} style={{ height: `${h}%`, animationDelay: `${0.5 + i * 0.07}s` }}>
                  <i>{WEEK_DAYS[i]}</i>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Phone in front */}
      <div className="kx-phone kx-hero-phone kx-depth-2" aria-hidden="true">
        <div className="kx-phone-notch" />
        <div className="kx-phone-screen kx-hero-phone-screen">
          <div className="kx-ph-top">
            <span>فاکتور فروش</span>
            <small>۱۴۰۵/۰۷/۱۲</small>
          </div>
          <div className="kx-ph-voice">
            <span className="kx-ph-mic">
              <Mic />
            </span>
            <span className="kx-mini-wave">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="kx-ph-said">«دو تا شیر، یه بربری، یه پنیر»</span>
          </div>
          <ul className="kx-ph-lines">
            <li style={{ animationDelay: "1.1s" }}>
              <span>شیر پرچرب</span>
              <b>× ۲</b>
              <em>۹۸٬۰۰۰</em>
            </li>
            <li style={{ animationDelay: "1.5s" }}>
              <span>نان بربری</span>
              <b>× ۱</b>
              <em>۱۵٬۰۰۰</em>
            </li>
            <li style={{ animationDelay: "1.9s" }}>
              <span>پنیر لیقوان</span>
              <b>× ۱</b>
              <em>۱۸۵٬۰۰۰</em>
            </li>
          </ul>
          <div className="kx-ph-total">
            <span>جمع کل</span>
            <strong>۲۹۸٬۰۰۰ تومان</strong>
          </div>
          <div className="kx-ph-cta">ثبت فاکتور</div>
        </div>
      </div>

      {/* Floating proof chips */}
      <div className="kx-chip kx-chip--a kx-depth-3" aria-hidden="true">
        <span className="kx-chip-ic kx-chip-ic--blue">
          <Mic />
        </span>
        <span>
          <b>فاکتور با صدا ثبت شد</b>
          <small>۳ قلم · ۴ ثانیه</small>
        </span>
      </div>
      <div className="kx-chip kx-chip--b kx-depth-3" aria-hidden="true">
        <span className="kx-chip-ic kx-chip-ic--cyan">
          <ScanLine />
        </span>
        <span>
          <b>بارکد شناسایی شد</b>
          <small>به فاکتور اضافه شد</small>
        </span>
        <Check className="kx-chip-ok" />
      </div>
      <div className="kx-chip kx-chip--c kx-depth-3" aria-hidden="true">
        <span className="kx-chip-ic kx-chip-ic--violet">
          <Sparkles />
        </span>
        <span>
          <b>«سود این ماه چقدره؟»</b>
          <small>دستیار: ۸۶٬۴۰۰٬۰۰۰ تومان</small>
        </span>
      </div>
    </div>
  );
}
