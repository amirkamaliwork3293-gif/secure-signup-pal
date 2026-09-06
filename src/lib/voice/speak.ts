/**
 * پخش گفتار با فایل صوتی (نه speechSynthesis).
 *
 * موتور خواندن دستگاه در سایت و اپ کامیکس کار نمی‌کند؛ اینجا متن روی سرور
 * به MP3 تبدیل می‌شود و با Audio پخش می‌گردد — همان مسیری که مرورگر برای
 * هر فایل صوتی دیگر اجازه می‌دهد.
 */
import { jalaliToTimestamp, toJalali } from "@/lib/store";

const SPOKEN_KEY = "acc.dueAlerts.spoken.v1";
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

type QueueItem = { key: string; text: string };

const audioCache = new Map<string, string>();
const startedKeys = new Set<string>();
let queue: QueueItem[] = [];
let running = false;
let generation = 0;
let currentAudio: HTMLAudioElement | null = null;
let unlocked = false;
let pendingStart: (() => void) | null = null;
let unlockInstalled = false;

function endOfTehranToday(): number {
  const j = toJalali(Date.now());
  if (!j) return Date.now() + 86_400_000;
  return jalaliToTimestamp(j.jy, j.jm, j.jd, 23, 59) + 59_999;
}

function readSpoken(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SPOKEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const now = Date.now();
    const fresh: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v > now) fresh[k] = v;
    }
    return fresh;
  } catch {
    return {};
  }
}

function writeSpoken(map: Record<string, number>) {
  try {
    localStorage.setItem(SPOKEN_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function wasSpokenToday(key: string): boolean {
  const map = readSpoken();
  return typeof map[key] === "number" && map[key]! > Date.now();
}

export function markSpokenToday(key: string) {
  const map = readSpoken();
  map[key] = endOfTehranToday();
  writeSpoken(map);
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isAutoplayBlock(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "");
  const name = String((err as { name?: string })?.name ?? "");
  return /notallowed|not-allowed|interact|gesture|user.?agent/i.test(`${name} ${msg}`);
}

/** اولین لمس/کلید، قفل پخش خودکار مرورگر را باز می‌کند تا یادآوری بدون دکمه اضافه شنیده شود. */
export function installSpeechUnlock() {
  if (typeof window === "undefined" || unlockInstalled) return;
  unlockInstalled = true;
  const onGesture = () => {
    const a = new Audio(SILENT_WAV);
    a.volume = 0.01;
    void a
      .play()
      .then(() => {
        unlocked = true;
        window.removeEventListener("pointerdown", onGesture, true);
        window.removeEventListener("keydown", onGesture, true);
        const run = pendingStart;
        pendingStart = null;
        run?.();
      })
      .catch(() => {
        /* هنوز قفل است؛ ژست بعدی دوباره تلاش می‌کند */
      });
  };
  window.addEventListener("pointerdown", onGesture, { capture: true });
  window.addEventListener("keydown", onGesture, { capture: true });
}

export function stopSpeaking() {
  generation += 1;
  queue = [];
  running = false;
  pendingStart = null;
  try {
    currentAudio?.pause();
  } catch {
    /* ignore */
  }
  currentAudio = null;
}

async function fetchAudioUrl(text: string): Promise<string> {
  const cached = audioCache.get(text);
  if (cached) return cached;
  const { synthesizeSpeech } = await import("./tts.functions");
  const res = await synthesizeSpeech({ data: { text } });
  if (!res.ok) throw new Error(res.error);
  const bytes = base64ToBytes(res.audioBase64);
  const blob = new Blob([bytes as BlobPart], { type: res.mime || "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  audioCache.set(text, url);
  return url;
}

function playUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      currentAudio?.pause();
    } catch {
      /* ignore */
    }
    const a = new Audio(url);
    currentAudio = a;
    a.onended = () => {
      if (currentAudio === a) currentAudio = null;
      resolve();
    };
    a.onerror = () => {
      if (currentAudio === a) currentAudio = null;
      reject(new Error("پخش صدا ناموفق بود."));
    };
    void a.play().then(() => {
      unlocked = true;
    }).catch((err) => {
      if (currentAudio === a) currentAudio = null;
      reject(err);
    });
  });
}

async function runQueue() {
  if (running) return;
  const my = generation;
  running = true;
  try {
    while (queue.length > 0) {
      if (my !== generation) return;
      const item = queue.shift();
      if (!item) break;
      try {
        const url = await fetchAudioUrl(item.text);
        if (my !== generation) return;
        await playUrl(url);
        if (my !== generation) return;
        if (item.key) markSpokenToday(item.key);
      } catch (err) {
        if (my !== generation) return;
        if (isAutoplayBlock(err)) {
          queue.unshift(item);
          pendingStart = () => {
            void runQueue();
          };
          return;
        }
        console.warn("[speak]", err);
      }
    }
  } finally {
    if (my === generation) running = false;
  }
}

/** پخش یک جمله — برای دکمه «بشنو» و دستیار. همیشه تلاش می‌کند، حتی اگر امروز خوانده شده باشد. */
export async function speakText(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  stopSpeaking();
  queue = [{ key: "", text: trimmed.slice(0, 500) }];
  await runQueue();
}

/**
 * صف یادآوری‌ها: هر کلید روزی یک‌بار. اگر پخش خودکار قفل باشد، با اولین لمس ادامه می‌دهد.
 */
export function speakDueAlerts(items: QueueItem[]) {
  installSpeechUnlock();
  const next: QueueItem[] = [];
  for (const item of items) {
    const text = item.text.trim().slice(0, 500);
    if (!text) continue;
    if (!item.key) continue;
    if (wasSpokenToday(item.key) || startedKeys.has(item.key)) continue;
    startedKeys.add(item.key);
    next.push({ key: item.key, text });
  }
  if (next.length === 0) return;
  queue.push(...next);
  if (!unlocked) {
    pendingStart = () => {
      void runQueue();
    };
    void runQueue();
    return;
  }
  void runQueue();
}
