package com.kamali.inventory;

import android.Manifest;
import android.app.Activity;
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
}
