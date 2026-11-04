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
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
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
    // لو الصفحة ما ظهرتش في الوقت ده: النت بطيء — نعرض زرار إعادة المحاولة
    private static final long SLOW_MS = 15000;

    private WebView web;
    // شاشة البداية (اللوجو + تحميل) لحد ما الصفحة تظهر — بدل الشاشة الرصاصي
    private LinearLayout splash;
    private TextView splashText;
    private Button retryButton;
    private ProgressBar spinner;
    private boolean pageVisible;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable slowCheck = () -> {
        if (!pageVisible) showProblem("النت بطيء — لسه بنحمّل…");
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
        window.setStatusBarColor(BRAND);
        window.setNavigationBarColor(BRAND);
        useHighestRefreshRate(window);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BRAND);

        web = new WebView(this);
        web.setBackgroundColor(BRAND);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        splash = buildSplash();
        root.addView(splash, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // نسخة الصفحة المحفوظة على الجهاز بتتستخدم الأول، وبعدها بتتحدّث من النت
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

            // أول ما الصفحة تترسم فعلاً: نشيل شاشة البداية
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                markVisible();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!url.startsWith("about:")) markVisible();
            }

            // الصفحة الرئيسية ما حمّلتش (مفيش نت / النت وقع) → شاشة إعادة المحاولة
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                pageVisible = false;
                view.loadUrl("about:blank");
                showProblem("مفيش اتصال بالإنترنت");
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

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
            markVisible();
        } else {
            loadSite();
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

    private LinearLayout buildSplash() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(BRAND);
        box.setClickable(true);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        box.addView(logo, new LinearLayout.LayoutParams(dp(96), dp(96)));

        spinner = new ProgressBar(this);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(32), dp(32));
        sp.topMargin = dp(28);
        box.addView(spinner, sp);

        splashText = new TextView(this);
        splashText.setTextColor(Color.parseColor("#C8D3E6"));
        splashText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        splashText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-2, -2);
        tp.topMargin = dp(18);
        box.addView(splashText, tp);

        retryButton = new Button(this);
        retryButton.setText("إعادة المحاولة");
        retryButton.setTextColor(BRAND);
        retryButton.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(24));
        retryButton.setBackground(bg);
        retryButton.setPadding(dp(28), 0, dp(28), 0);
        retryButton.setOnClickListener(v -> loadSite());
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, dp(46));
        bp.topMargin = dp(18);
        box.addView(retryButton, bp);
        retryButton.setVisibility(View.GONE);
        return box;
    }

    private void loadSite() {
        pageVisible = false;
        splash.setVisibility(View.VISIBLE);
        spinner.setVisibility(View.VISIBLE);
        splashText.setText("");
        retryButton.setVisibility(View.GONE);
        handler.removeCallbacks(slowCheck);
        handler.postDelayed(slowCheck, SLOW_MS);
        web.loadUrl(SITE);
    }

    private void markVisible() {
        pageVisible = true;
        handler.removeCallbacks(slowCheck);
        if (splash.getVisibility() == View.VISIBLE) {
            splash.animate().alpha(0f).setDuration(180).withEndAction(() -> {
                splash.setVisibility(View.GONE);
                splash.setAlpha(1f);
            }).start();
        }
    }

    private void showProblem(String message) {
        handler.removeCallbacks(slowCheck);
        splash.animate().cancel();
        splash.setAlpha(1f);
        splash.setVisibility(View.VISIBLE);
        spinner.setVisibility(View.GONE);
        splashText.setText(message);
        retryButton.setVisibility(View.VISIBLE);
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
        if (web != null && pageVisible && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null && pageVisible) web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(slowCheck);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
