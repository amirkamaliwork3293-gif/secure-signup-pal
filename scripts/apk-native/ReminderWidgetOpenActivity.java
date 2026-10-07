package com.kamali.inventory;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * پل نامرئی: ضربه روی ویجت → علامت «برو به /reminders» → باز کردن همان صفحهٔ اصلی برنامه.
 * برنامهٔ وب علامت را با KamaliReminders.takeOpenRoute() برمی‌دارد (APK قدیمی/سایت قدیمی: فقط برنامه باز می‌شود).
 */
public class ReminderWidgetOpenActivity extends Activity {
    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            ReminderWidget.markOpenRequested(getApplicationContext());
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch == null) launch = new Intent(this, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(launch);
        } catch (Exception ignored) {
        }
        finish();
        try {
            overridePendingTransition(0, 0);
        } catch (Exception ignored) {
        }
    }
}
