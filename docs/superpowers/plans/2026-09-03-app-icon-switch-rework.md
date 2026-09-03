# 应用图标切换重做（v2，legado 方案迁移）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 放弃 PR #20（`feat/app-icon` 分支）的实现，基于 legado-with-MD3 的 `LauncherIconHelp` 机制重新实现 Android 桌面图标运行时切换，并保留桌面端窗口图标切换。

**Architecture:** Android 桌面图标唯一可靠方案是切换 manifest 预置的启动组件启用态（`PackageManager.setComponentEnabledSetting`，legado 同款）。OneTHU 是 Tauri 2 (Rust) + React，Android 侧需经 JNI 调 PackageManager；关键修复是 ① 把 `gen/android` 真实工程纳入版本控制（PR20 里是 Mac 路径 symlink，别名和图标根本不在仓库），② `MainActivity.kt` 补上 `storeActivity`（PR20 缺失，导致 Android 端必然报 "Activity 未注册"）。组件启用状态由系统持久化，**启动时不需要也不应该重新应用**（仅桌面端恢复窗口图标）。

**Tech Stack:** Tauri 2 (Rust + `jni` 0.21 crate)、React + TypeScript、Android Gradle (gen/android, namespace `app.onethu.desktop`)

**Spec:** 本文档即 spec（对照调研：legado `LauncherIconHelp.kt` / `LauncherIconPickerSheet.kt` / AndroidManifest；OneTHU PR #20 全部 diff）

## 参考实现（legado 原文，迁移蓝本）

```kotlin
// io.legado.app.help.LauncherIconHelp（legado-with-MD3）
fun changeIcon(icon: String?) {
    if (icon.isNullOrEmpty()) return
    var hasEnabled = false
    componentNames.forEach {
        if (icon.equals(it.className.substringAfterLast("."), true)) {
            hasEnabled = true
            packageManager.setComponentEnabledSetting(
                it, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        } else {
            packageManager.setComponentEnabledSetting(
                it, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        }
    }
    // 启用了某个别名 → 禁用主入口；否则（默认图标）→ 启用主入口
    packageManager.setComponentEnabledSetting(
        ComponentName(appCtx, MainActivity::class.java.name),
        if (hasEnabled) DISABLED else ENABLED, DONT_KILL_APP)
}
```

legado 的 manifest：每个备用图标一个 `android:enabled="false"`、带 `android:icon` 和完整 LAUNCHER intent-filter 的组件。**先启用目标、再禁用其余**（顺序保证桌面任一时刻都有入口，不会"变砖"）。无重启提示、无启动时恢复——系统持久化组件状态。

## 全局约束

- 仓库：`D:\Mycraft\OneTHU`（remote `origin` = smartThise/OneTHU，`fork` = user-A100/OneTHU）
- OneTHU 是 pnpm monorepo：前端 `apps/desktop`，Tauri 壳 `apps/desktop/src-tauri`，Android 工程 `apps/desktop/src-tauri/gen/android`
- applicationId / namespace：`app.onethu.desktop`（JNI 符号硬编码此包名，不可变）
- Android 目标：minSdk 24 / targetSdk 36；本机 Windows 构建链：`pnpm tauri android build`（或 `gen/android/gradlew assembleUniversalDebug`）
- 一切非图标功能改动（HTTP 错误链展开、panic logger、`onlyBuiltDependencies`）**不得混入**——PR20 的教训之一是 diff 夹带
- UI 文案中文；代码注释密度对齐现有代码（中文、讲 why）

---

### Task 1: 建立干净分支，剥离 PR20 全部改动

**Files:**
- 修改：无（纯 git 操作，从 `main` 重建）

**Interfaces:**
- Produces: 干净分支 `feat/app-icon-v2`，基线 = `origin/main`（HEAD 25d3233）

- [ ] **Step 1: 保留当前现场以备回查，然后切新分支**

当前工作区在 `feat/app-icon` 上有 5 个未提交改动（含重新生成的 `gen/android/`，**这个目录不要删**，Task 2 要用它）。先把它整体挪开备份：

```bash
cd /d/Mycraft/OneTHU
git branch -f feat/app-icon-backup feat/app-icon     # 备份旧分支
git stash push -u -m "wip: regenerated gen/android"  # 暂存未提交改动（含 gen/android 真实目录）
git fetch origin
git checkout -b feat/app-icon-v2 origin/main
```

- [ ] **Step 2: 验证分支干净**

