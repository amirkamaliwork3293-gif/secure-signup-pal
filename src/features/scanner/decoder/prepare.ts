/**
 * prepare.ts — به zxing می‌گوید فایل wasm را از کجا بردارد.
 *
 * `?url` باعث می‌شود Vite فایل wasm را کنار باندل کپی کند و آدرس هش‌دار بدهد.
 * بدون این، کتابخانه به‌صورت پیش‌فرض wasm را از CDN عمومی jsDelivr می‌گیرد —
 * که یعنی اسکنر به دامنهٔ ثالث وابسته می‌شد و پشت فیلتر/قطعی شبکه از کار می‌افتاد.
 */
import { prepareZXingModule } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

let prepared = false;

export function prepareWasm(): void {
  if (prepared) return;
  prepared = true;
  prepareZXingModule({ overrides: { locateFile: () => wasmUrl }, fireImmediately: false });
}
