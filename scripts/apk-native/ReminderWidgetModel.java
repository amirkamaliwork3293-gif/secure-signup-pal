package com.kamali.inventory;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;

/**
 * منطق خالص ویجت «یادآوری‌های امروز» — بدون هیچ وابستگی به اندروید تا بیرون از گوشی تست شود.
 * «امروز» مثل خود برنامه به وقت تهران حساب می‌شود.
 */
public final class ReminderWidgetModel {
    private ReminderWidgetModel() {
    }

    public static final String APP_TIME_ZONE = "Asia/Tehran";

    private static final String[] MONTHS = {
            "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
            "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
    };

    public static final class Item {
        public final String id;
        public final String title;
        public final String customer;
        public final long at;
        /** در برنامه «انجام شد» خورده است. */
        public final boolean done;

        public Item(String id, String title, String customer, long at) {
            this(id, title, customer, at, false);
        }

        public Item(String id, String title, String customer, long at, boolean done) {
            this.id = id == null ? "" : id;
            this.title = title == null ? "" : title;
            this.customer = customer == null ? "" : customer;
            this.at = at;
            this.done = done;
        }
    }

    public static final class Row {
        public final Item item;
        public final boolean overdue;
        /** انجام‌شده: تیک سبز و خط روی متن. */
        public final boolean done;
        public final String clock;

        Row(Item item, boolean overdue, boolean done, String clock) {
            this.item = item;
            this.overdue = overdue;
            this.done = done;
            this.clock = clock;
        }
    }

    public static final class View {
        /** همهٔ یادآوری‌های انجام‌نشدهٔ امروز. */
        public final int total;
        public final int overdueCount;
        /** یادآوری‌های انجام‌شدهٔ امروز (با خط‌خوردگی نشان داده می‌شوند). */
        public final int doneCount;
        /** ردیف‌هایی که جا می‌شوند: اول انجام‌نشده‌ها به ترتیب ساعت، بعد انجام‌شده‌ها. */
        public final List<Row> rows;
        /** تعداد باقی‌مانده برای «+N یادآوری دیگر». */
        public final int more;

        View(int total, int overdueCount, int doneCount, List<Row> rows, int more) {
            this.total = total;
            this.overdueCount = overdueCount;
            this.doneCount = doneCount;
            this.rows = rows;
            this.more = more;
        }
    }

    public static TimeZone appTimeZone() {
        TimeZone tz = TimeZone.getTimeZone(APP_TIME_ZONE);
        // اگر دیتای منطقهٔ زمانی روی دستگاه نباشد، getTimeZone همان GMT برمی‌گرداند.
        if (tz == null || !APP_TIME_ZONE.equals(tz.getID())) {
            tz = TimeZone.getTimeZone("GMT+03:30");
        }
        return tz;
    }

