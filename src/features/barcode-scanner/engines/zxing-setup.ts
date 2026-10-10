/**
 * zxing-setup.ts — به zxing می‌گوید فایل wasm را از کجا بردارد (فقط مرورگر).
 *
 * `?url` باعث می‌شود Vite فایل wasm را کنار باندل با نام هش‌دار کپی کند. بدون
 * این، کتابخانه wasm را از CDN عمومی می‌گرفت و اسکنر به دامنهٔ ثالث وابسته
 * می‌شد (پشت فیلتر یا قطعی شبکه از کار می‌افتاد). فایل هش‌دار زیر `/assets/`
 * توسط سرویس‌ورکر اپ اندروید هم کش می‌شود.
 */
import { getZXingModule, prepareZXingModule } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

let ready: Promise<unknown> | null = null;

/** wasm را دانلود و کامپایل می‌کند. فراخوانی تکراری همان Promise را برمی‌گرداند. */
export function loadZxing(): Promise<unknown> {
  if (!ready) {
    prepareZXingModule({ overrides: { locateFile: () => wasmUrl }, fireImmediately: false });
    ready = getZXingModule().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
