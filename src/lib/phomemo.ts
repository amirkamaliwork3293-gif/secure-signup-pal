/**
 * phomemo.ts — چاپ مستقیم روی مینی‌پرینترهای فوممو (M110 / M120 / M220) با بلوتوث مرورگر
 *
 * آزمایشی است و فقط در صفحهٔ ‎/printer-test‎ استفاده می‌شود؛ به هیچ داده‌ای دست نمی‌زند.
 *
 * پروتکل (از روی ضبط بستهٔ برنامهٔ رسمی؛ مستند رسمی ندارد — phomemo-tools):
 *   سرعت       1b 4e 0d <1..5>
 *   غلظت       1b 4e 04 <1..15>
 *   نوع کاغذ   1f 11 <0a فاصله‌دار | 0b پیوسته | 26 نشانه‌دار>
 *   تصویر      1d 76 30 00 <بایت هر خط LE16> <تعداد خط LE16> <داده: ۱ = سیاه، بیت پرارزش اول>
 *   پایان      1f f0 05 00   1f f0 03 00
 * کل فیش در «یک» فرمان تصویر فرستاده می‌شود: M220 هر فرمان تصویر را یک چاپ جدا حساب
 * می‌کند و بین آن‌ها حدود ۶ میلی‌متر فاصله می‌اندازد.
 *
 * پروتکل دوم «ESC/POS» — همان که phomymo (چاپ با مرورگر، M220 را پشتیبانی می‌کند) برای
 * سری M200/M220 می‌فرستد؛ هر دستور جدا و با مکث کوتاه:
 *   1b 40 (شروع) · 1b 37 07 <گرما> 02 · 1d 7c <غلظت> · 1d 76 30 00 … · 1b 4a <تغذیهٔ کاغذ>
 * بلوتوث: سرویس 0xff00، نوشتن روی 0xff02، پاسخ‌های پرینتر روی 0xff03.
 */

export type PhomemoProtocol = "escpos" | "m110";

export type PhomemoMedia = "continuous" | "gap";

export type PhomemoJobOptions = {
  /** غلظت چاپ ۱ تا ۱۵ */
  density: number;
  /** سرعت چاپ ۱ (آهسته) تا ۵ (تند) */
  speed: number;
  media: PhomemoMedia;
};

const MEDIA_CODE: Record<PhomemoMedia, number> = { gap: 0x0a, continuous: 0x0b };

const clampInt = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/**
 * پیکسل‌های canvas (RGBA) → بیت‌های چاپ: هر خط به بایت کامل گرد می‌شود،
 * ۱ = نقطهٔ سیاه، بیت پرارزش = نقطهٔ چپ.
 */
export function packBitmap(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 170,
): { bits: Uint8Array; widthBytes: number } {
  const widthBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) bits[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bits, widthBytes };
}

/** دستورهای کامل یک چاپ: تنظیمات + یک تصویر + پایان */
export function buildPhomemoJob(
  bits: Uint8Array,
  widthBytes: number,
  lines: number,
  opts: PhomemoJobOptions,
): Uint8Array {
  if (widthBytes < 1 || widthBytes > 0xffff) throw new Error("invalid width");
  if (lines < 1 || lines > 0xffff) throw new Error("image too long");
  if (bits.length !== widthBytes * lines) throw new Error("bitmap size mismatch");
  const header = [
    0x1b,
    0x4e,
    0x0d,
    clampInt(opts.speed, 1, 5),
    0x1b,
    0x4e,
    0x04,
    clampInt(opts.density, 1, 15),
    0x1f,
    0x11,
    MEDIA_CODE[opts.media],
    0x1d,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    widthBytes >> 8,
    lines & 0xff,
    lines >> 8,
  ];
  const footer = [0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00];
  const out = new Uint8Array(header.length + bits.length + footer.length);
  out.set(header, 0);
  out.set(bits, header.length);
  out.set(footer, header.length + bits.length);
  return out;
}

/** یک مرحلهٔ ارسال: بایت‌ها + مکث بعد از آن. chunked = تکه‌تکه (دادهٔ تصویر) */
export type PrintStep = { bytes: Uint8Array; waitMs: number; chunked?: boolean; label: string };

/** غلظت ۱..۱۵ → «زمان گرما» در ESC 7 (مثل phomymo: ۸ پله از ۴۰ تا ۲۰۰) */
function heatTime(density: number): number {
  const steps = [40, 60, 80, 100, 120, 140, 160, 200];
  return steps[clampInt(Math.ceil((clampInt(density, 1, 15) * 8) / 15), 1, 8) - 1];
}

