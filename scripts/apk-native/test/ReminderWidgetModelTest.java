import com.kamali.inventory.ReminderWidgetModel;
import com.kamali.inventory.ReminderWidgetModel.Item;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;

/** تست منطق خالص ویجت «یادآوری‌های امروز». اجرا: python3 scripts/apk-native/test-reminder-widget-model.py */
public class ReminderWidgetModelTest {
    private static int checks = 0;

    private static void eq(Object expected, Object actual, String label) {
        checks++;
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError(label + ": expected <" + expected + "> but was <" + actual + ">");
        }
    }

    private static void ok(boolean cond, String label) {
        eq(true, cond, label);
    }

    /** زمان به وقت تهران (UTC+03:30، بدون ساعت تابستانی از ۱۴۰۱). */
    private static long tehran(String isoLocal) {
        return java.time.LocalDateTime.parse(isoLocal)
                .atZone(java.time.ZoneId.of("Asia/Tehran")).toInstant().toEpochMilli();
    }

    public static void main(String[] args) {
        // میزبان در منطقهٔ زمانی دیگری است؛ ویجت باید همچنان «امروزِ تهران» را حساب کند.
        TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"));
        TimeZone tz = ReminderWidgetModel.appTimeZone();
        eq("Asia/Tehran", tz.getID(), "app time zone");

        // ─── تاریخ شمسی ───
        eq("1405/1/1", j(2026, 3, 21), "nowruz 1405");
        eq("1403/12/30", j(2025, 3, 20), "leap esfand 30");
        eq("1404/1/1", j(2025, 3, 21), "nowruz 1404");
        eq("1378/10/11", j(2000, 1, 1), "y2k");
        eq("1405/7/15", j(2026, 10, 7), "today in task");
        // پیوستگی روزها در ۶۰ سال: هر روز دقیقاً یک روز شمسی جلو می‌رود.
        java.time.LocalDate d = java.time.LocalDate.of(2000, 1, 1);
        int[] prev = ReminderWidgetModel.gregorianToJalali(1999, 12, 31);
        for (int i = 0; i < 366 * 60; i++, d = d.plusDays(1)) {
            int[] cur = ReminderWidgetModel.gregorianToJalali(d.getYear(), d.getMonthValue(), d.getDayOfMonth());
            boolean sameMonth = cur[0] == prev[0] && cur[1] == prev[1] && cur[2] == prev[2] + 1;
            boolean nextMonth = cur[2] == 1 && ((cur[0] == prev[0] && cur[1] == prev[1] + 1)
                    || (cur[0] == prev[0] + 1 && cur[1] == 1 && prev[1] == 12));
            if (!(sameMonth || nextMonth)) throw new AssertionError("jalali gap at " + d);
            int maxDay = cur[1] <= 6 ? 31 : cur[1] <= 11 ? 30 : 30;
            if (cur[2] > maxDay) throw new AssertionError("jalali overflow at " + d);
            prev = cur;
        }
        checks++;

        // ─── ارقام و قالب ساعت ───
        eq("۰۱۲۳۴۵۶۷۸۹", ReminderWidgetModel.persianDigits("0123456789"), "persian digits");
        eq("", ReminderWidgetModel.persianDigits(null), "persian digits null");
        eq("۰۹:۰۵", ReminderWidgetModel.clock(tehran("2026-10-07T09:05:59"), tz), "clock padded");
        eq("۲۳:۵۹", ReminderWidgetModel.clock(tehran("2026-10-07T23:59:00"), tz), "clock late");
        eq("۰۰:۰۰", ReminderWidgetModel.clock(tehran("2026-10-08T00:00:00"), tz), "clock midnight");
        eq("چهارشنبه ۱۵ مهر", ReminderWidgetModel.dateLabel(tehran("2026-10-07T10:00:00"), tz), "date label");
        eq("جمعه ۲۹ اسفند", ReminderWidgetModel.dateLabel(tehran("2026-03-20T23:59:59"), tz), "date label end of year");
        eq("شنبه ۱ فروردین", ReminderWidgetModel.dateLabel(tehran("2026-03-21T00:00:00"), tz), "date label nowruz");

        // ─── مرز روز (نیمه‌شب تهران) ───
        long now = tehran("2026-10-07T14:00:00");
        eq(tehran("2026-10-07T00:00:00"), ReminderWidgetModel.startOfDay(now, tz), "start of day");
        eq(tehran("2026-10-08T00:00:00"), ReminderWidgetModel.nextMidnight(now, tz), "next midnight");
        eq(tehran("2026-10-08T00:00:00"),
                ReminderWidgetModel.nextMidnight(tehran("2026-10-07T23:59:59.999"), tz), "midnight from last ms");
        eq(tehran("2026-10-09T00:00:00"),
                ReminderWidgetModel.nextMidnight(tehran("2026-10-08T00:00:00"), tz), "midnight exactly");

        List<Item> items = new ArrayList<>(Arrays.asList(
                new Item("yesterday", "دیروز", "", tehran("2026-10-06T23:59:59")),
                new Item("late", "شب", "", tehran("2026-10-07T23:59:59")),
                new Item("first", "صبح زود", "علی", tehran("2026-10-07T00:00:00")),
                new Item("noon", "ظهر", "", tehran("2026-10-07T12:30:00")),
                new Item("exact", "همین الان", "", now),
                new Item("evening", "عصر", "رضا", tehran("2026-10-07T18:00:00")),
                new Item("tomorrow", "فردا", "", tehran("2026-10-08T00:00:00")),
                new Item("", "بی‌شناسه", "", tehran("2026-10-07T10:00:00")),
                null));
        ReminderWidgetModel.View v = ReminderWidgetModel.build(items, null, now, tz, 6);
        eq(5, v.total, "only today's items");
        eq(3, v.overdueCount, "overdue = due at or before now");
        eq(0, v.more, "no overflow");
        eq(Arrays.asList("first", "noon", "exact", "evening", "late"), ids(v), "sorted by time");
        ok(v.rows.get(0).overdue && v.rows.get(2).overdue && !v.rows.get(3).overdue, "overdue flags");
        eq("علی", v.rows.get(0).item.customer, "customer kept");
        eq("۰۰:۰۰", v.rows.get(0).clock, "row clock");

        // پنهان موقت بعد از «انجام شد» — بر اساس شناسه + زمان (تکراری‌ها با زمان جدید پنهان نمی‌شوند)
        Set<String> hidden = new HashSet<>();
        hidden.add(ReminderWidgetModel.hiddenKey("noon", tehran("2026-10-07T12:30:00")));
        hidden.add(ReminderWidgetModel.hiddenKey("evening", tehran("2026-10-01T18:00:00")));
        v = ReminderWidgetModel.build(items, hidden, now, tz, 6);
        eq(Arrays.asList("first", "exact", "evening", "late"), ids(v), "hidden by id+at only");

        // سقف ردیف‌ها و «+N»
        v = ReminderWidgetModel.build(items, null, now, tz, 3);
        eq(2, v.rows.size(), "one slot kept for +N");
        eq(3, v.more, "+N count");
        v = ReminderWidgetModel.build(items, null, now, tz, 5);
        eq(5, v.rows.size(), "exact fit shows all");
        eq(0, v.more, "exact fit no +N");
        v = ReminderWidgetModel.build(items, null, now, tz, 1);
        eq(1, v.rows.size(), "single slot still shows first item");
        eq(4, v.more, "single slot more");
        v = ReminderWidgetModel.build(items, null, now, tz, 0);
        eq(1, v.rows.size(), "zero rows still shows first item");
        eq(4, v.more, "zero rows more");

        // خالی و null
        v = ReminderWidgetModel.build(Collections.emptyList(), null, now, tz, 4);
        eq(0, v.total, "empty");
        eq(0, v.rows.size(), "empty rows");
        v = ReminderWidgetModel.build(null, null, now, tz, 4);
        eq(0, v.total, "null list");

        // بعد از نیمه‌شب همان داده «فردا» را امروز می‌بیند
        v = ReminderWidgetModel.build(items, null, tehran("2026-10-08T00:00:01"), tz, 6);
        eq(Arrays.asList("tomorrow"), ids(v), "day rollover");

        // فهرست خیلی بزرگ
        List<Item> huge = new ArrayList<>();
        long start = ReminderWidgetModel.startOfDay(now, tz);
        for (int i = 0; i < 200_000; i++) {
            huge.add(new Item("h" + i, "t" + i, "", start + (long) (i % 172_800) * 1_000L));
        }
        long t0 = System.nanoTime();
        v = ReminderWidgetModel.build(huge, null, now, tz, 6);
        long ms = (System.nanoTime() - t0) / 1_000_000;
        eq(5, v.rows.size(), "huge rows");
        eq(v.total - 5, v.more, "huge more");
        ok(v.total > 0 && v.total < 200_000, "huge filtered to today");
        ok(ms < 3_000, "huge list fast (" + ms + "ms)");

        // تازه‌سازی بعدی: سررسید بعدی امروز یا نیمه‌شب (+۱ ثانیه)
        eq(tehran("2026-10-07T18:00:01"), ReminderWidgetModel.nextRefreshAt(items, now, tz), "refresh at next due");
        eq(tehran("2026-10-08T00:00:01"),
                ReminderWidgetModel.nextRefreshAt(Collections.emptyList(), now, tz), "refresh at midnight");
        eq(tehran("2026-10-08T00:00:01"), ReminderWidgetModel.nextRefreshAt(null, now, tz), "refresh null");

        // دادهٔ کهنه (برنامه بیش از یک هفته باز نشده) → «برنامه را باز کنید»
        ok(ReminderWidgetModel.coversToday(now, now, tz), "fresh data covers today");
        ok(ReminderWidgetModel.coversToday(tehran("2026-10-01T00:00:01"), now, tz), "6+ days old still ok");
        ok(!ReminderWidgetModel.coversToday(tehran("2026-09-30T23:59:59"), now, tz), "7+ days old is stale");
        ok(!ReminderWidgetModel.coversToday(0, now, tz), "never synced");
        ok(!ReminderWidgetModel.coversToday(now + 86_400_000L, now, tz), "clock moved backwards");

        // ارتفاع ویجت → ردیف‌ها
        eq(3, ReminderWidgetModel.rowsForHeight(0), "unknown height");
        eq(1, ReminderWidgetModel.rowsForHeight(110), "small");
        eq(2, ReminderWidgetModel.rowsForHeight(180), "medium");
        eq(6, ReminderWidgetModel.rowsForHeight(2000), "max rows");

        System.out.println("ReminderWidgetModel tests passed (" + checks + " checks)");
    }

    private static String j(int y, int m, int d) {
        int[] r = ReminderWidgetModel.gregorianToJalali(y, m, d);
        return r[0] + "/" + r[1] + "/" + r[2];
    }

    private static List<String> ids(ReminderWidgetModel.View v) {
        List<String> out = new ArrayList<>();
        for (ReminderWidgetModel.Row r : v.rows) out.add(r.item.id);
        return out;
    }
}
