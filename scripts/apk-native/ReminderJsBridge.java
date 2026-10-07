package com.kamali.inventory;

import android.Manifest;
import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/**
 * WebView bridge for local reminder banners. The website never sees this class.
 */
public class ReminderJsBridge {
    private static final int REQ_NOTIFY = 4821;
    private final Activity activity;

    public ReminderJsBridge(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void sync(String json) {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    activity.runOnUiThread(() -> {
                        try {
                            ActivityCompat.requestPermissions(
                                    activity,
                                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                                    REQ_NOTIFY
                            );
                        } catch (Exception ignored) {
                        }
                    });
                }
            }
        } catch (Exception ignored) {
        }
        ReminderScheduler.syncFromJson(activity.getApplicationContext(), json);
    }

    @JavascriptInterface
    public String takeCompleted() {
        try {
            return ReminderScheduler.takeCompletedJson(activity.getApplicationContext());
        } catch (Exception ignored) {
            return "[]";
        }
    }

    /** دادهٔ ویجت «یادآوری‌های امروز» — جدا از sync و بدون اثر روی زنگ‌ها. */
    @JavascriptInterface
    public void syncWidget(String json) {
        try {
            ReminderWidget.saveFromJson(activity.getApplicationContext(), json);
        } catch (Throwable ignored) {
        }
    }

    /** یک‌بار مصرف: «/reminders» اگر برنامه از روی ویجت باز شده باشد. */
    @JavascriptInterface
    public String takeOpenRoute() {
        try {
            return ReminderWidget.takeOpenRoute(activity.getApplicationContext());
        } catch (Throwable ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean canPinWidget() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
            AppWidgetManager manager = activity.getSystemService(AppWidgetManager.class);
            if (manager == null || !manager.isRequestPinAppWidgetSupported()) return false;
            // اگر ویجت از قبل روی صفحه است، دکمهٔ افزودن لازم نیست.
            int[] ids = manager.getAppWidgetIds(new ComponentName(activity, ReminderWidgetProvider.class));
            return ids == null || ids.length == 0;
        } catch (Throwable ignored) {
            return false;
        }
    }

    /** پنجرهٔ سیستمی «افزودن ویجت به صفحهٔ اصلی» (اندروید ۸+). */
    @JavascriptInterface
    public boolean requestPinWidget() {
        if (!canPinWidget()) return false;
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
                AppWidgetManager manager = activity.getSystemService(AppWidgetManager.class);
                if (manager != null) {
                    manager.requestPinAppWidget(
                            new ComponentName(activity, ReminderWidgetProvider.class), null, null);
                }
            } catch (Throwable ignored) {
            }
        });
        return true;
    }
}