/** مراحل کامل یک چاپ برای پروتکل انتخاب‌شده (کل فیش = یک فرمان تصویر) */
export function buildPrintSteps(
  protocol: PhomemoProtocol,
  bits: Uint8Array,
  widthBytes: number,
  lines: number,
  opts: PhomemoJobOptions & { feedDots: number; sendInit?: boolean },
): PrintStep[] {
  if (protocol === "m110") {
    return [
      {
        bytes: buildPhomemoJob(bits, widthBytes, lines, opts),
        waitMs: 300,
        chunked: true,
        label: "M110",
      },
    ];
  }
  if (widthBytes < 1 || widthBytes > 0xffff) throw new Error("invalid width");
  if (lines < 1 || lines > 0xffff) throw new Error("image too long");
  if (bits.length !== widthBytes * lines) throw new Error("bitmap size mismatch");
  const d8 = clampInt(Math.ceil((clampInt(opts.density, 1, 15) * 8) / 15), 1, 8);
  const steps: PrintStep[] = [];
  if (opts.sendInit)
    steps.push({ bytes: new Uint8Array([0x1b, 0x40]), waitMs: 100, label: "شروع (ESC @)" });
  return [
    ...steps,
    {
      bytes: new Uint8Array([0x1b, 0x37, 0x07, heatTime(opts.density), 0x02]),
      waitMs: 30,
      label: "گرما",
    },
    { bytes: new Uint8Array([0x1d, 0x7c, d8]), waitMs: 50, label: "غلظت" },
    {
      bytes: new Uint8Array([
        0x1d,
        0x76,
        0x30,
        0x00,
        widthBytes & 0xff,
        widthBytes >> 8,
        lines & 0xff,
        lines >> 8,
      ]),
      waitMs: 0,
      label: "سرآغاز تصویر",
    },
    { bytes: bits, waitMs: 300, chunked: true, label: "دادهٔ تصویر" },
    {
      bytes: new Uint8Array([0x1b, 0x4a, clampInt(opts.feedDots, 0, 255)]),
      waitMs: 800,
      label: "جلو بردن کاغذ",
    },
  ];
}

// ─── بلوتوث مرورگر (Web Bluetooth) — حداقل تایپ‌های لازم ─────────────────────

type BtCharacteristic = {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithResponse?: (v: Uint8Array) => Promise<void>;
  writeValueWithoutResponse?: (v: Uint8Array) => Promise<void>;
  writeValue?: (v: Uint8Array) => Promise<void>;
};
type BtNotifyCharacteristic = {
  startNotifications: () => Promise<unknown>;
  addEventListener: (type: string, fn: (e: { target?: unknown }) => void) => void;
  value?: DataView;
};
type BtService = {
  uuid: string;
  getCharacteristic: (id: number | string) => Promise<BtCharacteristic & BtNotifyCharacteristic>;
  getCharacteristics: () => Promise<BtCharacteristic[]>;
};
type BtServer = {
  connected: boolean;
  connect: () => Promise<BtServer>;
  disconnect: () => void;
  getPrimaryService: (id: number | string) => Promise<BtService>;
  getPrimaryServices: () => Promise<BtService[]>;
};
type BtDevice = {
  name?: string;
  gatt?: BtServer;
  addEventListener?: (type: string, fn: () => void) => void;
};
type BtApi = {
  requestDevice: (o: {
    acceptAllDevices?: boolean;
    optionalServices?: (number | string)[];
  }) => Promise<BtDevice>;
};

export function bluetoothAvailable(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as { bluetooth?: BtApi }).bluetooth;
}

export type PhomemoConnection = {
  name: string;
  /** کد سرویس/مشخصه‌ای که برای نوشتن پیدا شد (برای گزارش) */
  via: string;
  canWriteWithoutResponse: boolean;
  write: (data: Uint8Array, withResponse: boolean) => Promise<void>;
  disconnect: () => void;
  isConnected: () => boolean;
};

/** سرویس‌های رایج پرینترهای حرارتی بلوتوثی؛ فوممو = ff00 */
const KNOWN_SERVICES: (number | string)[] = [0xff00, 0x18f0, 0xae30, 0xfee7, 0xff10];

/**
 * پنجرهٔ انتخاب دستگاه بلوتوث را باز می‌کند و به پرینتر وصل می‌شود.
 * باید از داخل کلیک کاربر صدا زده شود.
 */
