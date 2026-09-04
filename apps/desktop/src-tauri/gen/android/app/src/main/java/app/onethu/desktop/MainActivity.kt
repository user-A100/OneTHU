package app.onethu.desktop

import android.os.Bundle
import android.webkit.WebView
import android.view.View
import android.view.ViewGroup
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 把自身交给 Rust 侧（set_app_icon 需要 Context 调 PackageManager）。
    // companion init 已先 loadLibrary，此处符号必然可解析。
    storeActivity()
    // 接管返回键（后注册的 callback 优先于 Tauri AppPlugin 的默认实现）。
    // 默认实现 webView.goBack() 依据异步陈旧的 canGoBack()：连按会越过第 0 条
    // 历史条目，WebView 落在空白条目上——整屏纯白、进程存活（真机实录）。
    // 这里用 WebBackForwardList 的 currentIndex 做硬校验：确有上一条才后退，
    // 否则退到后台（home 语义），绝不越界。
    onBackPressedDispatcher.addCallback(this) {
      val wv = findWebView(window.decorView)
      val list = wv?.copyBackForwardList()
      if (wv != null && list != null && list.currentIndex > 0) {
        wv.goBack()
      } else {
        moveTaskToBack(true)
      }
    }
  }

  /** 深度优先找 wry 的 WebView（tauri 不暴露引用，只能遍历视图树） */
  private fun findWebView(root: View): WebView? {
    if (root is WebView) return root
    if (root is ViewGroup) {
      for (i in 0 until root.childCount) {
        findWebView(root.getChildAt(i))?.let { return it }
      }
    }
    return null
  }

  private external fun storeActivity()

  companion object {
    init {
      // [lib] name = "onethu_lib"（Cargo.toml）→ libonethu_lib.so。
      // 与 Tauri 生成的 Rust.kt 重复加载无害（dlopen 幂等），但保证
      // 即便加载顺序有变，storeActivity/JNI_OnLoad 也已就位。
      System.loadLibrary("onethu_lib")
    }
  }
}