```bash
git status -s          # 期望：空
git log --oneline -1   # 期望：25d3233
grep -c set_app_icon apps/desktop/src-tauri/src/lib.rs   # 期望：0（PR20 已剥离）
ls apps/desktop/src-tauri/gen/ 2>/dev/null || echo "无 gen 目录"   # 期望：无 gen 目录（main 上没有）
```

- [ ] **Step 3: 取回 regen 过的 gen/android（仅此目录，不带其他 stash 内容）**

```bash
git checkout feat/app-icon-backup -- /dev/null 2>/dev/null || true
git stash show --name-only stash@{0} | head   # 查看 stash 内容
# 从 stash 恢复 gen/android 真实目录（untracked 部分在 stash 的第三个 parent 里）：
git checkout stash@{0}^3 -- apps/desktop/src-tauri/gen/ 2>/dev/null || git stash pop
# 若 pop 把其他改动也带回来了，逐个 checkout 掉：
git checkout origin/main -- apps/desktop/src-tauri/Cargo.toml pnpm-workspace.yaml apps/desktop/src-tauri/gen/schemas 2>/dev/null
```

执行后人工确认：`ls apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml` 存在，且 `git status -s` 中 src/lib.rs、Settings.tsx、main.tsx、appIcon.ts 无改动（若 appIcon.ts 出现为新增文件，删除它：`rm apps/desktop/src/lib/appIcon.ts`）。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: baseline feat/app-icon-v2 from main + regenerated gen/android (untracked)"
```

> 注：如果 `gen/schemas/*.json` 的 diff 只是 tauri 重新生成的噪声，一并提交无妨（Task 2 会规整）。

---

### Task 2: gen/android 真实工程纳入版本控制（根因修复 #1）

PR20 的 `gen/android` 是 symlink → `/Users/st/onethu-android`（作者 Mac 路径），仓库里没有任何 Android 工程文件——任何人 clone 后构建出的 APK 没有 activity-alias、没有图标资源，切换必然失败甚至把应用从桌面切没。本任务把真实工程入库（Tauri 官方也建议提交 `gen/` 目录）。

**Files:**
- 删除：`apps/desktop/src-tauri/gen/android`（git 里那条 symlink 记录）
- 新增：`apps/desktop/src-tauri/gen/android/**`（真实 Gradle 工程，构建产物除外）

**Interfaces:**
- Produces: 仓库内完整的 Android 工程；后续所有 Android 侧改动（manifest、mipmap、MainActivity.kt）都在版本控制内进行

- [ ] **Step 1: 确认 gen/android 自带的 .gitignore 能挡住构建产物**

```bash
cat apps/desktop/src-tauri/gen/android/.gitignore
# 期望包含：.gradle/、build/、local.properties、*.iml 等。
# 若没有，写入：
# .gradle/
# **/build/
# local.properties
# *.jks
# *.keystore
```

同时确认 APK 签名密钥**绝不入库**：`git status --porcelain apps/desktop/src-tauri/gen/android | grep -i "keystore\|jks"` 期望为空（keystore 若存在应被 ignore）。

- [ ] **Step 2: 移除 symlink 记录、添加真实工程**

```bash
git rm --cached apps/desktop/src-tauri/gen/android 2>/dev/null || true
git add apps/desktop/src-tauri/gen/
git status -s | wc -l    # 期望：数百（初次入库 Android 工程源文件）
```

- [ ] **Step 3: 验证入库内容不含构建产物**

```bash
git diff --cached --name-only | grep -E "\.gradle/|/build/|\.apk|\.so$" && echo "❌ 有构建产物" || echo "✅ 干净"
```

- [ ] **Step 4: Commit**

```bash
git commit -m "build(android): gen/android 真实工程入库，替换 symlink（PR20 根因修复）"
```

---

### Task 3: AndroidManifest 预置 activity-alias + 图标资源

legado 蓝本：每个备用图标一个 `enabled="false"` 的启动组件，带完整 MAIN/LAUNCHER intent-filter。OneTHU 用 `activity-alias`（比 legado 的子类 Activity 更轻，效果等同）。

**Files:**
- 修改：`apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- 已存在（本地 regen 工程里已放好，Task 2 已入库）：`apps/desktop/src-tauri/gen/android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_thuinfo.png`
- 已存在：`apps/desktop/src-tauri/icons/icon-thuinfo.png`（需从备份分支取回，见 Step 2）

**Interfaces:**
- Produces: 别名组件全限定名 `app.onethu.desktop.MainActivityThuInfo`（manifest 相对名 `.MainActivityThuInfo`）；图标资源 id `@mipmap/ic_launcher_thuinfo`

- [ ] **Step 1: manifest 添加 activity-alias**

