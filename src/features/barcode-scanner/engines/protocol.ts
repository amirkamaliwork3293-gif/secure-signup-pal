/**
 * protocol.ts — پیام‌های بین ترد اصلی و Worker دیکود.
 */
import type { DecodeMode, ZxingHit } from "./zxing-core";

export type WorkerRequest = {
  type: "decode";
  id: number;
  width: number;
  height: number;
  /** بافر RGBA. انتقالی (transferable) فرستاده می‌شود؛ کپی نمی‌شود. */
  buffer: ArrayBuffer;
  mode: DecodeMode;
};

export type WorkerResponse =
  | { type: "ready" }
  | { type: "fail"; message: string }
  | { type: "result"; id: number; hit: ZxingHit | null };
