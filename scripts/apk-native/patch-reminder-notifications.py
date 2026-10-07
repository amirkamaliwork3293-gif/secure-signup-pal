#!/usr/bin/env python3
"""Copy local-reminder Java classes and wire them into generated Capacitor Android."""
from __future__ import annotations

from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parent
ANDROID_ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "android")


def java_dir() -> Path:
    src = ANDROID_ROOT / "app" / "src" / "main" / "java"
    matches = list(src.glob("**/MainActivity.java"))
    if not matches:
        raise SystemExit(f"MainActivity.java not found under {src}")
    return matches[0].parent


def copy_java(dest: Path) -> None:
    for name in (
        "ReminderJsBridge.java",
        "ReminderScheduler.java",
        "ReminderAlarmReceiver.java",
        "ReminderBootReceiver.java",
        "ReminderRingtone.java",
        "ReminderWidget.java",
        "ReminderWidgetModel.java",
        "ReminderWidgetOpenActivity.java",
        "ReminderWidgetProvider.java",
    ):
        shutil.copyfile(ROOT / name, dest / name)
        print(f"copied {name}")


# منابع ویجت «یادآوری‌های امروز». همه با پیشوند kamix_widget_ تا با منابع Capacitor تداخل نکنند.
WIDGET_RESOURCES = (
    "layout/kamix_widget_reminders.xml",
    "xml/kamix_widget_reminders_info.xml",
    "drawable/kamix_widget_bg.xml",
    "drawable/kamix_widget_circle.xml",
    "drawable/kamix_widget_circle_overdue.xml",
    "values/kamix_widget_colors.xml",
    "values/kamix_widget_strings.xml",
    "values-night/kamix_widget_colors.xml",
)


def copy_resources(res_dir: Path) -> None:
    for rel in WIDGET_RESOURCES:
        target = res_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "res" / rel, target)
        print(f"copied res/{rel}")


def patch_manifest(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    perms = [
        ('android.permission.POST_NOTIFICATIONS',
         '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n'),
        ('android.permission.RECEIVE_BOOT_COMPLETED',
         '    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />\n'),
        ('android.permission.SCHEDULE_EXACT_ALARM',
         '    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />\n'),
        ('android.permission.VIBRATE',
         '    <uses-permission android:name="android.permission.VIBRATE" />\n'),
        ('android.permission.WAKE_LOCK',
         '    <uses-permission android:name="android.permission.WAKE_LOCK" />\n'),
    ]
    for needle, block in perms:
        if needle not in text:
            text = text.replace("<manifest", "<manifest", 1)
            # insert after <manifest ...> opening tag
            text = re.sub(r"(<manifest\b[^>]*>)", r"\1\n" + block.rstrip("\n"), text, count=1)

    receivers = """
        <receiver
            android:name=".ReminderAlarmReceiver"
            android:exported="false" />
        <receiver
            android:name=".ReminderBootReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>
"""
    if "ReminderAlarmReceiver" not in text:
        if "</application>" not in text:
            raise SystemExit("AndroidManifest.xml missing </application>")
        text = text.replace("</application>", receivers + "    </application>", 1)

    widget = """
        <receiver
            android:name=".ReminderWidgetProvider"
            android:exported="false"
            android:label="@string/kamix_widget_label">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
                <action android:name="com.kamali.inventory.REMINDER_WIDGET_REFRESH" />
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.intent.action.TIME_SET" />
                <action android:name="android.intent.action.TIMEZONE_CHANGED" />
                <action android:name="android.intent.action.DATE_CHANGED" />
                <action android:name="android.intent.action.LOCALE_CHANGED" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/kamix_widget_reminders_info" />
        </receiver>
        <activity
            android:name=".ReminderWidgetOpenActivity"
            android:excludeFromRecents="true"
            android:exported="false"
            android:noHistory="true"
            android:taskAffinity=""
            android:theme="@android:style/Theme.Translucent.NoTitleBar" />
"""
    if "ReminderWidgetProvider" not in text:
        if "</application>" not in text:
            raise SystemExit("AndroidManifest.xml missing </application>")
        text = text.replace("</application>", widget + "    </application>", 1)

    path.write_text(text, encoding="utf-8")
    print("patched AndroidManifest.xml")


BRIDGE_SNIPPET = """
        try {
            this.bridge.getWebView().addJavascriptInterface(new ReminderJsBridge(this), "KamaliReminders");
        } catch (Exception ignored) {}
"""

KAMALI_VOICE_JS_INTERFACE = re.compile(
    r'(webView\.addJavascriptInterface\(new KamaliVoiceBridge\([^)]*\),\s*"KamaliVoice"\s*\);)'
)


def patch_main_activity(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "KamaliReminders" in text:
        print("MainActivity already has KamaliReminders")
        return

    if KAMALI_VOICE_JS_INTERFACE.search(text):
        text = KAMALI_VOICE_JS_INTERFACE.sub(
            r'\1\n                webView.addJavascriptInterface(new ReminderJsBridge(this), "KamaliReminders");',
            text,
            count=1,
        )
        path.write_text(text, encoding="utf-8")
        print("patched MainActivity (KamaliVoice)")
        return

    if "public void onCreate(" in text:
        text = re.sub(
            r"(super\.onCreate\([^;]*;\s*)",
            r"\1" + BRIDGE_SNIPPET,
            text,
            count=1,
        )
        path.write_text(text, encoding="utf-8")
        print("patched MainActivity (existing onCreate)")
        return

    class_end = text.rfind("}")
    if class_end < 0:
        raise SystemExit("Could not find end of MainActivity class")
    insertion = """
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            this.bridge.getWebView().addJavascriptInterface(new ReminderJsBridge(this), "KamaliReminders");
        } catch (Exception ignored) {}
    }
"""
    text = text[:class_end] + insertion + text[class_end:]
    if "import android.os.Bundle;" not in text:
        text = text.replace(
            "import com.getcapacitor.BridgeActivity;",
            "import android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;",
            1,
        )
    path.write_text(text, encoding="utf-8")
    print("patched MainActivity (added onCreate)")


def patch_gradle(path: Path) -> None:
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    if "androidx.core:core:" in text:
        print("app/build.gradle already has androidx.core")
        return
    if "dependencies {" not in text:
        print("app/build.gradle has no dependencies block — skipped")
        return
    text = text.replace(
        "dependencies {",
        'dependencies {\n    implementation "androidx.core:core:1.13.1"',
        1,
    )
    path.write_text(text, encoding="utf-8")
    print("patched app/build.gradle (androidx.core)")


def main() -> None:
    dest = java_dir()
    copy_java(dest)
    copy_resources(ANDROID_ROOT / "app" / "src" / "main" / "res")
    patch_manifest(ANDROID_ROOT / "app" / "src" / "main" / "AndroidManifest.xml")
    patch_main_activity(dest / "MainActivity.java")
    patch_gradle(ANDROID_ROOT / "app" / "build.gradle")


if __name__ == "__main__":
    main()
