/**
 * useScanner.ts — پل بین ری‌اکت و `ScannerSession`.
 *
 * افکت **بدون وابستگی** است و این عمدی است: در نسخهٔ قبل هر اسکن، والد را رندر
 * می‌کرد، `onDetected` عوض می‌شد، افکت دوباره اجرا می‌شد و دوربین قطع و از نو
 * ساخته می‌شد — علت اصلی لگ و «اسکن دوم کار نمی‌کند». مقادیر متغیر از طریق ref
 * خوانده می‌شوند تا هویت افکت ثابت بماند.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { reticleRect } from "./geometry";
import { ScannerSession, type ScannerStatus } from "./session";

const INITIAL_STATUS: ScannerStatus = {
  phase: "starting",
  error: null,
  engine: null,
  torchSupported: false,
  torchOn: false,
  zoom: null,
  cameraCount: 0,
  cameraIndex: 0,
  fps: 0,
};

export type UseScannerArgs = {
  onDetected: (code: string, format?: string) => void;
  paused?: boolean;
};

export function useScanner({ onDetected, paused }: UseScannerArgs) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<ScannerSession | null>(null);

  const [status, setStatus] = useState<ScannerStatus>(INITIAL_STATUS);
  const [boxScale, setBoxScale] = useState(1);

  // هر چیزی که در طول عمر افکت عوض می‌شود، از ref خوانده می‌شود نه از کلوژر.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const pausedRef = useRef(false);
  pausedRef.current = !!paused;
  const boxScaleRef = useRef(boxScale);
  boxScaleRef.current = boxScale;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const session = new ScannerSession({
      video,
      onCode: (code, format) => onDetectedRef.current(code, format),
      onStatus: setStatus,
      getRect: () => reticleRect(boxScaleRef.current),
      isPaused: () => pausedRef.current,
    });
    sessionRef.current = session;
    void session.start();

    return () => {
      sessionRef.current = null;
      session.dispose();
    };
  }, []);

  const toggleTorch = useCallback(() => void sessionRef.current?.toggleTorch(), []);
  const cycleCamera = useCallback(() => void sessionRef.current?.cycleCamera(), []);
  const refocus = useCallback(() => void sessionRef.current?.refocus(), []);
  const setZoom = useCallback((v: number) => void sessionRef.current?.setZoom(v), []);
  const focusAt = useCallback((x: number, y: number) => void sessionRef.current?.focusAt(x, y), []);

  return {
    videoRef,
    status,
    boxScale,
    setBoxScale,
    controls: { toggleTorch, cycleCamera, refocus, setZoom, focusAt },
  };
}
