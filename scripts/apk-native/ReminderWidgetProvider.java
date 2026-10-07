package com.kamali.inventory;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/** ویجت «یادآوری‌های امروز». هر خطایی بلعیده می‌شود تا لانچر یا برنامه هرگز کرش نکند. */
public class ReminderWidgetProvider extends AppWidgetProvider {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            super.onReceive(context, intent);
        } catch (Exception ignored) {
        }
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;
        // تازه‌سازی نیمه‌شب/سررسید، تغییر ساعت یا زبان، بعد از روشن شدن گوشی و بعد از آپدیت برنامه
        if (ReminderWidget.ACTION_REFRESH.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || Intent.ACTION_DATE_CHANGED.equals(action)
                || Intent.ACTION_LOCALE_CHANGED.equals(action)
                || Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            ReminderWidget.refreshAll(context.getApplicationContext());
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        if (appWidgetIds == null) return;
        for (int id : appWidgetIds) ReminderWidget.update(context.getApplicationContext(), manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        ReminderWidget.update(context.getApplicationContext(), manager, appWidgetId);
    }

    @Override
    public void onDisabled(Context context) {
        ReminderWidget.cancelRefresh(context.getApplicationContext());
    }
}