在 `<application>` 内、`.MainActivity` 的 `</activity>` 之后添加（如果 regen 工程里已经有这段——之前手工加过——核对属性一致即可）：

```xml
<!-- 应用图标切换（set_app_icon）：THU Info 款，默认禁用，启用时由 PackageManager 接管入口 -->
<activity-alias
    android:name=".MainActivityThuInfo"
    android:targetActivity=".MainActivity"
    android:label="@string/main_activity_title"
    android:icon="@mipmap/ic_launcher_thuinfo"
    android:enabled="false"
    android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter>
</activity-alias>
```

关键点：`android:enabled="false"`（默认禁用，默认入口仍是 `.MainActivity`）；`android:exported="true"`（有 intent-filter 的别名必须显式导出）。

- [ ] **Step 2: 取回桌面图标资产 + Rust 侧 PNG**

```bash
git checkout feat/app-icon-backup -- apps/desktop/src-tauri/icons/icon-thuinfo.png
ls apps/desktop/src-tauri/gen/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_thuinfo.png  # 期望存在
```

若 mipmap 里没有 `ic_launcher_thuinfo.png`（五个密度都要有），从 `icons/icon-thuinfo.png` 生成对应尺寸（48/72/96/144/192px）放入五个目录。

- [ ] **Step 3: 验证（构建期校验）**

```bash
cd apps/desktop/src-tauri/gen/android && ./gradlew assembleUniversalDebug 2>&1 | tail -5
# 期望：BUILD SUCCESSFUL（aapt 会校验 manifest 与资源引用，alias 指向不存在的 icon 会直接报错）
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(android): 预置 MainActivityThuInfo activity-alias（默认禁用）+ 五密度图标"
```

---

### Task 4: MainActivity.storeActivity + Rust JNI 基础设施（根因修复 #2）

PR20 的 Rust 侧等 `MainActivity.storeActivity` 注入 Activity，但 Kotlin 侧从未实现——`ANDROID_ACTIVITY` 恒为 `None`，Android 端 `set_app_icon` 必然报 "Activity 未注册"。本任务补上 Kotlin 侧并把 Rust 基础设施以干净形态加入。

**Files:**
- 修改：`apps/desktop/src-tauri/gen/android/app/src/main/java/app/onethu/desktop/MainActivity.kt`
- 修改：`apps/desktop/src-tauri/src/lib.rs`（仅基础设施部分）
- 修改：`apps/desktop/src-tauri/Cargo.toml`（`jni` 依赖 + tauri `image-png` feature）

**Interfaces:**
- Produces（Rust，供 Task 5 使用）：
  - `static ANDROID_VM: OnceLock<jni::JavaVM>`（`JNI_OnLoad` 填充）
  - `fn android_env() -> Result<jni::JNIEnv, String>`：优先 `vm.get_env()`（IPC 线程已 attach，不 detach）；否则 `attach_current_thread_permanently()`
  - `fn android_activity() -> Result<jni::objects::JObject<'static>, String>`：取全局 Activity 引用，未注册时报 `"Activity 未注册（storeActivity 未调用？）"`

- [ ] **Step 1: MainActivity.kt 调用 storeActivity**

```kotlin
package app.onethu.desktop

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 把自身交给 Rust 侧（set_app_icon 需要 Context 调 PackageManager）。
    // 库已由 TauriActivity 的基类链加载，此处直接调用安全。
    storeActivity()
  }

  private external fun storeActivity()

  companion object {
    init {
      // Tauri 生成的 Rust.kt 已 loadLibrary("onethu_desktop")；本 companion
      // 只是确保 Kotlin 侧 external 声明与 native 库符号匹配
      System.loadLibrary("onethu_desktop")
    }
  }
}
```

> 注意：先查 `gen/android/app/src/main/java/app/onethu/desktop/Rust.kt`（或 TauriActivity）里 `loadLibrary` 的库名（`Cargo.toml` 的 `lib name`，可能是 `onethu_desktop`）。companion 里重复 loadLibrary 无害（dlopen 幂等），但名字必须对。

对应 Rust 符号（包名 `app.onethu.desktop` → 下划线）：

```rust
#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
extern "C" fn Java_app_onethu_desktop_MainActivity_storeActivity(
    env: jni::JNIEnv,
    this: jni::objects::JObject,
) {
    let global = env.new_global_ref(this).ok();
    *ANDROID_ACTIVITY.lock().unwrap() = global;
}
```

- [ ] **Step 2: Cargo.toml 加依赖**