export async function connectPhomemo(
  log: (msg: string) => void,
  opts: { notifications?: boolean; onDisconnect?: () => void } = {},
): Promise<PhomemoConnection> {
  const bt = (navigator as { bluetooth?: BtApi }).bluetooth;
  if (!bt) throw new Error("no-bluetooth");
  const device = await bt.requestDevice({
    acceptAllDevices: true,
    optionalServices: KNOWN_SERVICES,
  });
  const name = device.name || "بدون نام";
  log(`دستگاه انتخاب شد: ${name}`);
  if (!device.gatt) throw new Error("no-gatt");
  // قطع شدن از طرف پرینتر را ثبت کن (کمک به یافتن علت)
  device.addEventListener?.("gattserverdisconnected", () => {
    log("⚠ اتصال از طرف پرینتر قطع شد");
    opts.onDisconnect?.();
  });
  const server = await device.gatt.connect();
  log("اتصال بلوتوث برقرار شد");

  // مکث کوتاه پس از اتصال پیش از جست‌وجوی سرویس (مثل phomymo)
  await new Promise((r) => setTimeout(r, 100));
  let ch: BtCharacteristic | null = null;
  let via = "";
  try {
    const svc = await server.getPrimaryService(0xff00);
    ch = await svc.getCharacteristic(0xff02);
    via = "ff00/ff02";
    // پاسخ‌های پرینتر (وضعیت/خطا) — اختیاری؛ روی بعضی گوشی‌ها/پرینترها اتصال را می‌اندازد
    if (opts.notifications)
      try {
        const notify = await svc.getCharacteristic(0xff03);
        notify.addEventListener("characteristicvaluechanged", (e) => {
          const v = (e.target as { value?: DataView } | undefined)?.value;
          if (!v) return;
          const hex = Array.from(new Uint8Array(v.buffer, v.byteOffset, Math.min(v.byteLength, 24)))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");
          log(`پاسخ پرینتر: ${hex}`);
        });
        // سقف زمانی: روی بعضی گوشی‌ها این درخواست هیچ‌وقت جواب نمی‌گیرد
        await Promise.race([
          notify.startNotifications(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
        ]);
        log("دریافت پاسخ پرینتر (ff03) فعال شد");
      } catch {
        log("دریافت پاسخ پرینتر در دسترس نیست (ادامه بدون آن)");
      }
  } catch {
    log("سرویس استاندارد فوممو (ff00) پیدا نشد؛ جست‌وجوی سرویس‌های دیگر…");
    for (const svc of await server.getPrimaryServices()) {
      for (const c of await svc.getCharacteristics()) {
        log(`  سرویس ${svc.uuid} — مشخصه ${c.uuid}`);
        if (!ch && (c.properties.write || c.properties.writeWithoutResponse)) {
          ch = c;
          via = `${svc.uuid} / ${c.uuid}`;
        }
      }
    }
  }
  if (!ch) {
    server.disconnect();
    throw new Error("no-writable-characteristic");
  }
  log(`مسیر ارسال: ${via}`);
  const target = ch;
  return {
    name,
    via,
    canWriteWithoutResponse: !!target.properties.writeWithoutResponse,
    write: async (data, withResponse) => {
      if (
        !withResponse &&
        target.writeValueWithoutResponse &&
        target.properties.writeWithoutResponse
      )
        return target.writeValueWithoutResponse(data);
      if (target.writeValueWithResponse) return target.writeValueWithResponse(data);
      if (target.writeValue) return target.writeValue(data);
      throw new Error("characteristic not writable");
    },
    disconnect: () => {
      try {
        server.disconnect();
      } catch {
        /* ignore */
      }
    },
    isConnected: () => server.connected,
  };
}

/** اجرای مراحل چاپ به ترتیب: هر دستور یک نوشتن جدا + مکث؛ دادهٔ تصویر تکه‌تکه */
export async function sendSteps(
  conn: PhomemoConnection,
  steps: PrintStep[],
  opts: { chunk: number; delayMs: number; withResponse: boolean },
  onProgress?: (sent: number, total: number) => void,
  log?: (msg: string) => void,
): Promise<void> {
  const total = steps.reduce((n, s) => n + s.bytes.length, 0);
  let done = 0;
  for (const step of steps) {
    if (!conn.isConnected()) throw new Error("disconnected");
    if (step.chunked) {
      await sendToPrinter(conn, step.bytes, opts, (sent) => onProgress?.(done + sent, total));
    } else {
      await conn.write(step.bytes, opts.withResponse);
    }
    done += step.bytes.length;
    onProgress?.(done, total);
    log?.(`✓ ${step.label} (${step.bytes.length} بایت)`);
    if (step.waitMs > 0) await new Promise((r) => setTimeout(r, step.waitMs));
  }
}

/** ارسال تکه‌تکه با مکث کوتاه تا حافظهٔ پرینتر سرریز نشود */
export async function sendToPrinter(
  conn: PhomemoConnection,
  data: Uint8Array,
  opts: { chunk: number; delayMs: number; withResponse: boolean },
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const chunk = clampInt(opts.chunk, 20, 512);
  for (let i = 0; i < data.length; i += chunk) {
    if (!conn.isConnected()) throw new Error("disconnected");
    await conn.write(data.subarray(i, Math.min(i + chunk, data.length)), opts.withResponse);
    onProgress?.(Math.min(i + chunk, data.length), data.length);
    if (opts.delayMs > 0) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
}
