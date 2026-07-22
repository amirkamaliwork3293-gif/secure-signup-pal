/**
 * ویرایشگر صفحه‌ی معرفی (Landing) در پنل ادمین.
 * مدیر می‌تواند عنوان، توضیحات، ویژگی‌ها و ویدیو/عکس‌های صفحه‌ی معرفی را تنظیم کند.
 * رسانه از طریق آپلود فایل (باکت landing-media) یا وارد کردن لینک اضافه می‌شود.
 */
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_LANDING,
  loadLandingContent,
  saveLandingContent,
  uploadLandingMedia,
  type LandingContent,
  type LandingMedia,
  type LandingStory,
} from "@/lib/landing";
import {
  Save, Loader2, Plus, Trash2, Upload, Film, Image as ImageIcon,
  Link as LinkIcon, CheckCircle2, AlertTriangle,
  Phone, Instagram, Send, MessageCircle, Mail, Sparkles,
} from "lucide-react";

const INPUT = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

export function LandingEditor() {
  const [content, setContent] = useState<LandingContent>(DEFAULT_LANDING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [newType, setNewType] = useState<"video" | "image">("video");
  const fileRef = useRef<HTMLInputElement>(null);
  const storyFileRef = useRef<HTMLInputElement>(null);
  const [storyUploading, setStoryUploading] = useState(false);

  useEffect(() => {
    loadLandingContent().then((c) => {
      setContent(c);
      setLoading(false);
    });
  }, []);

  const set = <K extends keyof LandingContent>(key: K, value: LandingContent[K]) =>
    setContent((c) => ({ ...c, [key]: value }));

  const setContact = (key: keyof NonNullable<LandingContent["contact"]>, value: string) =>
    setContent((c) => ({ ...c, contact: { ...(c.contact || {}), [key]: value } }));

  const addMedia = (m: LandingMedia) => set("media", [...content.media, m]);
  const removeMedia = (i: number) => set("media", content.media.filter((_, idx) => idx !== i));

  // ── Video cover (poster) images ──────────────────────────────────────────
  const setMediaCover = (i: number, coverUrl: string | undefined) => {
    const arr = [...content.media];
    arr[i] = { ...arr[i], coverUrl };
    set("media", arr);
  };
  const [coverUploadingIndex, setCoverUploadingIndex] = useState<number | null>(null);
  const onPickCoverFile = async (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCoverUploadingIndex(i);
    setMsg(null);
    try {
      const url = await uploadLandingMedia(file);
      setMediaCover(i, url);
      setMsg({ type: "ok", text: "کاور ویدیو تنظیم شد. برای اعمال، «ذخیره» را بزنید." });
    } catch {
      setMsg({ type: "err", text: "آپلود کاور ناموفق بود." });
    }
    setCoverUploadingIndex(null);
  };

  // ── Stories ────────────────────────────────────────────────────────────
  const addStory = (s: LandingStory) => set("stories", [...(content.stories || []), s]);
  const updateStory = (i: number, patch: Partial<LandingStory>) => {
    const arr = [...(content.stories || [])];
    arr[i] = { ...arr[i], ...patch };
    set("stories", arr);
  };
  const removeStory = (i: number) =>
    set("stories", (content.stories || []).filter((_, idx) => idx !== i));

  const onPickStoryFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image"));
    e.target.value = "";
    if (files.length === 0) return;
    setStoryUploading(true);
    setMsg(null);
    const added: LandingStory[] = [];
    let failed = 0;
    for (const file of files) {
      try {
        const url = await uploadLandingMedia(file);
        added.push({ image_url: url, caption: "" });
      } catch { failed++; }
    }
    if (added.length > 0) {
      setContent((c) => ({ ...c, stories: [...(c.stories || []), ...added] }));
    }
    setMsg(
      failed === 0
        ? { type: "ok", text: `${added.length} استوری اضافه شد. برای اعمال، «ذخیره» را بزنید.` }
        : { type: "err", text: `${added.length} استوری اضافه شد، ${failed} فایل ناموفق بود.` },
    );
    setStoryUploading(false);
  };

  const addUrlMedia = () => {
    const url = newUrl.trim();
    if (!url) return;
    addMedia({ type: newType, url });
    setNewUrl("");
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setMsg(null);
    setUploadProgress({ done: 0, total: files.length });
    const uploaded: LandingMedia[] = [];
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const url = await uploadLandingMedia(file);
        uploaded.push({ type: file.type.startsWith("video") ? "video" : "image", url });
      } catch {
        failed++;
      }
      setUploadProgress({ done: i + 1, total: files.length });
    }
    if (uploaded.length > 0) {
      setContent((c) => ({ ...c, media: [...c.media, ...uploaded] }));
    }
    if (failed === 0) {
      setMsg({ type: "ok", text: `${uploaded.length} فایل آپلود شد. برای اعمال، «ذخیره» را بزنید.` });
    } else if (uploaded.length > 0) {
      setMsg({ type: "err", text: `${uploaded.length} فایل آپلود شد، ${failed} فایل ناموفق بود.` });
    } else {
      setMsg({
        type: "err",
        text: "آپلود ناموفق بود. اگر باکت landing-media ساخته نشده، فایل SQL راه‌اندازی را اجرا کنید یا لینک رسانه را دستی وارد کنید.",
      });
    }
    setUploading(false);
    setUploadProgress(null);
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await uploadFiles(files);
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []).filter(
      (f) => f.type.startsWith("video") || f.type.startsWith("image"),
    );
    await uploadFiles(files);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await saveLandingContent(content);
      setMsg({ type: "ok", text: "صفحه‌ی معرفی با موفقیت ذخیره شد." });
    } catch (err: any) {
      setMsg({
        type: "err",
        text:
          "ذخیره ناموفق بود. لطفاً فایل KAMIX_LANDING_SETUP.sql را یک‌بار در Supabase اجرا کنید تا جدول محتوا ساخته شود.",
      });
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-xs leading-6 text-muted-foreground">
        این محتوا فقط در نسخه‌ی وب (مرورگر) به بازدیدکنندگان نمایش داده می‌شود و در
        اپلیکیشن اندروید (وب‌ویو) دیده نمی‌شود.
      </div>

      {/* Texts */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <Field label="عنوان اصلی (Headline)">
          <input
            value={content.headline}
            onChange={(e) => set("headline", e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label="زیرعنوان">
          <input
            value={content.subheadline}
            onChange={(e) => set("subheadline", e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label="توضیحات">
          <textarea
            value={content.description}
            onChange={(e) => set("description", e.target.value)}
            rows={4}
            className={`${INPUT} resize-y`}
          />
        </Field>
      </div>

      {/* Stories bar — Instagram-style horizontal reel on the landing page */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-bold">
              <Sparkles className="h-4 w-4 text-primary" />
              استوری‌ها (نوار عکس بالای سایت)
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              دایره‌های افقی شبیه اینستاگرام در بالای صفحه‌ی معرفی. برای هر عکس می‌توانید یک کپشن کوتاه بنویسید.
            </div>
          </div>
          <button
            type="button"
            onClick={() => storyFileRef.current?.click()}
            disabled={storyUploading}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {storyUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            افزودن استوری
          </button>
          <input
            ref={storyFileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPickStoryFiles}
            className="hidden"
          />
        </div>

        {(content.stories || []).length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            هنوز استوری‌ای اضافه نشده است.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(content.stories || []).map((s, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-border bg-background">
                <img src={s.image_url} alt="" className="aspect-square w-full object-cover" />
                <div className="space-y-2 p-2">
                  <input
                    value={s.caption || ""}
                    onChange={(e) => updateStory(i, { caption: e.target.value })}
                    placeholder="کپشن (اختیاری)"
                    className={`${INPUT} py-1.5 text-xs`}
                  />
                  <button
                    type="button"
                    onClick={() => removeStory(i)}
                    className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Media */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold">ویدیوهای معرفی برنامه</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              فقط ویدیوها در بخش «معرفی برنامه» نمایش داده می‌شوند. عکس‌ها را در بخش «استوری‌ها» بالای این کارت اضافه کنید.
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            آپلود فایل
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*,image/*"
            multiple
            onChange={onPickFile}
            className="hidden"
          />
        </div>

        {/* Drag-and-drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition ${
            dragOver
              ? "border-primary bg-primary/10"
              : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5"
          } ${uploading ? "pointer-events-none opacity-60" : ""}`}
        >
          {uploading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <div className="text-xs font-semibold text-primary">
                در حال آپلود{uploadProgress ? ` (${uploadProgress.done}/${uploadProgress.total})` : ""}...
              </div>
            </>
          ) : (
            <>
              <Upload className="h-6 w-6 text-primary" />
              <div className="text-sm font-bold text-foreground">
                فایل ویدیو یا عکس را اینجا رها کنید
              </div>
              <div className="text-[11px] text-muted-foreground">
                یا برای انتخاب کلیک کنید — چند فایل هم‌زمان پشتیبانی می‌شود
              </div>
            </>
          )}
        </div>

        {/* Add by URL */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-2">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as "video" | "image")}
            className="rounded-lg border border-input bg-background px-2 py-2 text-xs"
          >
            <option value="video">ویدیو</option>
            <option value="image">عکس</option>
          </select>
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="لینک ویدیو/عکس (https://...)"
            dir="ltr"
            className={`${INPUT} flex-1 min-w-[180px]`}
          />
          <button
            type="button"
            onClick={addUrlMedia}
            className="flex items-center gap-1.5 rounded-xl border border-primary/40 px-3 py-2 text-xs font-semibold text-primary"
          >
            <LinkIcon className="h-4 w-4" />
            افزودن لینک
          </button>
        </div>

        {content.media.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            هنوز رسانه‌ای اضافه نشده است.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {content.media.map((m, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-border bg-background">
                {m.type === "video" ? (
                  <video
                    src={m.url}
                    poster={m.coverUrl}
                    muted
                    playsInline
                    controls
                    className="aspect-video w-full bg-black object-cover"
                  />
                ) : (
                  <img src={m.url} alt="" className="aspect-video w-full object-cover" />
                )}
                <div className="flex items-center justify-between gap-2 p-2">
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {m.type === "video" ? <Film className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                    {m.type === "video" ? "ویدیو" : "عکس"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMedia(i)}
                    className="grid h-7 w-7 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* کاور ویدیو — تصویری که قبل از پخش نمایش داده می‌شود تا کاربر بداند محتوای ویدیو چیست */}
                {m.type === "video" && (
                  <div className="flex items-center gap-2 border-t border-border p-2">
                    {m.coverUrl ? (
                      <img src={m.coverUrl} alt="کاور" className="h-10 w-16 rounded-md object-cover" />
                    ) : (
                      <div className="grid h-10 w-16 place-items-center rounded-md border border-dashed border-border text-[9px] text-muted-foreground">
                        بدون کاور
                      </div>
                    )}
                    <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-primary/40 px-2 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/5">
                      {coverUploadingIndex === i ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5" />
                      )}
                      {m.coverUrl ? "تغییر کاور" : "افزودن کاور"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => onPickCoverFile(i, e)}
                      />
                    </label>
                    {m.coverUrl && (
                      <button
                        type="button"
                        onClick={() => setMediaCover(i, undefined)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                        title="حذف کاور"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contact / Socials */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="text-sm font-bold">راه‌های ارتباطی و شبکه‌های اجتماعی</div>
        <p className="text-[11px] text-muted-foreground">
          این موارد در انتهای صفحه‌ی معرفی به‌صورت دکمه‌های قابل کلیک نمایش داده می‌شوند.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ContactField icon={Phone} label="شماره تلفن" dir="ltr" placeholder="09121234567"
            value={content.contact?.phone || ""}
            onChange={(v) => setContact("phone", v)} />
          <ContactField icon={MessageCircle} label="واتساپ (شماره)" dir="ltr" placeholder="989121234567"
            value={content.contact?.whatsapp || ""}
            onChange={(v) => setContact("whatsapp", v)} />
          <ContactField icon={Instagram} label="اینستاگرام" dir="ltr" placeholder="@kamix یا لینک کامل"
            value={content.contact?.instagram || ""}
            onChange={(v) => setContact("instagram", v)} />
          <ContactField icon={Send} label="تلگرام" dir="ltr" placeholder="@kamix یا لینک کامل"
            value={content.contact?.telegram || ""}
            onChange={(v) => setContact("telegram", v)} />
          <ContactField icon={Mail} label="ایمیل" dir="ltr" placeholder="info@kamix.app"
            value={content.contact?.email || ""}
            onChange={(v) => setContact("email", v)} />
        </div>
      </div>

      {/* Features */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold">ویژگی‌ها</div>
          <button
            type="button"
            onClick={() => set("features", [...content.features, { title: "", description: "" }])}
            className="flex items-center gap-1.5 rounded-xl border border-primary/40 px-3 py-2 text-xs font-semibold text-primary"
          >
            <Plus className="h-4 w-4" />
            افزودن ویژگی
          </button>
        </div>
        {content.features.map((f, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border bg-background p-3">
            <div className="flex items-center gap-2">
              <input
                value={f.title}
                onChange={(e) => {
                  const features = [...content.features];
                  features[i] = { ...features[i], title: e.target.value };
                  set("features", features);
                }}
                placeholder="عنوان ویژگی"
                className={`${INPUT} flex-1`}
              />
              <button
                type="button"
                onClick={() => set("features", content.features.filter((_, idx) => idx !== i))}
                className="grid h-9 w-9 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={f.description}
              onChange={(e) => {
                const features = [...content.features];
                features[i] = { ...features[i], description: e.target.value };
                set("features", features);
              }}
              placeholder="توضیح کوتاه"
              rows={2}
              className={`${INPUT} resize-y`}
            />
          </div>
        ))}
      </div>

      {msg && (
        <div
          className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs ${
            msg.type === "ok"
              ? "bg-primary/10 text-primary"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {msg.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {msg.text}
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        ذخیره‌ی صفحه‌ی معرفی
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ContactField({
  icon: Icon,
  label,
  value,
  onChange,
  placeholder,
  dir,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        dir={dir}
        className={INPUT}
      />
    </label>
  );
}