```toml
[dependencies]
# …现有依赖不动…
tauri = { version = "2", features = ["image-png"] }   # 仅追加 feature，版本对齐现有行

[target."cfg(target_os = \"android\")".dependencies]
jni = { version = "0.21", features = ["serde"] }      # features 按现有代码实际用到的裁剪；不需要 serde 就不加
```

（在现有 `tauri = …` 行上追加 `image-png`，不要新开一行重复声明。）

- [ ] **Step 3: lib.rs 加基础设施（放在 `run()` 之前）**

```rust
// —— Android JNI 基础设施（换图标用）——
// wry 0.55 / tao 0.35 不初始化 ndk-context，调 ndk_context::android_context() 必 panic。
// 改为：JNI_OnLoad 捕获 JavaVM；MainActivity.onCreate 调 external fun storeActivity
// 把自身（即 Context）存成 GlobalRef。
#[cfg(target_os = "android")]
static ANDROID_VM: std::sync::OnceLock<jni::JavaVM> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
static ANDROID_ACTIVITY: std::sync::Mutex<Option<jni::objects::GlobalRef>> =
    std::sync::Mutex::new(None);

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
extern "C" fn JNI_OnLoad(
    vm: *mut jni::sys::JavaVM,
    _reserved: *mut std::ffi::c_void,
) -> jni::sys::jint {
    unsafe {
        if let Ok(vm) = jni::JavaVM::from_raw(vm) {
            let _ = ANDROID_VM.set(vm);
        }
    }
    jni::sys::JNI_VERSION_1_6
}

/// 取已 attach 的 JNIEnv；未 attach 的线程永久附加（绝不 attach_current_thread——
/// AttachGuard drop 会 detach IPC 线程，导致后续 JNI 调用 SIGABRT）。
#[cfg(target_os = "android")]
fn android_env() -> Result<jni::JNIEnv<'static>, String> {
    let vm = ANDROID_VM
        .get()
        .ok_or("JavaVM 未初始化（JNI_OnLoad 未跑？）")?;
    match vm.get_env() {
        Ok(env) => Ok(env),
        Err(_) => vm
            .attach_current_thread_permanently()
            .map_err(|e| e.to_string()),
    }
}

/// 当前 Activity（GlobalRef 的生命周期是 'static，as_obj 借用安全）
#[cfg(target_os = "android")]
fn android_activity() -> Result<jni::objects::JObject<'static>, String> {
    ANDROID_ACTIVITY
        .lock()
        .unwrap()
        .as_ref()
        .map(|g| g.as_obj())
        .ok_or_else(|| "Activity 未注册（storeActivity 未调用？）".to_string())
}
```

- [ ] **Step 4: 编译验证**

```bash
cd apps/desktop/src-tauri && cargo check --target aarch64-linux-android 2>/dev/null || cargo check
# 无 Android target 时至少保证桌面侧编译通过：cfg 隔离下桌面构建不受影响
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(android): JNI 基础设施——storeActivity/JavaVM 捕获（PR20 缺失的 Kotlin 侧）"
```

---

### Task 5: set_app_icon / get_app_icon 命令（legado changeIcon 直译）

