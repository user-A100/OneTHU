package app.onethu.desktop

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 把自身交给 Rust 侧（set_app_icon 需要 Context 调 PackageManager）。
    // companion init 已先 loadLibrary，此处符号必然可解析。
    storeActivity()
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
