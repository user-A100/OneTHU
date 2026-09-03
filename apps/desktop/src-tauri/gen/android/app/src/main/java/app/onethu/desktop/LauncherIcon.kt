package app.onethu.desktop

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager

/**
 * 换桌面图标（legado LauncherIconHelp 同款）：切换入口组件启用态。
 * 放在 Kotlin 侧：方法编译期解析，避免 Rust 经 JNI 按名查找方法
 * （GetMethodID 在部分 ROM 上 NoSuchMethodError 且 pending exception
 * 会引发后续 JNI 调用 SIGABRT——真机实测踩坑）。
 */
object LauncherIcon {
    private val main = ComponentName("app.onethu.desktop", "app.onethu.desktop.MainActivity")
    private val alias = ComponentName("app.onethu.desktop", "app.onethu.desktop.MainActivityThuInfo")

    /** @return 空串=成功，否则错误消息（透传给前端提示） */
    @JvmStatic
    fun set(ctx: Context, name: String): String {
        return try {
            val pm = ctx.packageManager
            val (target, other) = when (name) {
                "onethu" -> main to alias
                "thuinfo" -> alias to main
                else -> return "未知图标: $name"
            }
            // 先启用目标、后禁用另一个——桌面任一时刻都有入口，不会变砖。
            // 组件状态由系统持久化，启动时无需重放。
            pm.setComponentEnabledSetting(
                target, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP
            )
            pm.setComponentEnabledSetting(
                other, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP
            )
            ""
        } catch (e: Exception) {
            e.message ?: e.toString()
        }
    }

    /** 当前生效图标 id（查系统真实状态，供选择器同步；DEFAULT/其余=默认入口） */
    @JvmStatic
    fun get(ctx: Context): String {
        val pm = ctx.packageManager
        return if (pm.getComponentEnabledSetting(alias) ==
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        ) "thuinfo" else "onethu"
    }
}