**Files:**
- 修改：`apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Task 4 的 `android_env()` / `android_activity()`
- Produces（前端契约，Task 6 使用）：
  - `invoke("set_app_icon", { name: "onethu" | "thuinfo" })` → `Promise<null>`（错误为中文消息字符串）
  - `invoke("get_app_icon")` → `Promise<"onethu" | "thuinfo">`（Android 查询真实组件状态；桌面端返回 localStorage 无关的 "onethu"——桌面由前端自己记）
  - `invoke("is_android")` → `Promise<boolean>`

- [ ] **Step 1: Android 侧实现（写入 lib.rs）**

```rust
/// Android 换桌面图标（legado LauncherIconHelp 同款）：切换入口组件启用态。
/// 别名见 gen/android AndroidManifest.xml（.MainActivityThuInfo，默认禁用）。
/// 顺序固定：先启用目标、后禁用另一个——桌面任一时刻都有入口，不会变砖。
/// 组件状态由系统持久化，无需启动时恢复。
#[cfg(target_os = "android")]
#[tauri::command]
fn set_app_icon(name: String) -> Result<(), String> {
    use jni::objects::JValue;

    // 图标 id → 入口组件相对类名
    let (target, other) = match name.as_str() {
        "onethu" => (".MainActivity", ".MainActivityThuInfo"),
        "thuinfo" => (".MainActivityThuInfo", ".MainActivity"),
        other => return Err(format!("未知图标: {other}")),
    };

    let mut env = android_env()?;
    let context = android_activity()?;

    let pm = env
        .call_method(&context, "getPackageManager", "()Landroid/content/PackageManager;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("getPackageManager 失败: {e}"))?;

    let set_component = |env: &mut jni::JNIEnv,
                         class: &str,
                         state: i32|
     -> Result<(), String> {
        let comp_class = env
            .find_class("android/content/ComponentName")
            .map_err(|e| format!("find_class ComponentName 失败: {e}"))?;
        let pkg = env.new_string("app.onethu.desktop").map_err(|e| e.to_string())?;
        let cls = env.new_string(class).map_err(|e| e.to_string())?;
        let comp = env
            .new_object(
                &comp_class,
                "(Ljava/lang/String;Ljava/lang/String;)V",
                &[JValue::Object(&pkg), JValue::Object(&cls)],
            )
            .map_err(|e| format!("new ComponentName 失败: {e}"))?;
        env.call_method(
            &pm,
            "setComponentEnabledSetting",
            "(Landroid/content/ComponentName;II)V",
            &[JValue::Object(&comp), JValue::Int(state), JValue::Int(1 /* DONT_KILL_APP */)],
        )
        .map_err(|e| format!("setComponentEnabledSetting 失败: {e}"))?;
        Ok(())
    };

    const ENABLED: i32 = 1;  // COMPONENT_ENABLED_STATE_ENABLED
    const DISABLED: i32 = 2; // COMPONENT_ENABLED_STATE_DISABLED（legado 同款）
    set_component(&mut env, target, ENABLED)?;
    set_component(&mut env, other, DISABLED)?;
    Ok(())
}

/// Android：查询当前生效的入口组件（选择器 UI 与系统真实状态同步用）
#[cfg(target_os = "android")]
#[tauri::command]
fn get_app_icon() -> Result<String, String> {
    use jni::objects::JValue;
    let mut env = android_env()?;
    let context = android_activity()?;
    let pm = env
        .call_method(&context, "getPackageManager", "()Landroid/content/PackageManager;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("getPackageManager 失败: {e}"))?;
    let comp_class = env
        .find_class("android/content/ComponentName")
        .map_err(|e| e.to_string())?;
    let pkg = env.new_string("app.onethu.desktop").map_err(|e| e.to_string())?;
    let cls = env.new_string(".MainActivityThuInfo").map_err(|e| e.to_string())?;
    let comp = env
        .new_object(
            &comp_class,
            "(Ljava/lang/String;Ljava/lang/String;)V",
            &[JValue::Object(&pkg), JValue::Object(&cls)],
        )
        .map_err(|e| e.to_string())?;
    // getComponentEnabledSetting：ENABLED(1)=别名在用；DEFAULT(0)/其他=默认入口
    let state = env
        .call_method(
            &pm,
            "getComponentEnabledSetting",
            "(Landroid/content/ComponentName;)I",
            &[JValue::Object(&comp)],
        )
        .and_then(|v| v.i())
        .map_err(|e| format!("getComponentEnabledSetting 失败: {e}"))?;
    Ok(if state == 1 { "thuinfo".into() } else { "onethu".into() })
}

#[cfg(target_os = "android")]
#[tauri::command]
fn is_android() -> bool {
    true
}
```

- [ ] **Step 2: 桌面侧实现（对齐 PR20 的可用部分，`#[cfg(not(mobile))]`）**

```rust
/// 桌面：运行时切换主窗口图标。Windows 任务栏即时生效；.exe 文件图标为
/// 编译期资源不可变；macOS 不支持运行时更改（静默 Err）。
#[cfg(not(mobile))]
#[tauri::command]
fn set_app_icon(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let bytes: &[u8] = match name.as_str() {
        "onethu" => include_bytes!("../icons/icon.png"),
        "thuinfo" => include_bytes!("../icons/icon-thuinfo.png"),
        "custom" => return Ok(()), // 自定义走 set_app_icon_custom
        other => return Err(format!("未知图标: {other}")),
    };
    let img = tauri::image::Image::from_bytes(bytes).map_err(|e| e.to_string())?;
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    win.set_icon(img).map_err(|e| e.to_string())
}

/// 桌面自定义图标：前端规整为 256×256 PNG base64 传入（同源数据存 Rust 状态文件）
#[cfg(not(mobile))]
#[tauri::command]
fn set_app_icon_custom(app: tauri::AppHandle, png_b64: String) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_b64.trim())
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    let img = tauri::image::Image::from_bytes(&bytes).map_err(|e| format!("PNG 解码失败: {e}"))?;
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    win.set_icon(img).map_err(|e| e.to_string())
}

/// Android 桌面图标需编译期预置 alias，自定义图标不支持——前端用 is_android 隐藏入口
#[cfg(target_os = "android")]
#[tauri::command]
fn set_app_icon_custom(_app: tauri::AppHandle, _png_b64: String) -> Result<(), String> {
    Err("自定义图标暂仅桌面端支持".into())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn get_app_icon() -> Result<String, String> {
    Ok("onethu".into()) // 桌面选择由前端 localStorage 记账
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn is_android() -> bool {
    false
}
```

- [ ] **Step 3: 注册命令**

在 `tauri::Builder … .invoke_handler(tauri::generate_handler![…])` 的现有列表末尾追加：

```rust
set_app_icon,set_app_icon_custom,get_app_icon,is_android
```

- [ ] **Step 4: 编译验证**

```bash
cd apps/desktop/src-tauri && cargo check
# 期望：无错误（桌面目标全绿；Android 代码被 cfg 隔离，语法由 Android 构建验证）
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: set_app_icon/get_app_icon——Android 切换入口组件启用态（legado 同款），桌面窗口图标"
```

---

### Task 6: 前端 appIcon.ts 重写（启动不恢复 + 真实状态同步）

与 PR20 的两个行为差异（均来自 legado 调研结论）：
1. **Android 启动时不重新应用图标**——`setComponentEnabledSetting` 由系统持久化，重复设置只会触发 PackageManager 写操作和潜在桌面重绘。桌面端窗口图标是进程内状态，仍需启动恢复。
2. **Android 选择器初始值读系统真实状态**（`get_app_icon`），不信 localStorage——防止两者脱节（如恢复出厂、清除数据后 manifest 默认态）。

**Files:**
- 新建：`apps/desktop/src/lib/appIcon.ts`
- 修改：`apps/desktop/src/main.tsx`

**Interfaces:**
- Consumes: Task 5 的 `set_app_icon` / `set_app_icon_custom` / `get_app_icon` / `is_android`；现有 `state_read/state_write/state_delete`；现有 `isTauri`（`./transport.js`）
- Produces（Settings.tsx / main.tsx 使用）：
  - `APP_ICON_OPTIONS: AppIconOption[]`、`CUSTOM_ICON_ID = "custom"`
  - `isAndroid(): Promise<boolean>`
  - `currentAppIconId(): Promise<string>` — Android 查系统，桌面读 localStorage
  - `applyAppIcon(id: string): Promise<void>` — 持久化 + invoke
  - `saveCustomIcon(file: File)` / `loadCustomIconB64()` / `removeCustomIcon()`

- [ ] **Step 1: 写 appIcon.ts（完整文件）**

```typescript
/**
 * 应用图标（设置 → 主题）。
 * 桌面：运行时换主窗口/任务栏图标，选择记 localStorage，启动时恢复。
 * Android：切换 manifest 预置的入口组件（legado 同款），系统持久化组件
 * 状态——启动时不重放（重放只会触发 PackageManager 写操作），选择器
 * 初始值以 get_app_icon 查询的真实状态为准。自定义图标仅桌面端。
 * 非 Tauri 环境（浏览器预览）只记账、不 invoke。
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./transport.js";
import { logLine } from "./clients.js";

const KEY = "onethu.app-icon.v1";
const STATE_NAME = "onethu.app-icon.custom";
export const CUSTOM_ICON_ID = "custom";

import iconOnethu from "../../src-tauri/icons/icon.png";
import iconThuinfo from "../../src-tauri/icons/icon-thuinfo.png";

export interface AppIconOption {
  id: string;
  label: string;
  src: string;
}

/** 内置图标注册表：新增 = icons/ 放 PNG + Rust match 加一行 + alias/mipmap + 这里加一行 */
export const APP_ICON_OPTIONS: AppIconOption[] = [
  { id: "onethu", label: "OneTHU 默认", src: iconOnethu },
  { id: "thuinfo", label: "THU Info", src: iconThuinfo },
];

export async function isAndroid(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    return await invoke<boolean>("is_android");
  } catch {
    return false;
  }
}

/**
 * 当前图标 id：Android 查系统真实组件状态（不信本地账本）；桌面读 localStorage。
 */
export async function currentAppIconId(): Promise<string> {
  if (isTauri) {
    try {
      return await invoke<string>("get_app_icon");
    } catch {
      /* 查询失败退回本地账本 */
    }
  }
  return loadLocalIconId();
}

function loadLocalIconId(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (v === CUSTOM_ICON_ID || APP_ICON_OPTIONS.some((o) => o.id === v))) return v;
  } catch {
    /* 隐私模式等读取失败按默认 */
  }
  return "onethu";
}

/** 应用图标（即时生效）。Android 上失败要浮给用户看（不只是日志）。 */
export async function applyAppIcon(id: string): Promise<void> {
  const known = id === CUSTOM_ICON_ID || APP_ICON_OPTIONS.some((o) => o.id === id);
  if (!known) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 忽略 */
  }
  if (!isTauri) return;
  try {
    if (id === CUSTOM_ICON_ID) {
      const b64 = await loadCustomIconB64();
      if (b64) await invoke("set_app_icon_custom", { pngB64: b64 });
    } else {
      await invoke("set_app_icon", { name: id });
    }
  } catch (err) {
    void logLine(`APP-ICON ${err instanceof Error ? err.message : String(err)}`).catch(
      () => undefined,
    );
    throw err; // 交调用方决定是否提示用户
  }
}

export async function loadCustomIconB64(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const v = await invoke<string | null>("state_read", { name: STATE_NAME });
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** 图片文件 → 居中裁方 → 256×256 PNG base64 */
async function fileToPngB64(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("图片解码失败，请换一张 PNG/JPG"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const SIZE = 256;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画布初始化失败");
    ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
    const dataUrl = canvas.toDataURL("image/png");
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (b64.length > 512 * 1024) throw new Error("图片处理后仍过大，请换一张");
    return b64;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function saveCustomIcon(file: File): Promise<void> {
  const b64 = await fileToPngB64(file);
  if (isTauri) await invoke("state_write", { name: STATE_NAME, content: b64 });
  await applyAppIcon(CUSTOM_ICON_ID);
}

export async function removeCustomIcon(): Promise<void> {
  if (isTauri) {
    try {
      await invoke("state_delete", { name: STATE_NAME });
    } catch {
      /* 文件不存在等，忽略 */
    }
  }
  if (loadLocalIconId() === CUSTOM_ICON_ID) await applyAppIcon("onethu");
}
```

- [ ] **Step 2: main.tsx 仅桌面恢复窗口图标**

```tsx
// 替换 PR20 版本的三行（若 main.tsx 当前无此逻辑则新增到入口处）：
import { applyAppIcon, isAndroid, loadAppIconId } from "./lib/appIcon.js";

// 恢复窗口/任务栏图标：仅桌面（Android 组件状态由系统持久化，重放反而触发桌面重绘）
void isAndroid().then((android) => {
  if (!android) void applyAppIcon(loadAppIconId()).catch(() => undefined);
});
```

> `loadAppIconId` 即上面 appIcon.ts 的 `loadLocalIconId`——为对齐 main.tsx 现有导入名，导出名保留 `loadAppIconId`（把 `loadLocalIconId` 改为同时 `export function loadAppIconId()`，内部改名对应）。

- [ ] **Step 3: 类型检查**

```bash
cd apps/desktop && pnpm exec tsc --noEmit
# 期望：无错误（Settings.tsx 此刻还没接上，若它导入了不存在的方法先跳过其检查：本任务不改动 Settings.tsx）
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): appIcon.ts——Android 不启动重放、选择器同步系统真实状态、仅桌面恢复窗口图标"
```

---

### Task 7: Settings.tsx 选择器 UI（Android 隐藏自定义上传）

**Files:**
- 修改：`apps/desktop/src/pages/Settings.tsx`（主题段落，参考 PR20 版 UI 磁贴布局：157 行增量，从备份分支抄结构、按新接口改调用）

**Interfaces:**
- Consumes: Task 6 的全部导出

- [ ] **Step 1: 从备份分支取出 PR20 的 Settings.tsx 增量做底稿**

```bash
git diff main...feat/app-icon-backup -- apps/desktop/src/pages/Settings.tsx > /tmp/settings-pr20.patch
```

手工核对移植，改四处：
1. 初始选中值从 `loadAppIconId()`（同步读 localStorage）改为 `useEffect` 里 `void currentAppIconId().then(setSelected)`（异步查系统）；
2. `applyAppIcon(o.id)` 调用处加 `.catch` 浮错（Android 切换失败必须让用户知道，否则以为切成功了）：

```tsx
void applyAppIcon(o.id).catch((err) => {
  setErrorMsg(err instanceof Error ? err.message : String(err)); // 或项目现有 toast/错误条
});
```

3. 「+」上传与右键删除区包一层 `{!android && (…)}`，`android` 来自 `useState(false)` + `useEffect(() => { void isAndroid().then(setAndroid); }, [])`；
4. Android 下在选择器下方加说明文案：`切换后桌面图标可能需几秒刷新；部分系统会重启应用，属正常现象`。

- [ ] **Step 2: 手工验证（桌面浏览器 `pnpm dev`）**

- 主题 → 应用图标：两块磁贴 + 「+」；点选有高亮；上传图片后磁贴出现第三块"自定义"。
- 浏览器（非 Tauri）下点选不报错（只记账）。

- [ ] **Step 3: 类型检查 + 桌面构建**

```bash
cd apps/desktop && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): 设置→主题→应用图标选择器；Android 隐藏自定义上传并提示桌面刷新延迟"
```

---

### Task 8: Android 构建与真机验证

**Files:** 无新改动（验证任务；发现问题回到对应 Task 修）

- [ ] **Step 1: 构建 APK**

```bash
cd /d/Mycraft/OneTHU
pnpm tauri android build --target aarch64 -- --variant debug   # 或按项目现有构建脚本（查 package.json scripts）
# 产物：apps/desktop/src-tauri/gen/android/app/build/outputs/apk/…/debug/*.apk
```

- [ ] **Step 2: 安装并验证初始状态**

```bash
adb install -r <apk路径>
adb shell dumpsys package app.onethu.desktop | grep -A1 "Component Enabled"
# 期望：MainActivityThuInfo 为 disabled（manifest 默认），桌面图标为 OneTHU 默认款
```

- [ ] **Step 3: 应用内切换到 THU Info 并验证**

- 设置 → 主题 → 应用图标 → 点 THU Info → **期望无崩溃**（PR20 在此必报错，因 storeActivity 缺失）。
- 验证组件状态：

```bash
adb shell dumpsys package app.onethu.desktop | grep -B1 -A1 "MainActivityThuInfo"
# 期望：enabled=true；.MainActivity disabled=true
```

- 桌面图标在几秒内变为 THU Info 款（部分启动器需划走再回桌面）。**杀进程重启 app：图标仍是 THU Info，且 logcat 无重放调用**（`adb logcat -s ONETHU` 不应出现 setComponentEnabledSetting 相关错误）。

- [ ] **Step 4: 切回默认并验证**（防"变砖"回归）

同 Step 3，期望恢复 OneTHU 默认图标、`.MainActivity` enabled。

- [ ] **Step 5: 卸载重装验证初始态**

```bash
adb uninstall app.onethu.desktop && adb install <apk>
# 期望：默认图标（manifest 默认态），选择器初始选中「OneTHU 默认」（get_app_icon 查询正确）
```

- [ ] **Step 6: 最终提交（若有修补）+ 推送开 PR**

```bash
git push fork feat/app-icon-v2
# 用 gh 开 PR 到 smartThise/OneTHU main：
gh pr create --repo smartThise/OneTHU --head user-A100:feat/app-icon-v2 --title "feat(theme): 应用图标切换 v2——gen/android 入库 + activity-alias（legado 方案）" --body "关闭并取代 #20。修复：① gen/android 真实工程入库（原为 symlink，alias 不在仓库）② MainActivity.storeActivity 缺失导致 Android 必报“Activity 未注册” ③ Android 启动不再重放图标设置（系统已持久化）④ 选择器同步系统真实组件状态。"
```

---

## Self-Review 结论

- **Spec 覆盖**：用户诉求 = 剥离 PR20（Task 1）、借鉴 legado 重实现（Task 3/5 即 legado `changeIcon` 直译，先启用后禁用防变砖）、修复手机端不可用（Task 2/4 即两大根因）、便捷入口（Task 7 设置→主题，对齐 legado 的设置→外观位置）。✅
- **PR20 遗产处置**：桌面窗口图标切换（Task 5 桌面部分）与 JNI 基础设施（Task 4）经修正后保留——它们本身正确；夹带的 HTTP 错误链/panic logger/onlyBuiltDependencies 不迁移（留在备份分支 `feat/app-icon-backup` 可随时找回）。✅
- **类型一致性**：`set_app_icon(name)`/`get_app_icon()`/`is_android()` 在 Task 5（Rust）与 Task 6（TS invoke）签名一致；`applyAppIcon` 在 Task 6 定义、Task 7 消费，`loadAppIconId` 导出名与 main.tsx 导入对齐。✅
- **风险点**：Task 1 Step 3 的 stash 恢复操作依赖 stash 内容形态，执行者需按实际 `git stash show` 输出判断——已给出两条路径。`is_android()` 桌面版恒 false、Android 版恒 true，无跨 cfg 冲突。
