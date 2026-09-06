/**
 * پخش گفتار یادآوری با یک عنصر Audio مشترک.
 *
 * علت بی‌صدایی قبلی: play() بعد از await شبکه بود و مرورگر/وب‌ویو قطعش می‌کرد؛
 * unlock هم روی Audio جداگانه‌ای بود. اینجا play() در همان لمس کاربر صدا می‌شود.
 */
import { jalaliToTimestamp, toJalali } from "@/lib/store";
import { synthesizeSpeech } from "@/lib/voice/tts.functions";

const SPOKEN_KEY = "acc.dueAlerts.spoken.v1";

type QueueItem = { key: string; text: string };

const blobCache = new Map<string, string>();
const playedKeys = new Set<string>();
let queue: QueueItem[] = [];
let player: HTMLAudioElement | null = null;
let heldUtterance: SpeechSynthesisUtterance | null = null;
let draining = false;
let endedBound = false;

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

function markSpokenToday(key: string) {
  if (!key) return;
  const map = readSpoken();
  map[key] = endOfTehranToday();
  writeSpoken(map);
}

function wasSpokenToday(key: string): boolean {
  const map = readSpoken();
  return typeof map[key] === "number" && map[key]! > Date.now();
}

function googleTtsUrl(text: string): string {
  return (
    "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=fa&q=" +
    encodeURIComponent(text.slice(0, 180))
  );
}

function getPlayer(): HTMLAudioElement {
  if (player) return player;
  const a = document.createElement("audio");
  a.setAttribute("playsinline", "true");
  a.setAttribute("webkit-playsinline", "true");
  a.preload = "auto";
  a.style.display = "none";
  document.body.appendChild(a);
  player = a;
  if (!endedBound) {
    endedBound = true;
    a.addEventListener("ended", () => {
      const done = queue.shift();
      if (done?.key) {
        playedKeys.add(done.key);
        markSpokenToday(done.key);
      }
      playNext(false);
    });
  }
  return a;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function prefetchServer(text: string): Promise<void> {
  if (blobCache.has(text)) return;
  try {
    const res = await synthesizeSpeech({ data: { text } });
    if (!res.ok) return;
    const bytes = base64ToBytes(res.audioBase64);
    const blob = new Blob([bytes as BlobPart], { type: res.mime || "audio/mpeg" });
    blobCache.set(text, URL.createObjectURL(blob));
  } catch {
    /* مسیر گوگل/دستگاه باقی است */
  }
}

function speakWithDevice(text: string): boolean {
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    heldUtterance = u;
    u.lang = "fa-IR";
    const voices = synth.getVoices?.() ?? [];
    const fa = voices.find((v) => /fa/i.test(v.lang) || /persian|farsi|فارسی/i.test(v.name));
    if (fa) u.voice = fa;
    u.rate = 0.95;
    u.onend = () => {
      const done = queue.shift();
      if (done?.key) {
        playedKeys.add(done.key);
        markSpokenToday(done.key);
      }
      playNext(false);
    };
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

function srcFor(text: string): string {
  return blobCache.get(text) || googleTtsUrl(text);
}

/** play() را بدون await قبلی صدا بزن — باید داخل ژست لمس باشد. */
function playNext(fromGesture: boolean) {
  const item = queue[0];
  if (!item) {
    draining = false;
    return;
  }
  draining = true;
  const a = getPlayer();
  const src = srcFor(item.text);
  try {
    a.pause();
  } catch {
    /* ignore */
  }
  a.src = src;
  const started = a.play();
  if (started && typeof started.catch === "function") {
    void started.catch(() => {
      if (fromGesture && speakWithDevice(item.text)) return;
      if (!fromGesture) {
        draining = false;
        return;
      }
      queue.shift();
      playNext(true);
    });
  }
}

/**
 * لمس پنجره‌ی سررسید / دکمه‌ی بشنو.
 * بلافاصله play() می‌شود تا مرورگر صدا را قطع نکند.
 */
export function kickDueSpeechPlayback() {
  if (typeof window === "undefined") return;
  const a = getPlayer();
  if (!a.paused && !a.ended && a.currentTime > 0) return;
  playNext(true);
}

export function installSpeechUnlock() {
  /* پخش با لمس پنجره انجام می‌شود؛ اینجا چیزی قفل نمی‌کنیم. */
}

export function stopSpeaking() {
  queue = [];
  draining = false;
  try {
    player?.pause();
  } catch {
    /* ignore */
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  heldUtterance = null;
}

export async function speakText(text: string): Promise<void> {
  const trimmed = text.trim().slice(0, 500);
  if (!trimmed) return;
  stopSpeaking();
  queue = [{ key: "", text: trimmed }];
  void prefetchServer(trimmed);
  playNext(true);
}

export function speakDueAlerts(items: QueueItem[]) {
  if (typeof window === "undefined") return;
  for (const item of items) {
    const text = item.text.trim().slice(0, 500);
    if (!text || !item.key) continue;
    if (wasSpokenToday(item.key) || playedKeys.has(item.key)) continue;
    if (queue.some((q) => q.key === item.key)) continue;
    queue.push({ key: item.key, text });
    void prefetchServer(text);
  }
  // تلاش اولیه؛ اگر مرورگر قطع کرد، لمس پنجره kickDueSpeechPlayback را می‌زند
  playNext(false);
}
