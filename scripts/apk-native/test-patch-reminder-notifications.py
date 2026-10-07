#!/usr/bin/env python3
"""Sanity-check the reminder-notification Android patcher on both MainActivity shapes."""
from __future__ import annotations

from pathlib import Path
import re
import tempfile
import xml.etree.ElementTree as ET

from importlib.machinery import SourceFileLoader

PATCHER = SourceFileLoader(
    "patch_reminder_notifications",
    str(Path(__file__).with_name("patch-reminder-notifications.py")),
).load_module()

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:label="کمالی">
        <activity android:name=".MainActivity" />
    </application>
</manifest>
"""

EMPTY_MAIN = """package com.kamali.inventory;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
"""

VOICE_MAIN = """package com.kamali.inventory;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = this.bridge.getWebView();
        webView.addJavascriptInterface(new KamaliVoiceBridge(), "KamaliVoice");
    }
}
"""


def run_case(label: str, main_src: str) -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        java = root / "app/src/main/java/com/kamali/inventory"
        java.mkdir(parents=True)
        (java / "MainActivity.java").write_text(main_src, encoding="utf-8")
        manifest = root / "app/src/main/AndroidManifest.xml"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(MANIFEST, encoding="utf-8")

        gradle = root / "app" / "build.gradle"
        gradle.write_text("dependencies {\n}\n", encoding="utf-8")

        old_root = PATCHER.ANDROID_ROOT
        PATCHER.ANDROID_ROOT = root
        try:
            # دو بار اجرا: پچ باید idempotent باشد.
            PATCHER.main()
            first = snapshot(root)
            PATCHER.main()
            assert snapshot(root) == first, f"{label}: second run changed the project"
        finally:
            PATCHER.ANDROID_ROOT = old_root

        main = (java / "MainActivity.java").read_text(encoding="utf-8")
        man = manifest.read_text(encoding="utf-8")
        assert "KamaliReminders" in main, f"{label}: missing JS interface"
        assert (java / "ReminderScheduler.java").exists(), f"{label}: scheduler not copied"
        assert (java / "ReminderRingtone.java").exists(), f"{label}: ringtone player not copied"
        assert "POST_NOTIFICATIONS" in man, f"{label}: missing notify permission"
        assert "ReminderAlarmReceiver" in man, f"{label}: missing alarm receiver"
        assert "ReminderBootReceiver" in man, f"{label}: missing boot receiver"
        assert gradle.read_text(encoding="utf-8").count("androidx.core:core:1.13.1") == 1
        assert main.count('"KamaliReminders"') == 1, f"{label}: bridge added twice"
        check_widget(label, root, java, man)
        print(f"ok {label}")


def snapshot(root: Path) -> dict[str, str]:
    return {
        str(p.relative_to(root)): p.read_text(encoding="utf-8")
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def check_widget(label: str, root: Path, java: Path, man: str) -> None:
    """ویجت «یادآوری‌های امروز»: کلاس‌ها، منابع و manifest، هر کدام دقیقاً یک بار."""
    for name in (
        "ReminderWidget.java",
        "ReminderWidgetModel.java",
        "ReminderWidgetOpenActivity.java",
        "ReminderWidgetProvider.java",
    ):
        assert (java / name).exists(), f"{label}: {name} not copied"

    ET.fromstring(man.encode("utf-8"))  # manifest هنوز XML معتبر است
    assert man.count('android:name=".ReminderWidgetProvider"') == 1, f"{label}: provider count"
    assert man.count('android:name=".ReminderWidgetOpenActivity"') == 1, f"{label}: activity count"
    assert man.count('android:name=".ReminderAlarmReceiver"') == 1, f"{label}: alarm receiver count"
    assert man.count('android:name=".ReminderBootReceiver"') == 1, f"{label}: boot receiver count"
    assert man.count("android.permission.POST_NOTIFICATIONS") == 1, f"{label}: permission count"
    assert 'android:resource="@xml/kamix_widget_reminders_info"' in man
    provider = re.search(r'<receiver\s+android:name="\.ReminderWidgetProvider".*?</receiver>', man, re.S)
    assert provider and 'android:exported="false"' in provider.group(0), f"{label}: provider must not be exported"
    assert "APPWIDGET_UPDATE" in provider.group(0)
    activity = re.search(r'<activity\s+android:name="\.ReminderWidgetOpenActivity"[^>]*/>', man, re.S)
    assert activity and 'android:exported="false"' in activity.group(0), f"{label}: trampoline must not be exported"
    # فقط صفحهٔ اصلی — ویجت روی صفحهٔ قفل نمی‌آید.
    info = (root / "app/src/main/res/xml/kamix_widget_reminders_info.xml").read_text(encoding="utf-8")
    assert 'android:widgetCategory="home_screen"' in info and "keyguard" not in info

    res = root / "app/src/main/res"
    defined: dict[str, set[str]] = {k: set() for k in ("id", "layout", "xml", "drawable", "color", "string")}
    texts = []
    for rel in PATCHER.WIDGET_RESOURCES:
        path = res / rel
        assert path.exists(), f"{label}: res/{rel} not copied"
        text = path.read_text(encoding="utf-8")
        ET.fromstring(text.encode("utf-8"))
        texts.append(text)
        kind = path.parent.name.split("-")[0]
        if kind in ("layout", "xml", "drawable"):
            defined[kind].add(path.stem)
        defined["id"].update(re.findall(r"@\+id/(\w+)", text))
        defined["color"].update(re.findall(r'<color name="(\w+)"', text))
        defined["string"].update(re.findall(r'<string name="(\w+)"', text))
        assert re.fullmatch(r"kamix_widget_\w+\.xml", path.name), f"{label}: unprefixed resource {rel}"
    # همهٔ ارجاع‌ها در منابع و manifest و کد جاوا به منبعی تعریف‌شده می‌رسند.
    for text in texts + [man]:
        for kind, name in re.findall(r"@(color|string|drawable|layout|xml)/(\w+)", text):
            if name.startswith("kamix_widget"):
                assert name in defined[kind], f"{label}: missing @{kind}/{name}"
    night = (res / "values-night/kamix_widget_colors.xml").read_text(encoding="utf-8")
    day = (res / "values/kamix_widget_colors.xml").read_text(encoding="utf-8")
    assert sorted(re.findall(r'name="(\w+)"', night)) == sorted(re.findall(r'name="(\w+)"', day)), "dark colors mismatch"
    for src in ("ReminderWidget.java", "ReminderJsBridge.java", "ReminderWidgetProvider.java"):
        code = (java / src).read_text(encoding="utf-8")
        for kind, name in re.findall(r"R\.(id|layout|drawable|color|string|xml)\.(\w+)", code):
            assert name in defined[kind], f"{label}: {src} uses missing R.{kind}.{name}"


if __name__ == "__main__":
    run_case("empty", EMPTY_MAIN)
    run_case("voice", VOICE_MAIN)
