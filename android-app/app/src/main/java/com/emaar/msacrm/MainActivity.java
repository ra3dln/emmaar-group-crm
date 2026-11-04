package com.emaar.msacrm;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

// ===== شاشة التطبيق: الموقع الحي جوه WebView بتاع التطبيق نفسه =====
// من غير Chrome ومن غير شريط عنوان. أي تعديل على الموقع بيوصل لوحده.
// روابط الاتصال والواتساب بتفتح تطبيق الموبايل نفسه (مش جوه الشاشة).
public class MainActivity extends Activity {
    private static final String SITE = "https://emmaar-group-crm.vercel.app/";
    private static final String HOST = "emmaar-group-crm.vercel.app";
    private static final int BRAND = Color.parseColor("#0B1E3D");
    private static final int REQ_LOCATION = 1;
    private static final int REQ_FILE = 2;
    // لون خلفية الصفحة بيتقرا كل كام ثانية (الثيم ممكن يتغيّر) عشان أيقونات الساعة والبطارية تبان
    private static final long THEME_CHECK_MS = 2500;

    private WebView web;
    // شاشة «مفيش نت» — بتظهر بس لو الصفحة ما حمّلتش
    private LinearLayout offline;
    // ارتفاع شريط الساعة فوق وشريط الرجوع تحت (بوحدات CSS) — الموقع بيبعد محتواه عنهم
    private float safeTopCss;
    private float safeBottomCss;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable themeCheck = new Runnable() {
        @Override
        public void run() {
            syncBarIcons();
            handler.postDelayed(this, THEME_CHECK_MS);
        }
    };
    // طلب الموقع (GPS) من الصفحة مستني موافقة المستخدم على الصلاحية
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;
    // رفع ملف (صور العقارات / شيت الأرقام)
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        goEdgeToEdge(window);
        useHighestRefreshRate(window);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BRAND);

        web = new WebView(this);
        web.setBackgroundColor(BRAND);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        offline = buildOfflineScreen();
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        // ارتفاع الشريطين (والكيبورد) — الصفحة مرسومة تحتهم، فبنقول للموقع يبعد عنهم
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            applyInsets(insets);
            return insets;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " MSACRMApp/" + BuildConfig.VERSION_NAME);

        // كوكي الجلسة (تسجيل الدخول) بيفضل محفوظ بين مرات الفتح
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openOutside(request.getUrl());
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                pushSafeArea();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushSafeArea();
                syncBarIcons();
            }

            // الصفحة الرئيسية ما حمّلتش (مفيش نت / النت وقع) → شاشة إعادة المحاولة
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                view.loadUrl("about:blank");
                offline.setVisibility(View.VISIBLE);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                    return;
                }
                pendingGeoOrigin = origin;
                pendingGeoCallback = callback;
                requestPermissions(new String[] {
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                }, REQ_LOCATION);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        // التطبيق بيفتح على الواجهة على طول (من غير شاشة بداية)
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(SITE);
    }

    // ===== شاشة كاملة زي باقي التطبيقات =====
    // الصفحة بتترسم تحت شريط الساعة وشريط الرجوع (شفافين) بدل حواف زرقا فوق وتحت.
    private void goEdgeToEdge(Window window) {
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    private void applyInsets(WindowInsets insets) {
        int top;
        int bottom;
        int keyboard;
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets bars = insets.getInsets(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
            top = bars.top;
            bottom = bars.bottom;
            keyboard = Math.max(0, ime.bottom - bars.bottom);
        } else {
            top = insets.getStableInsetTop();
            bottom = insets.getStableInsetBottom();
            keyboard = Math.max(0, insets.getSystemWindowInsetBottom() - bottom);
        }
        // الكيبورد: نقصّر الصفحة بارتفاعه عشان الحقل اللي بتكتب فيه يفضل باين
        web.setPadding(0, 0, 0, keyboard > 0 ? keyboard + bottom : 0);
        float density = getResources().getDisplayMetrics().density;
        safeTopCss = top / density;
        safeBottomCss = keyboard > 0 ? 0 : bottom / density;
        pushSafeArea();
    }

    // الموقع بيبعد الهيدر والشريط السفلي عن الحواف بـ --safe-top / --safe-bottom
    private void pushSafeArea() {
        if (web == null) return;
        String js = "(function(){var s=document.documentElement.style;"
            + "s.setProperty('--safe-top','" + safeTopCss + "px');"
            + "s.setProperty('--safe-bottom','" + safeBottomCss + "px');})();";
        web.evaluateJavascript(js, null);
    }

    // أيقونات الساعة والبطارية: بيضا على ثيم غامق، وغامقة على ثيم فاتح
    private void syncBarIcons() {
        if (web == null || Build.VERSION.SDK_INT < 23) return;
        web.evaluateJavascript(
            "(function(){var c=getComputedStyle(document.body||document.documentElement).backgroundColor;"
                + "var m=c.match(/\\d+(\\.\\d+)?/g);if(!m)return -1;"
                + "return (0.299*m[0]+0.587*m[1]+0.114*m[2])/255;})()",
            value -> {
                float luminance;
                try {
                    luminance = Float.parseFloat(value);
                } catch (NumberFormatException e) {
                    return;
                }
                if (luminance < 0) return;
                setLightBars(luminance > 0.6f);
            });
    }

    private void setLightBars(boolean light) {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = window.getInsetsController();
            if (c == null) return;
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            c.setSystemBarsAppearance(light ? mask : 0, mask);
        } else {
            View decor = window.getDecorView();
            int flags = decor.getSystemUiVisibility();
            int lightFlags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | (Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
            decor.setSystemUiVisibility(light ? (flags | lightFlags) : (flags & ~lightFlags));
        }
    }

    // ===== 144Hz: نطلب أعلى معدل تحديث بتدعمه الشاشة =====
    // أندرويد كتير بيشغّل التطبيقات على 60Hz لو ما طلبتش غير كده.
    private void useHighestRefreshRate(Window window) {
        if (Build.VERSION.SDK_INT < 23) return;
        Display display = getWindowManager().getDefaultDisplay();
        Display.Mode current = display.getMode();
        Display.Mode best = current;
        for (Display.Mode mode : display.getSupportedModes()) {
            boolean sameSize = mode.getPhysicalWidth() == current.getPhysicalWidth()
                && mode.getPhysicalHeight() == current.getPhysicalHeight();
            if (sameSize && mode.getRefreshRate() > best.getRefreshRate()) best = mode;
        }
        WindowManager.LayoutParams params = window.getAttributes();
        params.preferredDisplayModeId = best.getModeId();
        params.preferredRefreshRate = best.getRefreshRate();
        window.setAttributes(params);
    }

    private LinearLayout buildOfflineScreen() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(BRAND);
        box.setClickable(true);

        TextView text = new TextView(this);
        text.setText("مفيش اتصال بالإنترنت");
        text.setTextColor(Color.parseColor("#C8D3E6"));
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        text.setGravity(Gravity.CENTER);
        box.addView(text, new LinearLayout.LayoutParams(-2, -2));

        Button retry = new Button(this);
        retry.setText("إعادة المحاولة");
        retry.setTextColor(BRAND);
        retry.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(24));
        retry.setBackground(bg);
        retry.setPadding(dp(28), 0, dp(28), 0);
        retry.setOnClickListener(v -> {
            box.setVisibility(View.GONE);
            web.loadUrl(SITE);
        });
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, dp(46));
        bp.topMargin = dp(18);
        box.addView(retry, bp);
        box.setVisibility(View.GONE);
        return box;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    // صفحات الموقع جوه التطبيق — وأي حاجة تانية (اتصال، واتساب، خرائط…) برّه
    private boolean openOutside(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        if (("https".equals(scheme) || "http".equals(scheme)) && HOST.equals(uri.getHost())) return false;
        try {
            Intent intent = "tel".equals(scheme)
                ? new Intent(Intent.ACTION_DIAL, uri)
                : new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            // مفيش تطبيق يفتح الرابط ده — نسيبه
        }
        return true;
    }

    private boolean hasLocationPermission() {
        return Build.VERSION.SDK_INT < 23
            || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_LOCATION && pendingGeoCallback != null) {
            pendingGeoCallback.invoke(pendingGeoOrigin, hasLocationPermission(), false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    // زرار الرجوع: يرجع صفحة جوه الموقع، ولو مفيش يقفل التطبيق
    @Override
    public void onBackPressed() {
        if (web != null && offline.getVisibility() != View.VISIBLE && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        handler.removeCallbacks(themeCheck);
        handler.postDelayed(themeCheck, THEME_CHECK_MS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(themeCheck);
        if (web != null) web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(themeCheck);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
