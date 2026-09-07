#!/usr/bin/env python3
"""
ساخت ارائهٔ فارسی کامیکس برای هیئت داوری پارک علم و فناوری کرمان.

اسلایدها به‌صورت تصویر ۱۶:۹ با فونت استعداد و وزیرمتن رندر می‌شوند تا
فارسی روی هر سیستم درست و زیبا دیده شود. سپس داخل فایل پاورپوینت قرار می‌گیرند.
"""

from __future__ import annotations

import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pptx import Presentation
from pptx.util import Emu, Inches, Pt
from pptx.oxml.ns import qn
from lxml import etree

ROOT = Path(__file__).resolve().parent
FONTS = ROOT / "fonts"
SLIDES_DIR = ROOT / "slides"
ASSETS_ICON = Path("/workspace/public/icon-512.png")
ASSETS_OG = Path("/workspace/public/og-image.png")
OUT_PPTX = ROOT / "کامیکس-ارائه-پارک-علم-فناوری-کرمان.pptx"
OUT_PPTX_EN = ROOT / "KAMIX-Kerman-STP-Pitch.pptx"

W, H = 1920, 1080

# هویت بصری کامیکس
NAVY = (8, 18, 42)
NAVY_DEEP = (5, 11, 28)
CARD = (18, 36, 74)
CARD2 = (24, 48, 96)
BLUE = (79, 140, 255)
BLUE_SOFT = (164, 196, 255)
GOLD = (240, 196, 74)
GOLD_DIM = (201, 156, 42)
CREAM = (250, 246, 236)
MUTED = (168, 186, 214)
WHITE = (255, 255, 255)
TEAL = (86, 230, 198)
ROSE = (255, 138, 128)
LINE = (255, 255, 255, 38)


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


class Fonts:
    def __init__(self) -> None:
        self.display_xl = load_font("Estedad-FD-Black.ttf", 92)
        self.display = load_font("Estedad-FD-ExtraBold.ttf", 64)
        self.display_sm = load_font("Estedad-FD-ExtraBold.ttf", 48)
        self.title = load_font("Estedad-FD-Bold.ttf", 42)
        self.title_sm = load_font("Estedad-FD-Bold.ttf", 34)
        self.sub = load_font("Estedad-FD-SemiBold.ttf", 28)
        self.body = load_font("Vazirmatn-FD-Regular.ttf", 26)
        self.body_b = load_font("Vazirmatn-FD-Bold.ttf", 26)
        self.body_sm = load_font("Vazirmatn-FD-Regular.ttf", 22)
        self.body_sm_b = load_font("Vazirmatn-FD-Bold.ttf", 22)
        self.caption = load_font("Vazirmatn-FD-Medium.ttf", 18)
        self.tiny = load_font("Vazirmatn-FD-Medium.ttf", 16)
        self.num = load_font("Estedad-FD-Black.ttf", 72)
        self.num_sm = load_font("Estedad-FD-ExtraBold.ttf", 44)
        self.chip = load_font("Estedad-FD-Bold.ttf", 20)
        self.en = load_font("Estedad-FD-Bold.ttf", 22)


def lerp(a: tuple, b: tuple, t: float) -> tuple[int, int, int]:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def make_background() -> Image.Image:
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        row = lerp(NAVY_DEEP, (12, 32, 72), t)
        for x in range(W):
            # vignette + subtle blue wash from top-left
            tx = x / (W - 1)
            glow = max(0.0, 1.0 - math.hypot(tx - 0.12, t - 0.08) * 1.35)
            gold_glow = max(0.0, 1.0 - math.hypot(tx - 0.92, t - 0.18) * 1.8)
            c = list(row)
            c[2] = min(255, int(c[2] + 55 * glow))
            c[0] = min(255, int(c[0] + 28 * glow))
            c[1] = min(255, int(c[1] + 18 * glow))
            c[0] = min(255, int(c[0] + 38 * gold_glow))
            c[1] = min(255, int(c[1] + 22 * gold_glow))
            px[x, y] = tuple(c)
    # soft orbs
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse((1180, -220, 1980, 560), fill=(79, 140, 255, 28))
    od.ellipse((-260, 720, 520, 1280), fill=(240, 196, 74, 18))
    od.ellipse((1480, 780, 2100, 1220), fill=(86, 230, 198, 16))
    img = Image.alpha_composite(img.convert("RGBA"), overlay.filter(ImageFilter.GaussianBlur(48)))
    return img


