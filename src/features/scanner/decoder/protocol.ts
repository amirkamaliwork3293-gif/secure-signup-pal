/**
 * protocol.ts — پیام‌های بین ترد اصلی و Worker دیکود.
 */

export type DecodeRequest = {
  id: number;
  /** مسیر سریع: ImageBitmap منتقل‌شده (transfer). */
  bitmap?: ImageBitmap;
  /** مسیر سازگار: بافر RGBA منتقل‌شده. */
  buffer?: ArrayBuffer;
  width?: number;
  height?: number;
};

export type WorkerResponse =
  | {
      type: "ready";
      /** آیا Worker می‌تواند ImageBitmap را به پیکسل تبدیل کند؟ */
      offscreen: boolean;
    }
  | { type: "fail"; reason: string }
  | { type: "result"; id: number; text: string | null; format: string | null };
