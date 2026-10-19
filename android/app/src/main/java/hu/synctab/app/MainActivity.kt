package hu.synctab.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.graphics.Typeface
import android.net.wifi.WifiManager
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * SyncTab Android héj: megkeresi (vagy megadott címen eléri) a master gépet, és a kliens oldalt egy teljes képernyős
 * WebView-ban mutatja. A képernyő végig ébren marad, forgatáskor nem töltődik újra az oldal.
 */
class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    private lateinit var connectView: ScrollView
    private lateinit var foundBox: LinearLayout
    private lateinit var searchingText: TextView
    private lateinit var addressInput: EditText
    private var webView: WebView? = null

    private val found = LinkedHashMap<String, Server>()
    private var discovery: Discovery? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    private data class Server(val host: String, val port: Int, val name: String, var lastSeen: Long)

    private val prefs by lazy { getSharedPreferences("synctab", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        root = FrameLayout(this).apply { setBackgroundColor(color(R.color.bg)) }
        connectView = buildConnectView()
        root.addView(connectView, MATCH, MATCH)
        setContentView(root)

        if (WebView.getCurrentWebViewPackage() == null) {
            toast(getString(R.string.no_webview))
        }
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        if (webView == null) startDiscovery()
    }

    override fun onPause() {
        super.onPause()
        webView?.onPause()
        stopDiscovery()
    }

    override fun onDestroy() {
        stopDiscovery()
        webView?.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView != null) disconnect() else super.onBackPressed()
    }

    // ---------------------------------------------------------------- csatlakozás képernyő

    private fun buildConnectView(): ScrollView {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(40), dp(24), dp(24))
        }
        col.addView(text("SyncTab", 32f, R.color.fg, bold = true))
        searchingText = text(getString(R.string.searching), 15f, R.color.muted).also {
            (it.layoutParams as LinearLayout.LayoutParams).bottomMargin = dp(20)
        }
        col.addView(searchingText)

        foundBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(foundBox, MATCH, WRAP)

        col.addView(text(getString(R.string.manual), 13f, R.color.muted).also {
            (it.layoutParams as LinearLayout.LayoutParams).topMargin = dp(24)
        })
        addressInput = EditText(this).apply {
            hint = getString(R.string.hint)
            setHintTextColor(color(R.color.muted))
            setTextColor(color(R.color.fg))
            setBackgroundColor(color(R.color.panel))
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setSingleLine()
            imeOptions = EditorInfo.IME_ACTION_GO
            setText(prefs.getString("last", "") ?: "")
            setOnEditorActionListener { _, _, _ ->
                connect(text.toString())
                true
            }
        }
        col.addView(addressInput, MATCH, WRAP)
        col.addView(button(getString(R.string.connect), primary = true) { connect(addressInput.text.toString()) })
        return ScrollView(this).apply { addView(col) }
    }

    private fun refreshFound() {
        foundBox.removeAllViews()
        val now = System.currentTimeMillis()
        found.values.removeAll { now - it.lastSeen > 6000 }
        if (found.isEmpty()) {
            searchingText.text = getString(R.string.searching)
        } else {
            searchingText.text = getString(R.string.found)
            for (s in found.values) {
                foundBox.addView(button("${s.name}\n${s.host}:${s.port}", primary = true) { connect("${s.host}:${s.port}") })
            }
        }
    }

    // ---------------------------------------------------------------- felfedezés

    private fun startDiscovery() {
        if (discovery != null) return
        runCatching {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            multicastLock = wifi.createMulticastLock("synctab").apply {
                setReferenceCounted(false)
                acquire()
            }
        }
        discovery = Discovery { host, port, name ->
            runOnUiThread {
                found["$host:$port"] = Server(host, port, name, System.currentTimeMillis())
                refreshFound()
            }
        }.also { it.start() }
        root.postDelayed(object : Runnable {
            override fun run() {
                if (discovery == null) return
                refreshFound()
                root.postDelayed(this, 2000)
            }
        }, 2000)
    }

    private fun stopDiscovery() {
        discovery?.stopNow()
        discovery = null
        runCatching { multicastLock?.takeIf { it.isHeld }?.release() }
        multicastLock = null
    }

    // ---------------------------------------------------------------- WebView

    private fun normalize(input: String): String? {
        var s = input.trim()
        if (s.isEmpty()) return null
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
        val authority = s.substringAfter("://").substringBefore("/")
        if (!authority.contains(":")) s = s.replaceFirst(authority, "$authority:8080")
        return if (s.endsWith("/")) s else "$s/"
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun connect(input: String) {
        val url = normalize(input) ?: return toast(getString(R.string.enter_address))
        prefs.edit().putString("last", url.removePrefix("http://").trimEnd('/')).apply()
        stopDiscovery()

        val web = WebView(this).apply {
            setBackgroundColor(color(R.color.bg))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false // a metronóm / hang a koppintás után azonnal szólhasson
                cacheMode = WebSettings.LOAD_DEFAULT
                allowFileAccess = false
                allowContentAccess = false
                builtInZoomControls = false
                setSupportZoom(false)
            }
            addJavascriptInterface(Bridge(), "SyncTabApp")
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) {
                        toast(getString(R.string.unreachable))
                        disconnect()
                    }
                }

                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    toast(getString(R.string.render_gone))
                    disconnect()
                    return true
                }
            }
        }
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)

        webView = web
        root.addView(web, MATCH, MATCH)
        connectView.visibility = View.GONE
        hideSystemBars(true)
        web.loadUrl(url)
    }

    private fun disconnect() {
        webView?.let {
            root.removeView(it)
            it.loadUrl("about:blank")
            it.destroy()
        }
        webView = null
        connectView.visibility = View.VISIBLE
        hideSystemBars(false)
        found.clear()
        startDiscovery()
    }

    private fun hideSystemBars(hide: Boolean) {
        val c = WindowInsetsControllerCompat(window, root)
        if (hide) {
            c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            c.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            c.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    /** A weboldal innen éri el az alkalmazást (window.SyncTabApp). */
    private inner class Bridge {
        @JavascriptInterface
        fun disconnect() {
            runOnUiThread { this@MainActivity.disconnect() }
        }
    }

    // ---------------------------------------------------------------- UI segédek

    private val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
    private val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun color(id: Int) = resources.getColor(id, theme)
    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    private fun text(s: String, sp: Float, colorId: Int, bold: Boolean = false) = TextView(this).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color(colorId))
        if (bold) setTypeface(typeface, Typeface.BOLD)
        layoutParams = LinearLayout.LayoutParams(MATCH, WRAP).also { it.bottomMargin = dp(8) }
    }

    private fun button(label: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        gravity = Gravity.CENTER
        setTextColor(if (primary) Color.parseColor("#14161A") else color(R.color.fg))
        setBackgroundColor(color(if (primary) R.color.accent else R.color.panel))
        layoutParams = LinearLayout.LayoutParams(MATCH, WRAP).also { it.topMargin = dp(10) }
        setOnClickListener { onClick() }
    }
}
