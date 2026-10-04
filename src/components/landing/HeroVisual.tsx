/**
 * Hero product visual: one phone showing an invoice being filled by voice,
 * the mascot beside it, and two small result cards. Pure markup + CSS
 * animation (transform/opacity) so it is part of the server-rendered first
 * paint. Figures are illustrative sample data, labelled for screen readers.
 */
import { useEffect, useRef } from "react";
import { Check, Mic, TrendingUp } from "lucide-react";
import { Mascot } from "./Mascot";
import { prefersReducedMotion } from "./hooks";

export function HeroVisual() {
  const stageRef = useRef<HTMLDivElement>(null);

  // Gentle pointer parallax on devices with a fine pointer (GPU-only).
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
        تصویر نمونه از KAMIX روی گوشی: فروشنده می‌گوید «دو تا شیر، یه بربری، یه پنیر» و فاکتور خودش
        پر می‌شود. اعداد نمونه هستند.
      </p>
      <div className="kx-hero-blob" aria-hidden="true" />

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
            </span>
            <span className="kx-ph-said">«دو تا شیر، یه بربری، یه پنیر»</span>
          </div>
          <ul className="kx-ph-lines">
            <li style={{ animationDelay: "1s" }}>
              <span>شیر پرچرب</span>
              <b>× ۲</b>
              <em>۹۸٬۰۰۰</em>
            </li>
            <li style={{ animationDelay: "1.4s" }}>
              <span>نان بربری</span>
              <b>× ۱</b>
              <em>۱۵٬۰۰۰</em>
            </li>
            <li style={{ animationDelay: "1.8s" }}>
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

      <div className="kx-hero-mascot kx-depth-3" aria-hidden="true">
        <span className="kx-bubble">بگو چی فروختی!</span>
        <Mascot />
      </div>

      <div className="kx-chip kx-chip--a kx-depth-1" aria-hidden="true">
        <span className="kx-chip-ic kx-chip-ic--green">
          <Check />
        </span>
        <span>
          <b>فاکتور ثبت شد</b>
          <small>۲۹۸٬۰۰۰ تومان</small>
        </span>
      </div>
      <div className="kx-chip kx-chip--b kx-depth-1" aria-hidden="true">
        <span className="kx-chip-ic kx-chip-ic--blue">
          <TrendingUp />
        </span>
        <span>
          <b>سود امروز</b>
          <small>۲٬۸۴۰٬۰۰۰ تومان</small>
        </span>
      </div>
    </div>
  );
}
