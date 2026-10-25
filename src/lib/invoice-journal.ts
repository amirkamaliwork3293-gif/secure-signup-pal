/**
 * نسخهٔ پشتیبان فاکتورهای ثبت‌شده روی همین گوشی (IndexedDB).
 *
 * جدا از حافظهٔ اصلی برنامه (localStorage) و جدا از منطق ادغام با سرور است: هر
 * فاکتوری که روی این دستگاه ثبت یا ویرایش شود این‌جا هم نوشته می‌شود و تا وقتی در
 * دادهٔ سرور دیده نشده «تأییدنشده» می‌ماند. اگر چنین فاکتوری بی‌آنکه کاربر حذفش
 * کرده باشد از فهرست فاکتورها غیب شود، store.ts آن را برمی‌گرداند (و دوباره
 * می‌فرستد). فاکتورهای تأییدشده بعد از ۳۰ روز از این نسخه پاک می‌شوند.
 *
 * هر خطای IndexedDB بی‌صدا نادیده گرفته می‌شود — این فقط یک تور ایمنی است.
 */

const DB_NAME = "kamix-journal";
const STORE = "invoices";
const CONFIRMED_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export type JournalEntry = {
  key: string;
  userId: string;
  id: string;
  row: unknown;
  savedAt: number;
  /** زمانی که این فاکتور در دادهٔ سرور دیده شد؛ تا آن موقع 0 */
  confirmedAt: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function keyOf(userId: string, id: string): string {
  return `${userId}:${id}`;
}

function rangeFor(userId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${userId}:`, `${userId}:￿`);
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** فاکتور ثبت/ویرایش‌شده روی این دستگاه (تأییدنشده تا دیده شدن روی سرور) */
export async function journalInvoice(userId: string, row: { id?: unknown }): Promise<void> {
  const id = typeof row?.id === "string" ? row.id : "";
  if (!userId || userId === "anon" || !id) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const entry: JournalEntry = {
      key: keyOf(userId, id),
      userId,
      id,
      row: JSON.parse(JSON.stringify(row)),
      savedAt: Date.now(),
      confirmedAt: 0,
    };
    tx.objectStore(STORE).put(entry);
    await done(tx);
  } catch {
    /* noop */
  }
}

/** کاربر خودش فاکتور را حذف کرد → از نسخهٔ پشتیبان هم برداشته شود */
export async function forgetJournalInvoice(userId: string, id: string): Promise<void> {
  if (!userId || !id) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(keyOf(userId, id));
    await done(tx);
  } catch {
    /* noop */
  }
}

export async function readJournal(userId: string): Promise<JournalEntry[]> {
  if (!userId) return [];
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll(rangeFor(userId));
    return await new Promise<JournalEntry[]>((resolve) => {
      req.onsuccess = () => resolve((req.result as JournalEntry[]) || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * شناسه‌هایی که روی سرور دیده شدند تأیید می‌شوند؛ تأییدشده‌های قدیمی پاک می‌شوند.
 */
export async function confirmJournal(
  userId: string,
  serverIds: ReadonlySet<string>,
): Promise<void> {
  const list = await readJournal(userId);
  if (list.length === 0) return;
  const db = await openDb();
  if (!db) return;
  const now = Date.now();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    for (const e of list) {
      if (e.confirmedAt && now - e.confirmedAt > CONFIRMED_KEEP_MS) {
        st.delete(e.key);
      } else if (!e.confirmedAt && serverIds.has(e.id)) {
        st.put({ ...e, confirmedAt: now });
      }
    }
    await done(tx);
  } catch {
    /* noop */
  }
}

/**
 * فاکتورهای تأییدنشدهٔ این دستگاه که در فهرست فعلی نیستند — یعنی گم شده‌اند و باید
 * برگردند. حذف عمدی کاربر روی همین دستگاه ردیف را از نسخهٔ پشتیبان برمی‌دارد
 * (forgetJournalInvoice)، و دستگاه دیگری نمی‌تواند فاکتوری را حذف کند که هنوز به
 * سرور نرسیده؛ پس هر ردیف تأییدنشدهٔ غایب، گم‌شده است نه حذف‌شده.
 */
export function missingFromHistory(
  journal: readonly JournalEntry[],
  historyIds: ReadonlySet<string>,
): JournalEntry[] {
  return journal.filter((e) => !e.confirmedAt && !historyIds.has(e.id) && e.row);
}
