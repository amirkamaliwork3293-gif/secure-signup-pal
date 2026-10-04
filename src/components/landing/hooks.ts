/**
 * Small hooks and primitives shared by the landing page and its lazy demos.
 * Landing-only: nothing here is imported by in-app screens.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Live `prefers-reduced-motion` value. SSR and first client render: false. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

/**
 * True while the element is on screen (and the tab is visible). Used to pause
 * looping demos when nobody can see them.
 */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  { rootMargin = "0px", once = false }: { rootMargin?: string; once?: boolean } = {},
): boolean {
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, once]);

  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return once ? inView : inView && pageVisible;
}

/**
 * Adds `is-in` to every `.kx-reveal` inside the landing root once it scrolls
 * into view. Reduced motion → everything is shown immediately.
 */
export function useRevealOnScroll(rootRef: RefObject<HTMLElement | null>, dep: unknown) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(".kx-reveal:not(.is-in)"));
    if (nodes.length === 0) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [rootRef, dep]);
}

/**
 * Drives a looping, step-based demo. Advances `step` through `durations`
 * (ms per step) while `running`; wraps to 0 at the end. When `reduced`, it
 * parks on `staticStep` (the most informative frame) and never ticks.
 */
export function useStepLoop(
  durations: readonly number[],
  running: boolean,
  reduced: boolean,
  staticStep = durations.length - 1,
): number {
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  stepRef.current = step;

  useEffect(() => {
    if (reduced) {
      setStep(staticStep);
      return;
    }
    if (!running) return;
    const id = window.setTimeout(() => {
      setStep((s) => (s + 1) % durations.length);
    }, durations[stepRef.current] ?? 1000);
    return () => window.clearTimeout(id);
  }, [step, running, reduced, durations, staticStep]);

  return step;
}

/** Animated number that counts up once when it becomes visible. */
export function useCountUp(target: number, start: boolean, durationMs = 1600): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, start, durationMs]);
  return value;
}

export function faNum(n: number): string {
  return n.toLocaleString("fa-IR");
}

export function scrollToId(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

/** Deterministic pseudo-barcode bar widths (no randomness → identical SSR/CSR markup). */
export const BARCODE_PATTERN = [
  2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 1, 1, 3, 2, 1, 2, 1, 3, 1, 1, 2, 3, 1,
  2, 1, 1, 2, 1, 3, 1,
];
