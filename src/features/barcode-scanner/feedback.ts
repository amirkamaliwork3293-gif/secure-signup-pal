/**
 * feedback.ts — بیپ و لرزش کوتاه هنگام خوانش موفق، مثل دستگاه بارکدخوان.
 *
 * صدا با WebAudio ساخته می‌شود (بدون فایل صوتی). AudioContext فقط یک بار و
 * تنبل ساخته می‌شود و در `dispose` بسته می‌شود. هر خطا بی‌صدا نادیده گرفته
 * می‌شود: نبودِ صدا نباید اسکن را مختل کند.
 */

type AudioCtor = typeof AudioContext;

export class Feedback {
  private ctx: AudioContext | null = null;

  constructor(private soundOn: () => boolean) {}

  /** در اولین لمس کاربر صدا زده می‌شود تا سیاست autoplay مرورگر صدا را آزاد کند. */
  unlock(): void {
    const ctx = this.audio();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
  }

  private audio(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor =
        (globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor })
          .AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  success(): void {
    vibrate(30);
    if (this.soundOn()) this.tone(2350, 0.075);
  }

  /** بیپ کوتاه دوتایی برای «بارکدی پیدا نشد» در اسکن عکس. */
  miss(): void {
    vibrate([20, 60, 20]);
    if (this.soundOn()) this.tone(420, 0.12);
  }

  private tone(freq: number, seconds: number): void {
    try {
      const ctx = this.audio();
      if (!ctx) return;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.006);
      gain.gain.setValueAtTime(0.18, t + seconds - 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + seconds + 0.01);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch {
      /* بدون صدا ادامه */
    }
  }

  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    try {
      void ctx?.close().catch(() => {});
    } catch {
      /* already closed */
    }
  }
}

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function")
      navigator.vibrate(pattern);
  } catch {
    /* بعضی WebView ها بدون مجوز throw می‌کنند */
  }
}
