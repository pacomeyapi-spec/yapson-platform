package net.yapson.platform;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public class MainActivity extends Activity {

    private WebView webView;
    private ProgressBar progressBar;
    private LinearLayout zoomBar;
    private SharedPreferences prefs;

    private static final String APP_URL   = "https://yapson-platform-production.up.railway.app/";
    private static final String PREF_ZOOM = "textZoom";
    private static final int    ZOOM_MIN  = 75;
    private static final int    ZOOM_MAX  = 175;
    private static final int    ZOOM_STEP = 10;
    private static final int    ZOOM_DEF  = 110; // légèrement agrandi par défaut

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().setStatusBarColor(Color.parseColor("#080b10"));
        getWindow().setNavigationBarColor(Color.parseColor("#080b10"));

        prefs = getSharedPreferences("yapson_prefs", Context.MODE_PRIVATE);

        // ── Root layout ──
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#080b10"));

        // ── Barre de progression ──
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setVisibility(View.GONE);
        progressBar.setProgressTintList(
            android.content.res.ColorStateList.valueOf(Color.parseColor("#00e5a0"))
        );
        FrameLayout.LayoutParams pbParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, 8
        );
        pbParams.gravity = Gravity.TOP;

        // ── WebView ──
        webView = new WebView(this);
        FrameLayout.LayoutParams wvParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        );

        // ── Barre zoom flottante ──
        zoomBar = buildZoomBar();
        FrameLayout.LayoutParams zbParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        zbParams.gravity = Gravity.BOTTOM | Gravity.END;
        zbParams.setMargins(0, 0, 24, 80);

        root.addView(webView, wvParams);
        root.addView(progressBar, pbParams);
        root.addView(zoomBar, zbParams);

        setContentView(root);

        setupWebView();
        applyZoom(prefs.getInt(PREF_ZOOM, ZOOM_DEF));

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    // ── Construction de la barre zoom ──────────────────────────────────────
    private LinearLayout buildZoomBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(Color.parseColor("#CC1a1f2e")); // semi-transparent
        bar.setPadding(4, 4, 4, 4);
        // coins arrondis via background dessiné
        bar.setAlpha(0.92f);

        // Arrondir les coins
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(Color.parseColor("#CC1a1f2e"));
        bg.setCornerRadius(48f);
        bar.setBackground(bg);
        bar.setPadding(8, 4, 8, 4);

        bar.addView(makeZoomBtn("A−", -1));
        bar.addView(makeZoomBtn("A", 0));   // reset
        bar.addView(makeZoomBtn("A+", 1));

        return bar;
    }

    private TextView makeZoomBtn(String label, int direction) {
        TextView btn = new TextView(this);
        btn.setText(label);
        btn.setTextColor(Color.parseColor("#00e5a0"));
        btn.setTextSize(direction == 0 ? 13f : 16f);
        btn.setTypeface(Typeface.DEFAULT_BOLD);
        btn.setPadding(20, 12, 20, 12);
        btn.setGravity(Gravity.CENTER);

        btn.setOnClickListener(v -> {
            int current = prefs.getInt(PREF_ZOOM, ZOOM_DEF);
            int next;
            if (direction == 0) {
                next = ZOOM_DEF;
            } else {
                next = current + direction * ZOOM_STEP;
                next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
            }
            applyZoom(next);
            prefs.edit().putInt(PREF_ZOOM, next).apply();
            // Feedback visuel : flash vert
            btn.setTextColor(Color.WHITE);
            btn.postDelayed(() -> btn.setTextColor(Color.parseColor("#00e5a0")), 150);
        });

        return btn;
    }

    // ── Appliquer le zoom ──────────────────────────────────────────────────
    private void applyZoom(int zoom) {
        webView.getSettings().setTextZoom(zoom);
    }

    // ── Configuration WebView ──────────────────────────────────────────────
    private void setupWebView() {
        WebSettings s = webView.getSettings();

        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        // Viewport mobile — scale initial 1.0 pour un rendu net
        s.setInitialScale(0);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (!url.contains("yapson-platform-production.up.railway.app")
                 && !url.contains("yapson.net")) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                if (p < 100) {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(p);
                } else {
                    progressBar.setVisibility(View.GONE);
                }
            }
        });

        webView.setBackgroundColor(Color.parseColor("#080b10"));
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        webView.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (webView != null) webView.destroy();
    }
}
