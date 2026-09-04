/**
 * 新移植 tab 通用三态件与错误分类（电子发票 / 银行代发 / 研究生收入 / 卫生成绩 /
 * 体测成绩 / 教学评估 / 校历 / 空教室 / 校园网 共用）。
 *
 * 铁律（本批移植 tab 一律遵守）：
 * - 空数据 = 友好文案 Empty，绝不显示为错误条；
 * - ServiceUnavailableError = 静态提示「该服务暂不可用（上游服务维护中）」+ 手动重试，
 *   绝不自动整页刷新；
 * - 登录态失效也只落静态提示 + 重试，绝不触发失登自愈（autoFullReload / backToLogin）——
 *   本批 tab 一律不调用 reload.ts / autoFullReload。
 */
import { useEffect, useRef } from "react";
import { ErrorNote, Empty, Card } from "../../components/Layout.js";
import { explainNetworkError } from "../../lib/transport.js";
import { logLine } from "../../lib/clients.js";

/**
 * tab 可见且尚无数据 → 自动补拉（inFlight 防抖：请求悬挂中不叠加）。
 * 背景：聚合页（LifePage 等）的 tab 首次激活后保持挂载（visited + hidden），
 * 切回不重挂——首个 tab 常在启动竞态窗口期完成首次加载且失败，此后无人
 * 重触发，一直空白，用户被迫「切走再切回」才有数据（各 tab 手动补的点）。
 * 两层触发：
 * - 即时：可见且无数据就拉（挂载首跳 + 切走再切回沿）；skipMount=true 时
 *   跳过挂载首跳（tab 自身挂载 effect 已带缓存/TTL 逻辑，如 DormTab）。
 * - 延时：可见且仍无数据，5s 后再试（最多 3 次，成功清零）——启动竞态窗口
 *   通常几秒内结束，首个 tab 无需用户切走再切回即可自愈。
 */
export function useRetryOnVisible(
  visible: boolean,
  settled: boolean,
  load: () => Promise<unknown>,
  opts: { skipMount?: boolean } = {},
): void {
  const inFlight = useRef(false);
  const attempts = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (settled) {
      attempts.current = 0;
      return;
    }
    if (!visible) return;
    if (opts.skipMount && attempts.current === 0) {
      attempts.current = 1; // 挂载首跳交给 tab 自身的缓存/TTL effect
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    void Promise.resolve(loadRef.current()).finally(() => {
      inFlight.current = false;
    });
  }, [visible, settled, load]);

  useEffect(() => {
    if (!visible || settled) return;
    const t = setTimeout(() => {
      if (inFlight.current || attempts.current >= 3) return;
      attempts.current += 1;
      inFlight.current = true;
      void Promise.resolve(loadRef.current()).finally(() => {
        inFlight.current = false;
      });
    }, 5000);
    return () => clearTimeout(t);
  }, [visible, settled]);
}

/** 页内错误落盘（与 DormTab logErr 同款，只写 /tmp/onethu-debug.log） */
export function logTabErr(tag: string, err: unknown): void {
  void logLine(
    "PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err)),
  ).catch(() => undefined);
  // 兜底铁律：宁可硬刷新也不让用户看见红条。20s 窗口内同一 tab 最多自动刷 2 次，
  // 第三次（持续性故障）才落红条，避免刷新死循环。
  // 例外（本文件头部的铁律）：登录态失效与上游维护是「正常状态/已知态」——
  // 只落静态提示 + 手动重试，绝不硬刷新（校园网与统一身份独立，未登录是常态）。
  if (isAuthExpired(err) || isServiceUnavailable(err)) return;
  // 瞬时网络错误（超时/连不上）在手机蜂窝网下高发——整页 reload 会重启全部 tab 的取数，
  // 恶性循环（刷得越频繁越慢）。落红条+手动重试即可，绝不动用核弹级刷新。
  if (isTransientNetworkError(err)) return;
  hardReloadBailOut(tag);
}

/** 瞬时网络错误：传输层抛出的纯网络故障（超时/连不上/DNS），页面状态无恙，重试即愈 */
export function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // 词汇表与 clients.ts isNetworkError 同源（reqwest/invoke 原话），另补浏览器 fetch 措辞
  return /网络错误|timeout|timed? ?out|error sending request|connect|Failed to fetch|Network request failed/i.test(err.message);
}

/** 红条前自动硬刷新守卫：返回 true 表示已触发整页重载（调用方后续 setState 无意义） */
export function hardReloadBailOut(scope: string): boolean {
  try {
    const key = `onethu.bailout.${scope}`;
    const now = Date.now();
    let n = 0;
    let t = 0;
    try {
      const raw = JSON.parse(sessionStorage.getItem(key) ?? "{}") as { n?: number; t?: number };
      if (typeof raw.n === "number" && typeof raw.t === "number" && now - raw.t < 20000) {
        n = raw.n;
        t = raw.t;
      }
    } catch {}
    if (n < 2) {
      sessionStorage.setItem(key, JSON.stringify({ n: n + 1, t: now }));
      window.location.reload();
      return true;
    }
    sessionStorage.setItem(key, JSON.stringify({ n: 0, t: now }));
  } catch {}
  return false;
}

/** 上游维护/下线（core ServiceUnavailableError）：按类名+名称双保险识别 */
export function isServiceUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "ServiceUnavailableError" ||
    err.constructor?.name === "ServiceUnavailableError" ||
    /ServiceUnavailable/i.test(err.message)
  );
}

/** 登录态失效（AuthRequiredError 等）：本批 tab 不自愈，只提示 */
export function isAuthExpired(err: unknown): boolean {
  return err instanceof Error && (err.name === "AuthRequiredError" || /AuthRequired/i.test(err.message));
}

/** 错误 → 页内文案（静态，可重试；绝无自动刷新） */
export function tabErrorText(err: unknown): string {
  if (isAuthExpired(err)) return "登录状态已过期，请重新登录后重试。";
  return explainNetworkError(err);
}

/** 上游维护静态提示（ErrorNote 样式，文案固定 + 手动重试按钮） */
export function UnavailableNote({ onRetry }: { onRetry?: () => void }) {
  return <ErrorNote text="该服务暂不可用（上游服务维护中）" onRetry={onRetry} />;
}

/**
 * tab 统一错误落点：维护态（ServiceUnavailableError）用固定文案，其余用
 * explainNetworkError 文案；两者都是静态提示 + 手动重试，绝不自动整页刷新。
 * 注意 unavailable 是在 catch 时由 err 对象判定的布尔值——错误文案是字符串，
 * 不能再拿它做 instanceof 判定。
 */
export function TabError({
  unavailable,
  text,
  onRetry,
}: {
  unavailable: boolean;
  text: string | null;
  onRetry: () => void;
}) {
  if (unavailable) return <UnavailableNote onRetry={onRetry} />;
  return <ErrorNote text={text ?? ""} onRetry={onRetry} />;
}

/** 友好空态（非错误条） */
export function TabEmpty({ text }: { text: string }) {
  return (
    <Card>
      <Empty text={text} />
    </Card>
  );
}
