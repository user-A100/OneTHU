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
    private val aliases = mapOf(
        "thuinfo" to ComponentName("app.onethu.desktop", "app.onethu.desktop.MainActivityThuInfo"),
        "mascot" to ComponentName("app.onethu.desktop", "app.onethu.desktop.MainActivityMascot"),
    )
    private val all = listOf(main) + aliases.values

    /** @return 空串=成功，否则错误消息（透传给前端提示） */
    @JvmStatic
    fun set(ctx: Context, name: String): String {
        return try {
            val pm = ctx.packageManager
            val target = if (name == "onethu") main else aliases[name] ?: return "未知图标: $name"
            // 先启用目标、后禁用其余——桌面任一时刻都有入口，不会变砖。
            // 组件状态由系统持久化，启动时无需重放。
            pm.setComponentEnabledSetting(
                target, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP
            )
            all.filter { it != target }.forEach {
                pm.setComponentEnabledSetting(
                    it, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP
                )
            }
            ""
        } catch (e: Exception) {
            e.message ?: e.toString()
        }
    }

    /** 当前生效图标 id（查系统真实状态，供选择器同步；别名未启用=默认入口） */
    @JvmStatic
    fun get(ctx: Context): String {
        val pm = ctx.packageManager
        return aliases.entries.firstOrNull {
            pm.getComponentEnabledSetting(it.value) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        }?.key ?: "onethu"
    }
}
