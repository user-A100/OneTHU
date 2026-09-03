/**
 * 应用图标（设置 → 主题）。
 * 桌面：运行时换主窗口/任务栏图标，选择记 localStorage，启动时恢复。
 * Android：切换 manifest 预置的入口组件（legado LauncherIconHelp 同款），
 * 组件状态由系统持久化——启动时不重放（重放只会触发 PackageManager 写
 * 操作和潜在桌面重绘），选择器初始值以 get_app_icon 查询的真实状态为准。
 * 自定义图标仅桌面端。非 Tauri 环境（浏览器预览）只记账、不 invoke。
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./transport.js";
import { logLine } from "./clients.js";

const KEY = "onethu.app-icon.v1";
const STATE_NAME = "onethu.app-icon.custom";
export const CUSTOM_ICON_ID = "custom";

/** 缩略图直接引用 src-tauri/icons 下的同一 PNG（Vite 构建期内联） */
import iconOnethu from "../../src-tauri/icons/icon.png";
import iconThuinfo from "../../src-tauri/icons/icon-thuinfo.png";
import iconMascot from "../../src-tauri/icons/icon-mascot.png";

export interface AppIconOption {
  id: string;
  label: string;
  src: string;
}

/** 内置图标注册表：新增 = icons/ 放 PNG + Rust/Kotlin match 加一行 + alias/mipmap + 这里加一行 */
export const APP_ICON_OPTIONS: AppIconOption[] = [
  { id: "onethu", label: "OneTHU 默认", src: iconOnethu },
  { id: "thuinfo", label: "THU Info", src: iconThuinfo },
  { id: "mascot", label: "看板娘", src: iconMascot },
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
 * 当前图标 id：Android 查系统真实组件状态（不信本地账本，防脱节）；
 * 桌面读 localStorage。
 */
export async function currentAppIconId(): Promise<string> {
  if (isTauri) {
    try {
      return await invoke<string>("get_app_icon");
    } catch {
      /* 查询失败退回本地账本 */
    }
  }
  return loadAppIconId();
}

export function loadAppIconId(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (v === CUSTOM_ICON_ID || APP_ICON_OPTIONS.some((o) => o.id === v))) return v;
  } catch {
    /* 隐私模式等读取失败按默认 */
  }
  return "onethu";
}

/** 应用图标（即时生效）；Android 上失败抛给调用方决定是否提示用户 */
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
    throw err;
  }
}

/** 读回已保存的自定义图标（base64 PNG，无则 null） */
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
    const SIZE = 256; // 任务栏图标足够；过大只会浪费状态文件体积
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

/** 上传自定义图标：规整 → 持久化（状态文件）→ 应用并记录选择 */
export async function saveCustomIcon(file: File): Promise<void> {
  const b64 = await fileToPngB64(file);
  if (isTauri) await invoke("state_write", { name: STATE_NAME, content: b64 });
  await applyAppIcon(CUSTOM_ICON_ID);
}

/** 移除自定义图标：删状态文件；若当前正用在用它则回退默认 */
export async function removeCustomIcon(): Promise<void> {
  if (isTauri) {
    try {
      await invoke("state_delete", { name: STATE_NAME });
    } catch {
      /* 文件不存在等，忽略 */
    }
  }
  if (loadAppIconId() === CUSTOM_ICON_ID) await applyAppIcon("onethu");
}
