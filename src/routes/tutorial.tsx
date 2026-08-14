import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { loadLandingContent, videoEmbedUrl, type LandingContent } from "@/lib/landing";
import { LoginPromoVideo } from "@/components/LoginPromoVideo";
import { ArrowRight, PlayCircle, GraduationCap } from "lucide-react";

export const Route = createFileRoute("/tutorial")({
  head: () => ({
    meta: [
      { title: "ویدیوی آموزشی | KAMIX" },
      { name: "description", content: "آموزش کامل کار با برنامه KAMIX — فاکتور، اسکن، ثبت صوتی و بیشتر." },
    ],
  }),
  component: TutorialPage,
});

function TutorialPageInner() {
  const [content, setContent] = useState<LandingContent | null>(null);

  useEffect(() => {
    let alive = true;
    loadLandingContent().then((c) => {
      if (alive) setContent(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const videos = (content?.media ?? []).filter((m) => m.type === "video");

  return (
    <Layout>
      {/* نوار برگشت — در اپ و وب یکسان */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition hover:opacity-90"
        >
          <ArrowRight className="h-4 w-4" />
          برگشت به حساب من
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold">ویدیوی آموزشی KAMIX</h1>
          <p className="text-xs text-muted-foreground">آموزش کامل کار با برنامه — گام‌به‌گام</p>
        </div>
      </div>

      {videos.length > 0 ? (
        <div className="space-y-4">
          {videos.map((m, i) => {
            const embed = videoEmbedUrl(m.url);
            return (
              <figure
                key={i}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
              >
                <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-4 py-2 text-xs font-semibold text-primary">
                  <PlayCircle className="h-4 w-4" />
                  {m.caption || `ویدیوی آموزشی ${(i + 1).toLocaleString("fa-IR")}`}
                </div>
                {embed ? (
                  <iframe
                    src={embed}
                    title={m.caption || `ویدیوی آموزشی ${i + 1}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    loading="lazy"
                    className="aspect-video w-full border-0 bg-black"
                  />
                ) : (
                  <video
                    src={m.url}
                    poster={m.coverUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="aspect-video w-full bg-black object-contain"
                  />
                )}
              </figure>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            ویدیوی کوتاه معرفی برنامه — همه‌ی امکانات اصلی در چند دقیقه:
          </p>
          <LoginPromoVideo className="mx-auto" />
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4 text-center">
        <p className="mb-3 text-sm text-muted-foreground">
          آماده‌اید؟ برگردید به فاکتور و اولین فروش را ثبت کنید.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground"
        >
          <ArrowRight className="h-4 w-4" />
          برگشت به حساب من
        </Link>
      </div>
    </Layout>
  );
}

function TutorialPage() {
  return (
    <AuthGuard>
      <TutorialPageInner />
    </AuthGuard>
  );
}
