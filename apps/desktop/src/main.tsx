import { StrictMode } from "react";
// 真机密度标记：触屏 + 窄窗 → html.is-phone（CSS 密度层挂此类，不依赖媒体查询细节）
function markPhone(): void {
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia("(pointer: coarse)").matches;
  document.documentElement.classList.toggle("is-phone", touch && window.innerWidth <= 860);
}
markPhone();
window.addEventListener("resize", markPhone);

import { createRoot } from "react-dom/client";
import "@onethu/ui/tokens.css";
import { installAuthWatchdog } from "./lib/reload.js";

installAuthWatchdog();
import "@onethu/ui/base.css";
import "./styles/global.css";
import { App } from "./App.js";
import { applyAppIcon, isAndroid, loadAppIconId } from "./lib/appIcon.js";

// 恢复窗口/任务栏图标：仅桌面（Android 组件状态由系统持久化，重放反而触发桌面重绘）
void isAndroid().then((android) => {
  if (!android) void applyAppIcon(loadAppIconId()).catch(() => undefined);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
declare const __APP_VERSION__: string;