    public static long startOfDay(long now, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    public static long nextMidnight(long now, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(startOfDay(now, tz));
        c.add(Calendar.DAY_OF_MONTH, 1);
        return c.getTimeInMillis();
    }

    /**
     * ردیف‌های امروز. maxRows ردیف جا می‌شود؛ اگر همه جا نشوند، یک ردیف برای «+N» کنار گذاشته می‌شود.
     * doneKeys: یادآوری‌هایی که از ویجت/نوتیف تیک خورده‌اند ولی برنامه هنوز اعمالشان نکرده.
     */
    public static View build(List<Item> items, Set<String> doneKeys, long now, TimeZone tz, int maxRows) {
        long start = startOfDay(now, tz);
        long end = nextMidnight(now, tz);
        List<Item> open = new ArrayList<>();
        List<Item> done = new ArrayList<>();
        if (items != null) {
            for (Item item : items) {
                if (item == null || item.id.isEmpty()) continue;
                if (item.at < start || item.at >= end) continue;
                boolean isDone = item.done || (doneKeys != null && doneKeys.contains(doneKey(item.id, item.at)));
                (isDone ? done : open).add(item);
            }
        }
        Collections.sort(open, (a, b) -> Long.compare(a.at, b.at));
        Collections.sort(done, (a, b) -> Long.compare(a.at, b.at));
        int overdue = 0;
        for (Item item : open) {
            if (item.at <= now) overdue++;
        }
        int all = open.size() + done.size();
        int cap = Math.max(0, maxRows);
        // اگر همه جا نشوند یک ردیف برای «+N» کنار می‌رود، ولی دست‌کم یک یادآوری همیشه دیده شود.
        int visible = all <= cap ? all : Math.min(all, Math.max(1, cap - 1));
        List<Row> rows = new ArrayList<>(visible);
        for (int i = 0; i < visible; i++) {
            boolean isDone = i >= open.size();
            Item item = isDone ? done.get(i - open.size()) : open.get(i);
            rows.add(new Row(item, !isDone && item.at <= now, isDone, clock(item.at, tz)));
        }
        return new View(open.size(), overdue, done.size(), rows, all - visible);
    }

    /** کلید «تیک‌خوردهٔ محلی» یک یادآوری تا وقتی برنامه «انجام شد» را اعمال کند. */
    public static String doneKey(String id, long at) {
        return id + "@" + at;
    }

    /**
     * زمان بعدی که ویجت باید خودش را تازه کند: سررسید بعدی امروز (تا قرمز شود) یا نیمه‌شب.
     */
    public static long nextRefreshAt(List<Item> items, long now, TimeZone tz) {
        long next = nextMidnight(now, tz);
        if (items != null) {
            for (Item item : items) {
                if (item != null && !item.done && item.at > now && item.at < next) next = item.at;
            }
        }
        return next + 1_000L;
    }

    /** برنامهٔ وب یادآوری‌های ۸ روز آینده را می‌فرستد؛ با کمی حاشیه ۷ روز معتبر می‌دانیم. */
    public static final long SYNC_COVERAGE_MS = 7L * 24 * 3_600_000L;

    /**
     * آیا دادهٔ ذخیره‌شده کل امروز را پوشش می‌دهد؟ اگر برنامه مدت زیادی باز نشده باشد، به‌جای
     * «امروز یادآوری نداری» باید «برنامه را باز کنید» نشان داد.
     */
    public static boolean coversToday(long savedAt, long now, TimeZone tz) {
        if (savedAt <= 0 || savedAt > now + 3_600_000L) return false;
        return nextMidnight(now, tz) <= savedAt + SYNC_COVERAGE_MS;
    }

    /** ردیف‌های قابل نمایش بر اساس ارتفاع ویجت (dp). */
    public static int rowsForHeight(int heightDp) {
        if (heightDp <= 0) return 3;
        int rows = (heightDp - 64) / 40;
        if (rows < 1) return 1;
        return Math.min(rows, 6);
    }

    public static String clock(long at, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(at);
        return persianDigits(two(c.get(Calendar.HOUR_OF_DAY)) + ":" + two(c.get(Calendar.MINUTE)));
    }

    /** مثل «سه‌شنبه ۱۵ مهر». */
    public static String dateLabel(long now, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(now);
        int[] j = gregorianToJalali(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
        return weekday(c.get(Calendar.DAY_OF_WEEK)) + " " + persianDigits(String.valueOf(j[2])) + " " + MONTHS[j[1] - 1];
    }

    public static String weekday(int calendarDayOfWeek) {
        switch (calendarDayOfWeek) {
            case Calendar.SATURDAY:
                return "شنبه";
            case Calendar.SUNDAY:
                return "یکشنبه";
            case Calendar.MONDAY:
                return "دوشنبه";
            case Calendar.TUESDAY:
                return "سه‌شنبه";
            case Calendar.WEDNESDAY:
                return "چهارشنبه";
            case Calendar.THURSDAY:
                return "پنجشنبه";
            default:
                return "جمعه";
        }
    }

    /** الگوریتم استاندارد تبدیل میلادی به شمسی (jalaali). */
    public static int[] gregorianToJalali(int gy, int gm, int gd) {
        int[] gdm = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
        int gy2 = gm > 2 ? gy + 1 : gy;
        long days = 355666L + 365L * gy + (gy2 + 3) / 4 - (gy2 + 99) / 100 + (gy2 + 399) / 400 + gd + gdm[gm - 1];
        long jy = -1595 + 33 * (days / 12053);
        days %= 12053;
        jy += 4 * (days / 1461);
        days %= 1461;
        if (days > 365) {
            jy += (days - 1) / 365;
            days = (days - 1) % 365;
        }
        int jm;
        int jd;
        if (days < 186) {
            jm = 1 + (int) (days / 31);
            jd = 1 + (int) (days % 31);
        } else {
            jm = 7 + (int) ((days - 186) / 30);
            jd = 1 + (int) ((days - 186) % 30);
        }
        return new int[]{(int) jy, jm, jd};
    }

    public static String persianDigits(String text) {
        if (text == null) return "";
        StringBuilder out = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            out.append(ch >= '0' && ch <= '9' ? (char) ('۰' + (ch - '0')) : ch);
        }
        return out.toString();
    }

    private static String two(int value) {
        return value < 10 ? "0" + value : String.valueOf(value);
    }
}
