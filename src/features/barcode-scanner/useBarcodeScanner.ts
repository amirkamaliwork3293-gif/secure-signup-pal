/**
 * useBarcodeScanner.ts — پل React ↔ ScanEngine.
 *
 * موتور فقط روی کلاینت و داخل effect ساخته می‌شود (SSR امن) و در unmount با یک
 * `dispose()` همه‌چیز آزاد می‌شود: دوربین، Worker، AudioContext، شنود کیبورد.
 * `onDetected` در ref نگه داشته می‌شود تا عوض شدنش دوربین را دوباره راه‌اندازی نکند.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ScanEngine, type ScannerSnapshot } from "./engine";
import type { CanonicalFormat } from "./formats";
import { listenForHardwareScanner } from "./keyboard-wedge";

const IDLE_SNAPSHOT: ScannerSnapshot = {
  phase: "starting",
  error: null,
  paused: false,
  torch: { supported: false, on: false },
  zoom: null,
  lenses: [],
  lensId: null,
  engines: { native: false, zxing: "none" },
  sound: true,
  track: null,
  last: null,
  imageBusy: false,
};

const noopSubscribe = () => () => {};
const idle = () => IDLE_SNAPSHOT;

export function useBarcodeScanner(opts: {
  onDetected: (code: string, format: CanonicalFormat) => void;
  paused: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const onDetectedRef = useRef(opts.onDetected);
  onDetectedRef.current = opts.onDetected;
  const pausedRef = useRef(opts.paused);
  pausedRef.current = opts.paused;

  const [engine, setEngine] = useState<ScanEngine | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    const view = viewRef.current;
    if (!video || !view) return;
    const e = new ScanEngine((code, format) => onDetectedRef.current(code, format));
    e.setPaused(pausedRef.current);
    e.start(video, view);
    const stopKeyboard = listenForHardwareScanner(
      (code) => e.keyboardCode(code),
      () => !pausedRef.current,
    );
    setEngine(e);
    return () => {
      stopKeyboard();
      e.dispose();
      setEngine(null);
    };
  }, []);

  useEffect(() => {
    engine?.setPaused(opts.paused);
  }, [engine, opts.paused]);

  const snapshot = useSyncExternalStore(
    engine ? engine.subscribe : noopSubscribe,
    engine ? engine.getSnapshot : idle,
    idle,
  );

  return { videoRef, viewRef, engine, snapshot };
}