def rounded_rect(draw: ImageDraw.ImageDraw, box, r, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


class Slide:
    def __init__(self, fonts: Fonts, bg: Image.Image, index: int, total: int) -> None:
        self.f = fonts
        self.im = bg.copy()
        self.d = ImageDraw.Draw(self.im, "RGBA")
        self.index = index
        self.total = total

    def text(
        self,
        xy,
        text: str,
        font,
        fill=CREAM,
        anchor="ra",
        max_width: int | None = None,
        leading: float = 1.45,
        ltr: bool = False,
    ) -> float:
        """Draw text. Persian is RTL via raqm; English can be ltr=True."""
        x, y = xy
        direction = "ltr" if ltr else "rtl"
        lang = "en" if ltr else "fa"
        lines = self.wrap(text, font, max_width, ltr=ltr) if max_width else [text]
        line_h = int(font.size * leading)
        for i, line in enumerate(lines):
            self.d.text(
                (x, y + i * line_h),
                line,
                font=font,
                fill=fill,
                anchor=anchor,
                language=lang,
                direction=direction,
            )
        return y + (len(lines) - 1) * line_h + font.size

    def wrap(self, text: str, font, max_width: int, ltr: bool = False) -> list[str]:
        paragraphs = text.split("\n")
        out: list[str] = []
        direction = "ltr" if ltr else "rtl"
        lang = "en" if ltr else "fa"
        for para in paragraphs:
            words = para.split(" ")
            cur = ""
            for w in words:
                test = (cur + " " + w).strip()
                if self.d.textlength(test, font=font, language=lang, direction=direction) <= max_width:
                    cur = test
                else:
                    if cur:
                        out.append(cur)
                    cur = w
            if cur:
                out.append(cur)
        return out or [""]

    def measure(self, text: str, font, ltr: bool = False) -> float:
        direction = "ltr" if ltr else "rtl"
        lang = "en" if ltr else "fa"
        return self.d.textlength(text, font=font, language=lang, direction=direction)

    def footer(self, page_label: str = "") -> None:
        self.d.rectangle((0, H - 8, W, H), fill=GOLD)
        self.d.text((80, H - 28), "kamixapp.ir", font=self.f.tiny, fill=MUTED, anchor="lm", language="en", direction="ltr")
        num = f"{self.index:02d}  /  {self.total:02d}"
        self.d.text(
            (W - 80, H - 28),
            num,
            font=self.f.tiny,
            fill=MUTED,
            anchor="rm",
            language="en",
            direction="ltr",
        )
        if page_label:
            self.d.text(
                (W // 2, H - 28),
                page_label,
                font=self.f.tiny,
                fill=GOLD,
                anchor="mm",
                language="fa",
                direction="rtl",
            )

    def eyebrow(self, text: str, y: int = 56) -> None:
        # gold diamond + label
        cx, cy = W - 86, y + 10
        self.d.polygon([(cx, cy - 7), (cx + 7, cy), (cx, cy + 7), (cx - 7, cy)], fill=GOLD)
        self.text((W - 108, y), text, self.f.chip, GOLD, anchor="ra")

    def gold_rule(self, y: int, right: int | None = None, w: int = 120) -> None:
        r = W - 80 if right is None else right
        self.d.rectangle((r - w, y, r, y + 4), fill=GOLD)

    def card(self, box, radius=28, fill=(255, 255, 255, 16), outline=(255, 255, 255, 42), width=1):
        rounded_rect(self.d, box, radius, fill=fill, outline=outline, width=width)

    def gold_ribbon(self, label: str) -> None:
        """نوار طلایی نوآوری روی لبه راست — کاملاً به‌چشم."""
        self.d.rectangle((W - 22, 0, W, H), fill=GOLD)
        # vertical label drawn as stacked? use rotated overlay
        ribbon = Image.new("RGBA", (H, 48), (0, 0, 0, 0))
        rd = ImageDraw.Draw(ribbon)
        rd.rectangle((0, 0, H, 48), fill=(240, 196, 74, 255))
        rd.text(
            (H // 2, 24),
            label,
            font=self.f.chip,
            fill=NAVY_DEEP,
            anchor="mm",
            language="fa",
            direction="rtl",
        )
        rotated = ribbon.rotate(90, expand=True)
        # paste on left of gold bar
        self.im.paste(rotated, (W - 70, 0), rotated)
        self.d = ImageDraw.Draw(self.im, "RGBA")


def paste_round_icon(slide: Slide, path: Path, xy, size=92, radius=22):
    if not path.exists():
        return
    icon = Image.open(path).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    icon.putalpha(mask)
    slide.im.paste(icon, xy, icon)
    slide.d = ImageDraw.Draw(slide.im, "RGBA")


def draw_mic(d, cx, cy, color=GOLD, s=1.0):
    r = int(18 * s)
    d.rounded_rectangle((cx - int(10 * s), cy - int(22 * s), cx + int(10 * s), cy + int(8 * s)), 10, outline=color, width=3)
    d.arc((cx - r, cy - int(8 * s), cx + r, cy + int(22 * s)), 0, 180, fill=color, width=3)
    d.line((cx, cy + int(22 * s), cx, cy + int(34 * s)), fill=color, width=3)
    d.line((cx - int(12 * s), cy + int(34 * s), cx + int(12 * s), cy + int(34 * s)), fill=color, width=3)


def draw_cam(d, cx, cy, color=GOLD, s=1.0):
    d.rounded_rectangle((cx - int(26 * s), cy - int(16 * s), cx + int(26 * s), cy + int(18 * s)), 8, outline=color, width=3)
    d.ellipse((cx - int(10 * s), cy - int(10 * s), cx + int(10 * s), cy + int(10 * s)), outline=color, width=3)
    d.rectangle((cx + int(10 * s), cy - int(22 * s), cx + int(20 * s), cy - int(16 * s)), fill=color)


def draw_spark(d, cx, cy, color=GOLD, s=1.0):
    pts = []
    for i in range(8):
        ang = math.radians(i * 45)
        rad = (16 if i % 2 == 0 else 7) * s
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    d.polygon(pts, fill=color)


# ─── slides ───────────────────────────────────────────────────────────────────

NOTES: dict[int, str] = {}


def s01_cover(sl: Slide) -> None:
    paste_round_icon(sl, ASSETS_ICON, (W - 172, 48), 72, 18)
    sl.eyebrow("ارائه به هیئت داوری پارک علم و فناوری کرمان")
    sl.text((W - 80, 150), "کامیکس", sl.f.display_xl, WHITE, anchor="ra")
    sl.text((W - 80, 250), "KAMIX", sl.f.title, BLUE_SOFT, anchor="ra", ltr=True)
    sl.gold_rule(318, w=220)
    sl.text(
        (W - 80, 360),
        "فاکتور را ننویسید. فقط بگویید.",
        sl.f.display,
        GOLD,
        anchor="ra",
        max_width=980,
    )
    sl.text(
        (W - 80, 470),
        "حسابداری هوشمند موبایل برای واقعیت مغازه ایرانی؛ نه یک دفتر دیجیتال ساده، بلکه صندوقی که با صدا، دوربین گوشی و دستیار هوشمند کار می‌کند.",
        sl.f.body,
        MUTED,
        anchor="ra",
        max_width=900,
        leading=1.7,
    )

    chips = ["فاکتور با صدا", "اسکن با دوربین موبایل", "دستیار هوشمند"]
    x = W - 80
    y = 790
    for c in chips:
        tw = sl.measure(c, sl.f.chip) + 56
        sl.card((x - tw, y, x, y + 56), 28, fill=(240, 196, 74, 235), outline=GOLD, width=1)
        sl.text((x - 28, y + 28), c, sl.f.chip, NAVY_DEEP, anchor="rm")
        x -= tw + 14

    sl.card((80, 170, 820, 820), 36, fill=(255, 255, 255, 14), outline=(255, 255, 255, 36))
    if ASSETS_OG.exists():
        og = Image.open(ASSETS_OG).convert("RGBA")
        # crop center-right phone-ish
        og = og.resize((740, 416), Image.Resampling.LANCZOS)
        mask = Image.new("L", og.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, *og.size), 24, fill=255)
        og.putalpha(mask)
        sl.im.paste(og, (110, 210), og)
        sl.d = ImageDraw.Draw(sl.im, "RGBA")

    sl.text((450, 680), "ساده  ·  سریع  ·  هوشمند", sl.f.sub, CREAM, anchor="mm")
    sl.text((450, 740), "محصول زنده؛ در حال استفاده در بازار واقعی", sl.f.body_sm, MUTED, anchor="mm")
    sl.text((450, 790), "شهریور ۱۴۰۵", sl.f.caption, GOLD, anchor="mm")
    sl.footer("جلد")
    NOTES[sl.index] = (
        "سلام و احترام خدمت هیئت داوری پارک علم و فناوری کرمان. "
        "کامیکس حسابداری موبایل است، اما نقطهٔ تمایز ما دفتر دیجیتال نیست؛ "
        "ثبت فاکتور با صدا، اسکن بارکد با دوربین گوشی، و دستیار هوشمند فارسی است. "
        "در ادامه نشان می‌دهیم این نوآوری امروز در بازار جواب گرفته است."
    )


def s02_agenda(sl: Slide) -> None:
    sl.eyebrow("نقشهٔ جلسه")
    sl.text((W - 80, 110), "آنچه امروز بررسی می‌کنید", sl.f.display_sm, WHITE, anchor="ra")
    sl.gold_rule(180, w=160)
    items = [
        ("۰۱", "مسئله", "چرا حسابداری سنتی برای مغازهٔ ایرانی گران، کند و پراشتباه است."),
        ("۰۲", "نوآوری", "سه قابلیت اصلی که کامیکس را از یک حسابداری ساده جدا می‌کند."),
        ("۰۳", "اثر", "صرفه‌جویی وقت و هزینه برای صاحب کسب‌وکار و راحتی برای مشتری."),
        ("۰۴", "نتیجه", "۱۲ هزار همراه در اینستاگرام، هزار کاربر فعال، و درآمد واقعی."),
        ("۰۵", "درخواست", "آنچه برای جهش بعدی از پارک علم و فناوری کرمان می‌خواهیم."),
    ]
    y = 230
    for num, title, desc in items:
        sl.card((80, y, W - 80, y + 130), 24)
        sl.d.rounded_rectangle((W - 200, y + 30, W - 110, y + 100), 18, fill=GOLD)
        sl.text((W - 155, y + 65), num, sl.f.title_sm, NAVY_DEEP, anchor="mm")
        sl.text((W - 230, y + 44), title, sl.f.title_sm, WHITE, anchor="ra")
        sl.text((W - 230, y + 92), desc, sl.f.body_sm, MUTED, anchor="ra", max_width=1280)
        y += 148
    sl.footer("دستور جلسه")
    NOTES[sl.index] = "جلسه را در پنج بخش کوتاه جلو می‌بریم: مسئله، نوآوری، اثر اقتصادی و اجتماعی، نتایج بازار، و درخواست حمایت."


def s03_problem(sl: Slide) -> None:
    sl.eyebrow("صورت‌مسئله")
    sl.text((W - 80, 100), "مغازه هنوز با دفتر و دستگاه می‌چرخد", sl.f.display_sm, WHITE, anchor="ra")
    sl.gold_rule(172, w=160)
    sl.text(
        (W - 80, 200),
        "صاحب کسب‌وکار ایرانی باید هم‌زمان بفروشد، حساب نگه دارد و مشتری را معطل نکند. ابزارهای موجود یا گران‌اند، یا پیچیده، یا به کامپیوتر رومیزی وابسته‌اند.",
        sl.f.body,
        MUTED,
        anchor="ra",
        max_width=1760,
        leading=1.65,
    )
    problems = [
        ("صف طولانی", "فاکتور دستی چند دقیقه طول می‌کشد؛ مشتری منتظر می‌ماند و فروش از دست می‌رود."),
        ("سخت‌افزار گران", "بارکدخوان و صندوق فروشگاهی چند میلیون تومان هزینه دارد و برای مغازهٔ کوچک نمی‌صرفد."),
        ("دفتر گم‌شونده", "بدهی مشتری، چک و هزینه روی کاغذ ثبت می‌شود؛ عددها فراموش و اختلاف درست می‌شود."),
        ("سود نامعلوم", "آخر ماه معلوم نیست کدام کالا سود ساخته و کدام فقط جا اشغال کرده است."),
    ]
    coords = [(80, 360, 930, 660), (990, 360, 1840, 660), (80, 690, 930, 990), (990, 690, 1840, 990)]
    for (x1, y1, x2, y2), (t, d) in zip(coords, problems):
        sl.card((x1, y1, x2, y2), 26, fill=(255, 80, 80, 22), outline=(255, 160, 150, 70))
        sl.d.ellipse((x2 - 78, y1 + 28, x2 - 38, y1 + 68), outline=ROSE, width=3)
        sl.text((x2 - 96, y1 + 36), t, sl.f.title_sm, CREAM, anchor="ra")
        sl.text((x2 - 40, y1 + 110), d, sl.f.body_sm, MUTED, anchor="ra", max_width=x2 - x1 - 80, leading=1.6)
    sl.footer("مسئله")
    NOTES[sl.index] = (
        "مسئله را ملموس بگویید: مغازه‌دار باید بفروشد، نه اینکه پشت کامپیوتر حسابداری یاد بگیرد. "
        "دستگاه بارکدخوان برای خیلی‌ها گران است و دفتر کاغذی بدهی را گم می‌کند."
    )


def s04_answer(sl: Slide) -> None:
    sl.eyebrow("پاسخ ما")
    sl.text((W - 80, 120), "کامیکس صندوق هوشمند جیبی است", sl.f.display_sm, WHITE, anchor="ra")
    sl.gold_rule(192, w=180)
    sl.text(
        (W - 80, 230),
        "ما حسابداری را از کاغذ و دستگاه، به صدا و دوربین موبایل آوردیم.",
        sl.f.title,
        GOLD,
        anchor="ra",
        max_width=1760,
    )
    sl.text(
        (W - 80, 310),
        "کامیکس یک نرم‌افزار پیچیدهٔ رومیزی نیست. همان گوشی مغازه کافی است تا فاکتور ثبت شود، بارکد خوانده شود، بدهی معلوم باشد و سود روز دیده شود.",
        sl.f.body,
        MUTED,
        anchor="ra",
        max_width=1760,
        leading=1.65,
    )
    pillars = [
        ("گوشی به‌جای صندوق", "بدون خرید رایانه و بارکدخوان؛ کار از روی موبایل و تبلت انجام می‌شود."),
        ("فارسیِ واقعی", "گفتار فارسی، تاریخ شمسی، تومان، چک صیادی و بانک‌های ایران."),
        ("ابر + اپ اندروید", "داده روی ابر می‌ماند؛ نسخهٔ وب و اپ اندروید هم‌زمان در دسترس است."),
        ("چند صنف، یک برنامه", "پوشاک، کافه، سوپر، طلا، آموزش و کارگاه؛ هر کدام ابزار خود را دارند."),
    ]
    y = 470
    x = 80
    for i, (t, d) in enumerate(pillars):
        sl.card((x, y, x + 420, y + 430), 28)
        sl.d.rounded_rectangle((x + 330, y + 28, x + 390, y + 88), 16, fill=GOLD)
        sl.text((x + 360, y + 58), f"{i+1:02d}", sl.f.sub, NAVY_DEEP, anchor="mm")
        sl.text((x + 390, y + 130), t, sl.f.title_sm, WHITE, anchor="ra", max_width=340)
        sl.text((x + 390, y + 220), d, sl.f.body_sm, MUTED, anchor="ra", max_width=340, leading=1.6)
        x += 455
    sl.footer("راه‌حل")
    NOTES[sl.index] = (
        "جملهٔ کلیدی را آرام بگویید: ما حسابداری را از کاغذ و دستگاه به صدا و دوربین موبایل آوردیم. "
        "تأکید کنید کامیکس مخصوص واقعیت مغازه ایرانی است؛ نه کپی نرم‌افزار خارجی."
    )


def s05_three(sl: Slide) -> None:
    sl.gold_ribbon("سه قابلیت اصلی · نوآوری کامیکس")
    sl.eyebrow("قلب محصول")
    sl.text((W - 96, 100), "این سه کار، کامیکس را حسابداری ساده نمی‌گذارد", sl.f.display_sm, WHITE, anchor="ra", max_width=1500)
    sl.gold_rule(188, w=200)
    cards = [
        (draw_mic, "فاکتور با صدا", "در چند ثانیه", "بگویید چه فروختید؛ فاکتور نوشته می‌شود. بدون تایپ، بدون فرم طولانی."),
        (draw_cam, "اسکن با دوربین", "بدون دستگاه", "بارکد و کیوآر را همان گوشی می‌خواند. هزینهٔ اسکنر حذف می‌شود."),
        (draw_spark, "دستیار هوشمند", "یک جمله کافی است", "بدهی، هزینه، قیمت، یادآوری و گزارش سود؛ همه با گفتار فارسی."),
    ]
    x = 70
    for i, (icon, title, punch, desc) in enumerate(cards):
        sl.card((x, 250, x + 560, 980), 32, fill=(255, 255, 255, 14), outline=GOLD, width=3)
        sl.d.ellipse((x + 230, 300, x + 330, 400), outline=GOLD, width=3)
        icon(sl.d, x + 280, 350, GOLD, 1.15)
        sl.text((x + 280, 440), f"{i+1:02d}", sl.f.caption, GOLD, anchor="mm")
        sl.text((x + 280, 505), title, sl.f.title, WHITE, anchor="mm")
        sl.text((x + 280, 590), punch, sl.f.display_sm, GOLD, anchor="mm")
        sl.text((x + 280, 700), desc, sl.f.body, MUTED, anchor="mm", max_width=460, leading=1.7)
        x += 590
    sl.footer("نوآوری")
    NOTES[sl.index] = (
        "این اسلاید را نگه دارید. سه پیام باید در ذهن داور بماند: "
        "فاکتور با صدا در چند ثانیه؛ اسکنر لازم نیست؛ دستیار هوشمند با یک جمله کار می‌کند. "
        "بگویید این‌ها تزئین محصول نیستند؛ ستون محصول‌اند."
    )


def s06_voice(sl: Slide) -> None:
    sl.gold_ribbon("قابلیت اصلی ۱ · فاکتور با صدا")
    sl.eyebrow("نوآوری اول")
    sl.text((W - 96, 90), "فاکتور، در چند ثانیه، فقط با صدا", sl.f.display_sm, WHITE, anchor="ra", max_width=1400)
    sl.gold_rule(172, w=180)
    sl.text(
        (W - 96, 210),
        "صاحب فروشگاه همان‌طور که با مشتری حرف می‌زند، فروش را ثبت می‌کند. آموزش پیچیده لازم نیست.",
        sl.f.body,
        MUTED,
        anchor="ra",
        max_width=1100,
        leading=1.6,
    )

    # speech bubble
    sl.card((980, 360, 1840, 560), 28, fill=(79, 140, 255, 36), outline=BLUE)
    draw_mic(sl.d, 1760, 430, GOLD, 1.0)
    sl.text((1700, 410), "صاحب مغازه می‌گوید:", sl.f.caption, BLUE_SOFT, anchor="ra")
    sl.text((1700, 460), "«دو تا پیراهن، دویست و پنجاه هزار تومان»", sl.f.sub, WHITE, anchor="ra", max_width=680)

    sl.card((980, 600, 1840, 980), 28)
    sl.text((1760, 640), "کامیکس می‌نویسد", sl.f.caption, GOLD, anchor="ra")
    sl.d.line((1020, 700, 1800, 700), fill=LINE, width=1)
    sl.text((1760, 740), "کالا: پیراهن مردانه", sl.f.body_b, WHITE, anchor="ra")
    sl.text((1760, 800), "تعداد: ۲", sl.f.body, MUTED, anchor="ra")
    sl.text((1760, 860), "مبلغ: ۲۵۰٬۰۰۰ تومان", sl.f.body_b, TEAL, anchor="ra")
    sl.text((1760, 930), "زمان ثبت: چند ثانیه — نه چند دقیقه", sl.f.sub, GOLD, anchor="ra")

    points = [
        "درک گفتار فارسی؛ عدد و نام کالا را از جمله جدا می‌کند.",
        "اگر چند کالای شبیه هم باشد، همان‌جا انتخاب می‌کنید.",
        "نام مشتری را هم می‌توان با صدا روی فاکتور گذاشت.",
        "در وب و اپ اندروید یکسان کار می‌کند.",
    ]
    y = 360
    for p in points:
        sl.card((80, y, 930, y + 130), 22)
        sl.d.ellipse((850, y + 48, 882, y + 80), fill=GOLD)
        sl.text((830, y + 64), p, sl.f.body_sm, CREAM, anchor="rm", max_width=720, leading=1.5)
        y += 150
    sl.footer("فاکتور با صدا")
    NOTES[sl.index] = (
        "اینجا یک مثال زنده بگویید. اگر اینترنت بود، همان لحظه در اپ نشان دهید. "
        "جملهٔ نمونه: دو تا پیراهن دویست و پنجاه هزار تومان. تأکید: چند ثانیه، نه چند دقیقه."
    )


def s07_camera(sl: Slide) -> None:
    sl.gold_ribbon("قابلیت اصلی ۲ · دوربین به‌جای اسکنر")
    sl.eyebrow("نوآوری دوم")
    sl.text((W - 96, 90), "اسکنر نخرید؛ دوربین گوشی کافی است", sl.f.display_sm, WHITE, anchor="ra", max_width=1450)
    sl.gold_rule(172, w=180)
    sl.text(
        (W - 96, 210),
        "بارکد و کیوآر کالا با دوربین همان موبایلی خوانده می‌شود که همیشه در جیب فروشنده است. دستگاه جدا، کابل و هزینهٔ اضافه حذف شده است.",
        sl.f.body,
        MUTED,
        anchor="ra",
        max_width=1760,
        leading=1.6,
    )

    # comparison
    sl.card((80, 380, 920, 980), 28, fill=(255, 80, 80, 18), outline=(255, 150, 140, 70))
    sl.text((500, 430), "روش قدیمی", sl.f.title, ROSE, anchor="mm")
    olds = ["خرید بارکدخوان چندمیلیونی", "وابستگی به رایانهٔ صندوق", "اگر دستگاه خراب شود، فروش می‌خوابد", "آموزش کارمند روی سخت‌افزار خاص"]
    y = 520
    for o in olds:
        sl.text((860, y), "✕   " + o, sl.f.body, MUTED, anchor="ra", max_width=720)
        y += 90

    sl.card((1000, 380, 1840, 980), 28, fill=(86, 230, 198, 18), outline=TEAL, width=2)
    sl.text((1420, 430), "با کامیکس", sl.f.title, TEAL, anchor="mm")
    news = [
        "اسکن بارکد و QR با دوربین موبایل",
        "چاپ بارکد اختصاصی برای کالای بدون بارکد",
        "افزودن آنی کالا به فاکتور با یک اسکن",
        "هشدار موجودی کم، همان لحظهٔ فروش",
    ]
    y = 520
    for n in news:
        sl.text((1780, y), "✓   " + n, sl.f.body, CREAM, anchor="ra", max_width=720)
        y += 90
    sl.footer("اسکن با دوربین")
    NOTES[sl.index] = (
        "این اسلاید برای داورانی است که innovativeness می‌خواهند ببینند. "
        "بگویید ما سخت‌افزار را حذف کرده‌ایم؛ همان دوربین گوشی کار دستگاه چندمیلیونی را می‌کند. "
        "برای پوشاک و سوپر، چاپ بارکد اختصاصی هم هست."
    )


def s08_assistant(sl: Slide) -> None:
    sl.gold_ribbon("قابلیت اصلی ۳ · دستیار هوشمند")
    sl.eyebrow("نوآوری سوم")
    sl.text((W - 96, 90), "یک جمله بگویید؛ کار انجام می‌شود", sl.f.display_sm, WHITE, anchor="ra", max_width=1450)
    sl.gold_rule(172, w=180)
    sl.text(
        (W - 96, 205),
        "دستیار هوشمند کامیکس روی همهٔ صفحات همراه فروشنده است. بدهی، هزینه، قیمت کالا، یادآوری و حتی گزارش سود را با گفتار فارسی می‌فهمد — بدون تایپ و بدون وابستگی دائمی به اینترنت.",
        sl.f.body,
        MUTED,
        anchor="ra",
        max_width=1760,
        leading=1.6,
    )
    pairs = [
        ("«آقای رضایی دویست هزار تومان بدهکار است»", "بدهی مشتری ثبت می‌شود"),
        ("«ماهانه چهل و پنج میلیون هزینه اجاره»", "هزینهٔ تکرارشونده ذخیره می‌شود"),
        ("«پرسودترین کالای من چیست؟»", "گزارش سود، همان لحظه"),
        ("«امروز چقدر سود داشتم؟»", "خلاصهٔ عملکرد امروز"),
        ("«یادآوری پرداخت، فردا ساعت سیزده»", "هشدار سر وقت"),
        ("«تیشرت مشکی، قیمت چهل و پنج هزار»", "قیمت کالا ویرایش می‌شود"),
    ]
    y = 360
    col = 0
    for said, did in pairs:
        x1 = 80 if col == 0 else 1000
        x2 = 920 if col == 0 else 1840
        sl.card((x1, y, x2, y + 170), 22)
        sl.text((x2 - 36, y + 36), said, sl.f.body_sm_b, GOLD, anchor="ra", max_width=760)
        sl.text((x2 - 36, y + 100), did, sl.f.body_sm, CREAM, anchor="ra", max_width=760)
        if col == 1:
            y += 190
            col = 0
        else:
            col = 1
    sl.footer("دستیار هوشمند")
    NOTES[sl.index] = (
        "دو یا سه مثال را با صدای خودتان بگویید تا حس محصول منتقل شود. "
        "نکتهٔ فنی را ساده بگویید: درک زبان فارسی روی دستگاه انجام می‌شود و برای دستورهای روزمره به اینترنت وابسته نیست."
    )


def s09_features(sl: Slide) -> None:
    sl.eyebrow("اکوسیستم محصول")
    sl.text((W - 80, 90), "بقیهٔ کامیکس؛ یک مغازهٔ کامل در یک اپ", sl.f.display_sm, WHITE, anchor="ra", max_width=1600)
    sl.gold_rule(172, w=160)
    feats = [
        ("فاکتور و تاریخچه", "فروش، تخفیف، پیش‌نمایش و بایگانی مرتب."),
        ("انبار هوشمند", "موجودی، هشدار کمبود، ورود کالا از اکسل."),
        ("مشتریان و بدهکاران", "ماندهٔ هر نفر، طلب و بدهی، پیگیری آسان."),
        ("گزارش سود", "روزانه، ماهانه و سالانه به تقویم شمسی."),
        ("منوی دیجیتال کافه", "کیوآر روی میز؛ قیمت همان لحظه به‌روز می‌شود."),
        ("طلا و جواهر", "نرخ لحظه‌ای، وزن، اجرت، سود و مالیات."),
        ("هنرجو و شهریه", "کلاس و باشگاه؛ اقساط و یادآوری پرداخت."),
        ("تولید و فرمول", "مواد اولیه با هر فروش از انبار کم می‌شود."),
        ("چک و بانک ایرانی", "چک صیادی، سررسید و بانک‌های کشور."),
        ("طراح فاکتور", "چیدمان دلخواه، لوگو، مهر و خروجی پی‌دی‌اف."),
        ("ارسال برای مشتری", "واتساپ، پیامک و اشتراک‌گذاری فاکتور."),
        ("پشتیبان ابری", "داده روی گوشی نمی‌ماند و از بین نمی‌رود."),
    ]
    gap, cw, ch = 18, 430, 175
    for i, (t, d) in enumerate(feats):
        r, c = divmod(i, 4)
        x1 = 80 + c * (cw + gap)
        y1 = 220 + r * (ch + gap)
        sl.card((x1, y1, x1 + cw, y1 + ch), 20)
        sl.d.rectangle((x1 + cw - 18, y1 + 24, x1 + cw - 8, y1 + 92), fill=GOLD)
        sl.text((x1 + cw - 32, y1 + 28), t, sl.f.body_b, GOLD, anchor="ra", max_width=360)
        sl.text((x1 + cw - 32, y1 + 78), d, sl.f.caption, MUTED, anchor="ra", max_width=360, leading=1.5)
    sl.footer("امکانات")
    NOTES[sl.index] = (
        "این اسلاید را سریع مرور کنید تا معلوم شود محصول کامل است؛ "
        "اما دوباره برگردید روی سه قابلیت اصلی. طلافروشی، کافه، آموزش و تولید را نام ببرید تا وسعت بازار مشخص شود."
    )


def s10_segments(sl: Slide) -> None:
    sl.eyebrow("بازار هدف")
    sl.text((W - 80, 100), "برای کسی که هر روز می‌فروشد", sl.f.display_sm, WHITE, anchor="ra")
    sl.gold_rule(172, w=160)
    segs = [
        ("پوشاک و بوتیک", "سایز و رنگ جدا، بارکد روی لباس، صندوق با دوربین."),
        ("کافه و رستوران", "منوی کیوآر، فاکتور میز، کنترل مواد."),
        ("سوپر و خواربار", "هزاران کالا، بدهکار محله، اسکن سریع."),
        ("طلا و جواهر", "نرخ روز، وزن و اجرت؛ خطای محاسبه کمتر."),
        ("آموزش و باشگاه", "شهریه، قسط و پیام یادآوری به هنرجو."),
        ("کارگاه و تولید", "فرمول ساخت و کسر مواد از انبار."),
        ("موبایل و دیجیتال", "سریال، گارانتی و سود هر مدل."),
        ("آرایشی و خرده‌فروشی", "برند زیاد، مشتری ثابت، فاکتور حرفه‌ای."),
    ]
    for i, (t, d) in enumerate(segs):
        r, c = divmod(i, 4)
        x1 = 80 + c * 455
        y1 = 240 + r * 360
        sl.card((x1, y1, x1 + 435, y1 + 320), 26)
        sl.text((x1 + 400, y1 + 40), f"{i+1:02d}", sl.f.caption, GOLD, anchor="ra")
        sl.text((x1 + 400, y1 + 90), t, sl.f.title_sm, WHITE, anchor="ra", max_width=360)
        sl.text((x1 + 400, y1 + 170), d, sl.f.body_sm, MUTED, anchor="ra", max_width=360, leading=1.6)
    sl.footer("مخاطب")
    NOTES[sl.index] = (
        "بگویید محصول برای یک صنف خاص ساخته نشده؛ از بوتیک کرمان تا کافه و طلافروشی، "
        "هرکدام بدون سخت‌افزار گران وارد حسابداری دیجیتال می‌شوند."
    )


def s11_savings(sl: Slide) -> None:
    sl.eyebrow("اثر اقتصادی")
    sl.text((W - 80, 90), "وقت و هزینه؛ دو چیزی که مغازه کم دارد", sl.f.display_sm, WHITE, anchor="ra", max_width=1600)
    sl.gold_rule(172, w=160)

    big = [
        ("چند ثانیه", "به‌جای چند دقیقه", "صدور هر فاکتور با صدا یا اسکن دوربین."),
        ("صفر تومان", "هزینهٔ اسکنر", "بارکدخوان چندمیلیونی از سبد خرید حذف می‌شود."),
        ("یک گوشی", "به‌جای صندوق کامل", "رایانه، کشو و دستگاه جدا لازم نیست."),
    ]
    x = 80
    for a, b, c in big:
        sl.card((x, 220, x + 580, 520), 28, fill=(240, 196, 74, 20), outline=GOLD, width=2)
        sl.text((x + 290, 280), a, sl.f.num_sm, GOLD, anchor="mm")
        sl.text((x + 290, 360), b, sl.f.title_sm, WHITE, anchor="mm")
        sl.text((x + 290, 430), c, sl.f.body_sm, MUTED, anchor="mm", max_width=500)
        x += 610

    rows = [
        ("زمان صندوق", "نوشتن دستی فاکتور در ساعت شلوغی", "ثبت صوتی یا اسکن؛ صف کوتاه‌تر می‌شود"),
        ("سرمایهٔ اولیه", "خرید سخت‌افزار فروشگاهی", "شروع با همان موبایل موجود"),
        ("خطای انسانی", "غلط نوشتن مبلغ و موجودی", "عدد از صدا و بارکد می‌آید؛ اختلاف کمتر"),
        ("هزینهٔ چاپ منو", "منوی کاغذی کافه که زود کهنه می‌شود", "منوی دیجیتال با کیوآر؛ قیمت همان لحظه"),
        ("وصول مطالبات", "بدهی در دفتر گم می‌شود", "لیست بدهکاران همیشه جلوِ چشم"),
        ("تصمیم خرید", "سفارش بعدی با حدس", "گزارش پرفروش و سود واقعی"),
    ]
    y = 560
    sl.card((80, y, 1840, 1000), 24)
    sl.text((1780, y + 28), "موضوع", sl.f.caption, GOLD, anchor="ra")
    sl.text((1280, y + 28), "قبل از کامیکس", sl.f.caption, ROSE, anchor="ra")
    sl.text((720, y + 28), "با کامیکس", sl.f.caption, TEAL, anchor="ra")
    sl.d.line((110, y + 64, 1810, y + 64), fill=LINE, width=1)
    yy = y + 96
    for left, old, new in rows:
        sl.text((1780, yy), left, sl.f.body_sm_b, WHITE, anchor="ra")
        sl.text((1280, yy), old, sl.f.caption, MUTED, anchor="ra", max_width=480)
        sl.text((720, yy), new, sl.f.caption, CREAM, anchor="ra", max_width=520)
        yy += 54
    sl.footer("صرفه‌جویی")
    NOTES[sl.index] = (
        "عدد را اغراق نکنید. بگویید در یک روز شلوغ اگر ۵۰ فاکتور باشد، "
        "حتی یک دقیقه صرفه‌جویی در هر فاکتور یعنی نزدیک به یک ساعت وقت آزاد برای فروشنده و انتظار کمتر برای مشتری. "
        "هزینهٔ بارکدخوان و صندوق را به‌عنوان سرمایهٔ قفل‌شده مقایسه کنید با اشتراک ماهانه."
    )


def s12_people(sl: Slide) -> None:
    sl.eyebrow("اثر اجتماعی")
    sl.text((W - 80, 100), "کمک به مردم؛ نه فقط به نرم‌افزار", sl.f.display_sm, WHITE, anchor="ra")
    sl.gold_rule(172, w=160)
    items = [
        ("مشتری کمتر معطل می‌شود", "فاکتور سریع یعنی صف کوتاه‌تر و احترام بیشتر به وقت مردم."),
        ("حساب مردم شفاف می‌ماند", "بدهی و طلب روی کاغذ گم نمی‌شود؛ اختلاف و سوءتفاهم کم می‌شود."),
        ("فاکتور به دست مشتری می‌رسد", "پی‌دی‌اف خوانا روی واتساپ؛ خرید قابل پیگیری است."),
        ("مغازهٔ کوچک هم دیجیتال می‌شود", "بدون وام سخت‌افزار، کسب‌وکار شهرستان وارد دنیای حساب‌وکتاب دقیق می‌شود."),
        ("زنان و جوانان کارآفرین", "ابزار ساده است؛ نیاز به حسابدار تمام‌وقت برای ثبت روزانه کمتر می‌شود."),
        ("اقتصاد محلی کرمان", "هر فروشگاه منظم‌تر، اشتغال پایدارتر و مالیات و گردش مالی شفاف‌تر."),
    ]
    for i, (t, d) in enumerate(items):
        r, c = divmod(i, 3)
        x1 = 80 + c * 610
        y1 = 240 + r * 370
        sl.card((x1, y1, x1 + 580, y1 + 330), 26)
        sl.d.ellipse((x1 + 500, y1 + 36, x1 + 548, y1 + 84), outline=GOLD, width=2)
        sl.text((x1 + 524, y1 + 60), f"{i+1}", sl.f.body_b, GOLD, anchor="mm")
        sl.text((x1 + 480, y1 + 50), t, sl.f.title_sm, WHITE, anchor="ra", max_width=420)
        sl.text((x1 + 540, y1 + 150), d, sl.f.body, MUTED, anchor="ra", max_width=500, leading=1.65)
    sl.footer("مردم")
    NOTES[sl.index] = (
        "پارک‌های علم و فناوری به اثر اجتماعی حساس‌اند. "
        "بگویید کامیکس فقط سود استارتاپ نیست؛ وقت مشتری، شفافیت بدهی در محله، "
        "و ورود مغازه‌های کوچک استان به ابزار دیجیتال بدون سرمایهٔ سنگین است."
    )


def s13_traction(sl: Slide) -> None:
    sl.eyebrow("عملکرد تا امروز")
    sl.text((W - 80, 90), "بازار جواب داده است؛ این دیگر طرح روی کاغذ نیست", sl.f.display_sm, WHITE, anchor="ra", max_width=1700)
    sl.gold_rule(178, w=180)

    stats = [
        ("۱۲٬۰۰۰", "فالوور اینستاگرام", "جامعه‌ای که محصول را می‌بیند، می‌پرسد و معرفی می‌کند."),
        ("۱٬۰۰۰", "کاربر فعال در سایت", "کسب‌وکارهایی که امروز با کامیکس می‌فروشند و حساب نگه می‌دارند."),
        ("اشتراک", "درآمد واقعی", "مسیر درآمد از پلن ماهانه تا سالانه؛ مشتری حاضر است بپردازد."),
    ]
    x = 80
    for n, t, d in stats:
        sl.card((x, 230, x + 580, 620), 30, fill=(79, 140, 255, 28), outline=BLUE, width=2)
        sl.text((x + 290, 320), n, sl.f.num, GOLD, anchor="mm")
        sl.text((x + 290, 420), t, sl.f.title_sm, WHITE, anchor="mm")
        sl.text((x + 290, 500), d, sl.f.body_sm, MUTED, anchor="mm", max_width=500, leading=1.55)
        x += 610

    sl.card((80, 660, 1840, 1000), 26)
    sl.text((1760, 710), "خوانش درست این عددها", sl.f.title_sm, GOLD, anchor="ra")
    sl.text(
        (1760, 780),
        "۱۲ هزار همراه یعنی پیام محصول شنیده شده است. هزار کاربر فعال یعنی محصول در صندوق واقعی مغازه نشسته است. درآمد اشتراک یعنی ارزش آن‌قدر هست که کسب‌وکار برایش پول بدهد — نه فقط تعریف کند.",
        sl.f.body,
        CREAM,
        anchor="ra",
        max_width=1680,
        leading=1.7,
    )
    sl.footer("نتایج")
    NOTES[sl.index] = (
        "این اسلاید اعتماد می‌سازد. با افتخار بگویید محصول زنده است. "
        "اغراق نکنید: ۱۲ هزار فالوور، هزار کاربر فعال، و رسیدن به درآمد خوب از اشتراک. "
        "اگر پرسیدند جزئیات مالی، بگویید مدل اشتراک است و عدد دقیق را در جلسهٔ محرمانه می‌گویید."
    )


def s14_tech(sl: Slide) -> None:
    sl.eyebrow("چرا قابل دفاع است")
    sl.text((W - 80, 100), "نوآوری فنی؛ به زبان ساده", sl.f.display_sm, WHITE, anchor="ra")
    sl.gold_rule(172, w=160)
    blocks = [
        ("درک گفتار فارسی", "موتور فهم جمله، تعداد، قیمت و نام کالا را از حرف روزمره جدا می‌کند؛ مخصوص لهجه و عدد فارسی."),
        ("بینایی موبایل", "خواندن بارکد و کیوآر با دوربین؛ بدون اسکنر صنعتی."),
        ("دستیار چندکاره", "یک لایهٔ فرمان صوتی روی کل برنامه: بدهی، هزینه، انبار، یادآوری، گزارش."),
        ("حسابداری ایرانی", "تقویم شمسی، تومان، چک صیادی، بانک‌های ایران، فاکتور قابل چاپ."),
        ("کار بدون قطعی کامل", "بخشی از کار حتی در ضعف شبکه می‌ماند؛ پشتیبان ابری مانع از بین رفتن دفتر می‌شود."),
        ("وب + اپ اندروید", "نصب سبک؛ همان گوشی مغازه کافی است و نیاز به سیستم ویندوزی گران نیست."),
    ]
    for i, (t, d) in enumerate(blocks):
        r, c = divmod(i, 3)
        x1 = 80 + c * 610
        y1 = 230 + r * 370
        sl.card((x1, y1, x1 + 580, y1 + 340), 26)
        sl.text((x1 + 540, y1 + 40), t, sl.f.title_sm, GOLD, anchor="ra", max_width=500)
        sl.text((x1 + 540, y1 + 130), d, sl.f.body, MUTED, anchor="ra", max_width=500, leading=1.65)
    sl.footer("فناوری")
    NOTES[sl.index] = (
        "داور فنی ممکن است بپرسد هوش مصنوعی کجاست. بگویید نوآوری ما مدل زبانی نمایشی نیست؛ "
        "درک عملی گفتار فارسی برای کار روزانهٔ مغازه است که امروز کار می‌کند. "
        "اسکن دوربین و لایهٔ دستیار، محصول را از نرم‌افزارهای حسابداری کلاسیک جدا می‌کند."
    )


def s15_model(sl: Slide) -> None:
    sl.eyebrow("پایداری")
    sl.text((W - 80, 100), "مدل درآمد روشن؛ مناسب رشد پارکی", sl.f.display_sm, WHITE, anchor="ra")
    sl.gold_rule(172, w=160)
    sl.text(
        (W - 80, 210),
        "کامیکس با اشتراک کار می‌کند. کسب‌وکار کوچک می‌تواند ماهانه شروع کند و وقتی ارزش را دید، سالانه بماند.",
        sl.f.body,
        MUTED,
        anchor="ra",
        max_width=1760,
        leading=1.6,
    )
    plans = [
        ("۱ ماهه", "ورود آسان", "برای امتحان واقعی در صندوق مغازه"),
        ("۳ ماهه", "تعهد کوتاه", "مناسب فصل فروش"),
        ("۶ ماهه", "صرفه‌جویی بیشتر", "کسب‌وکار پایدار"),
        ("۱۲ ماهه", "همراهی سالانه", "کمترین دغدغهٔ تمدید"),
    ]
    x = 80
    for t, s, d in plans:
        sl.card((x, 360, x + 420, 720), 26)
        sl.text((x + 210, 420), t, sl.f.title, GOLD, anchor="mm")
        sl.text((x + 210, 500), s, sl.f.sub, WHITE, anchor="mm")
        sl.text((x + 210, 580), d, sl.f.body_sm, MUTED, anchor="mm", max_width=340)
        x += 455

    sl.card((80, 760, 1840, 1000), 24, fill=(240, 196, 74, 22), outline=GOLD)
    sl.text(
        (1760, 820),
        "نکته برای داوری: قیمت برای مغازهٔ ایرانی در دسترس است؛ درآمد از تعداد کسب‌وکارهای فعال می‌آید، نه از فروش سخت‌افزار. مقیاس‌پذیر است و به واردات دستگاه وابسته نیست.",
        sl.f.body,
        CREAM,
        anchor="ra",
        max_width=1680,
        leading=1.65,
    )
    sl.footer("مدل درآمد")
    NOTES[sl.index] = (
        "مدل را ساده بگویید: SaaS اشتراکی. سرمایهٔ مشتری روی گوشی خودش است. "
        "ما دستگاه نمی‌فروشیم؛ نرم‌افزار می‌فروشیم. این یعنی حاشیهٔ مقیاس بهتر و وابستگی کمتر به واردات."
    )


def s16_ask(sl: Slide) -> None:
    sl.eyebrow("درخواست از پارک")
    sl.text((W - 80, 90), "ما شروع کرده‌ایم؛ برای جهش به همراهی شما نیاز داریم", sl.f.display_sm, WHITE, anchor="ra", max_width=1700)
    sl.gold_rule(178, w=180)
    sl.text(
        (W - 80, 210),
        "درخواست ما بودجه برای ساختن از صفر نیست. درخواست ما شتاب، اعتبار و ظرفیت رشد برای محصولی است که بازار به آن جواب داده.",
        sl.f.body,
        MUTED,
        anchor="ra",
        max_width=1760,
        leading=1.6,
    )
    asks = [
        ("استقرار و اعتبار نهادی", "حضور در پارک علم و فناوری کرمان؛ اعتماد بیشتر برای مشتری و همکار تجاری."),
        ("شبکهٔ کسب‌وکار استان", "معرفی به اصناف، فروشگاه‌ها، شتاب‌دهنده‌ها و رویدادهای بازار."),
        ("خدمات رشد", "مشاورهٔ حقوقی، مالکیت فکری، مالی و توسعهٔ بازار."),
        ("ظرفیت جذب نیرو", "فضا و حمایت برای بزرگ‌کردن تیم فنی و پشتیبانی."),
        ("نمایش و اعتبار رسانه‌ای", "دیده شدن به‌عنوان محصول دانش‌بنیان بومی، نه یک اپ گمنام."),
        ("مسیر دانش‌بنیان", "همراهی برای تکمیل استانداردها، ارزیابی و ادامهٔ مسیر قانونی محصول."),
    ]
    for i, (t, d) in enumerate(asks):
        r, c = divmod(i, 3)
        x1 = 80 + c * 610
        y1 = 360 + r * 300
        sl.card((x1, y1, x1 + 580, y1 + 270), 24)
        sl.text((x1 + 40, y1 + 40), f"{i+1:02d}", sl.f.title, GOLD, anchor="la")
        sl.text((x1 + 540, y1 + 44), t, sl.f.body_b, WHITE, anchor="ra", max_width=400)
        sl.text((x1 + 540, y1 + 120), d, sl.f.body_sm, MUTED, anchor="ra", max_width=500, leading=1.55)
    sl.footer("درخواست")
    NOTES[sl.index] = (
        "درخواست را متواضع و مشخص بگویید. تأکید: ما محصول و مشتری داریم؛ "
        "پارک می‌تواند اعتبار، شبکه و خدمات رشد بدهد تا کامیکس در کرمان و سپس کشور بزرگ شود."
    )


def s17_thanks(sl: Slide) -> None:
    paste_round_icon(sl, ASSETS_ICON, (W // 2 - 56, 80), 112, 28)
    sl.text((W // 2, 230), "آمادهٔ بررسی و تجربهٔ زنده", sl.f.display_sm, WHITE, anchor="mm")
    sl.gold_rule(300, right=W // 2 + 90, w=180)
    sl.text(
        (W // 2, 340),
        "یک فاکتور را با صدا بگویید. یک بارکد را با دوربین بگیرید. یک جمله به دستیار بدهید.",
        sl.f.body,
        MUTED,
        anchor="mm",
        max_width=1400,
        leading=1.6,
    )
    sl.card((360, 480, 1560, 820), 32, fill=(240, 196, 74, 22), outline=GOLD, width=2)
    sl.text((W // 2, 560), "kamixapp.ir", sl.f.display, GOLD, anchor="mm", ltr=True)
    sl.text((W // 2, 650), "کامیکس  ·  KAMIX", sl.f.title, WHITE, anchor="mm")
    sl.text((W // 2, 720), "پارک علم و فناوری کرمان  ·  شهریور ۱۴۰۵", sl.f.body, MUTED, anchor="mm")
    sl.text((W // 2, 900), "سپاس از وقت و دقت هیئت داوری", sl.f.sub, CREAM, anchor="mm")
    sl.footer("پایان")
    NOTES[sl.index] = (
        "با دعوت به دمو تمام کنید. اگر ممکن است همان جلسه یک فاکتور صوتی ثبت کنید. "
        "سپاس را کوتاه بگویید و برای پرسش باز بمانید."
    )


BUILDERS = [
    s01_cover,
    s02_agenda,
    s03_problem,
    s04_answer,
    s05_three,
    s06_voice,
    s07_camera,
    s08_assistant,
    s09_features,
    s10_segments,
    s11_savings,
    s12_people,
    s13_traction,
    s14_tech,
    s15_model,
    s16_ask,
    s17_thanks,
]


def set_notes_rtl(slide, text: str) -> None:
    notes = slide.notes_slide
    tf = notes.notes_text_frame
    tf.text = text
    for p in tf.paragraphs:
        pPr = p._p.get_or_add_pPr()
        pPr.set("rtl", "1")
        pPr.set("algn", "r")
        for run in p.runs:
            run.font.size = Pt(16)
            run.font.name = "Vazirmatn"
            rPr = run._r.get_or_add_rPr()
            rPr.set("lang", "fa-IR")
            rFonts = rPr.find(qn("a:rFonts"))
            if rFonts is None:
                rFonts = etree.SubElement(rPr, qn("a:rFonts"))
            for attr in ("ascii", "hAnsi", "cs", "ea"):
                rFonts.set(attr, "Vazirmatn")


def build() -> None:
    SLIDES_DIR.mkdir(parents=True, exist_ok=True)
    fonts = Fonts()
    bg = make_background()
    total = len(BUILDERS)
    pngs: list[Path] = []
    for i, fn in enumerate(BUILDERS, start=1):
        sl = Slide(fonts, bg, i, total)
        fn(sl)
        path = SLIDES_DIR / f"slide-{i:02d}.png"
        sl.im.convert("RGB").save(path, "PNG", optimize=True)
        pngs.append(path)
        print(f"rendered {path.name}")

    prs = Presentation()
    prs.slide_width = Inches(13.333333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    for i, png in enumerate(pngs, start=1):
        slide = prs.slides.add_slide(blank)
        slide.shapes.add_picture(str(png), Emu(0), Emu(0), width=prs.slide_width, height=prs.slide_height)
        set_notes_rtl(slide, NOTES.get(i, ""))

    # presentation language hint
    prs.save(OUT_PPTX)
    shutil.copy2(OUT_PPTX, OUT_PPTX_EN)
    print(f"saved {OUT_PPTX}")
    print(f"saved {OUT_PPTX_EN}")


if __name__ == "__main__":
    build()
