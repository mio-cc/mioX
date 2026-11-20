"use client";

/**
 * Version and self-update block for the General settings page: the running
 * backend version, the auth-gate fact, the latest release, the live download
 * progress and the three actions the legacy settings page offered.
 *
 * Everything that changes the process — download, apply, rollback — sits behind
 * a confirmation and is disabled until the backend reports a comparable,
 * downloadable release, so a `dev` build never offers it.
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Tag } from "@/vendor/dsh/primitives/Tag";
import {
  IconDownloadOutlineRegular,
  IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
  IconWarningTriangleOutlineRegular,
} from "@/vendor/dsh/primitives/icons/index";

import type { UpdateProgress } from "@/lib/types";
import { useUpdate } from "@/v2/data/update";
import { toast } from "./Toast";
import css from "./UpdateSection.module.css";

/** Short wall-clock label for the "last checked" row. */
function clockLabel(at: Date): string {
  return at.toLocaleTimeString("zh-CN", { hour12: false });
}

/** Human byte size, matching the legacy card's formatting. */
function humanSize(n?: number): string {
  if (n === undefined || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** One line of text for the current update phase. */
function progressText(progress: UpdateProgress): string {
  switch (progress.phase) {
    case "idle":
      return "空闲";
    case "downloading":
      return progress.percent >= 0 ? `下载中 ${progress.percent}%` : "下载中…";
    case "verifying":
      return "校验 SHA256…";
    case "extracting":
      return "解压并冒烟测试…";
    case "staged":
      return "新版本已就绪，等待重启并应用…";
    case "failed":
      return `更新失败：${progress.error ?? progress.message}`;
    default:
      return progress.message;
  }
}

export function UpdateSection(): React.ReactNode {
  const update = useUpdate();
  return <UpdateSectionView update={update} />;
}

/**
 * 与 `useUpdate()` 的订阅解耦的呈现层（C22）：通用页要用**同一个**订阅同时驱动
 * 本卡片和「更新完成后等待重启并刷新」那一行，避免开两条 /update/stream。
 * @param update - 调用方传入的更新状态。
 */
export function UpdateSectionView({ update }: { update: ReturnType<typeof useUpdate> }): React.ReactNode {
  const [checkedAt, setCheckedAt] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const autoChecked = React.useRef(false);

  const { check, phase, refresh } = update;

  // Entering the page compares against the cached release list (the legacy
  // card did the same); the button below forces a fresh GitHub lookup.
  React.useEffect(() => {
    if (autoChecked.current) return;
    autoChecked.current = true;
    void refresh(false).then(() => setCheckedAt(clockLabel(new Date())));
  }, [refresh]);

  const runCheck = (): void => {
    setFailure(null);
    void refresh(true).then((next) => {
      setCheckedAt(clockLabel(new Date()));
      if (next === null) {
        toast("检查更新失败");
        return;
      }
      if (next.error) toast(`检查更新失败：${next.error}`);
      else if (next.has_update) toast(`发现新版本 ${next.latest ?? ""}`);
      else if (next.comparable) toast("当前已是最新版本");
      else toast(next.reason ?? "当前版本不是正式发布版本，已禁用一键更新");
    });
  };

  const applyNow = (): void => {
    if (check === null) return;
    const target = check.latest ?? "最新版本";
    if (!window.confirm(`确定更新到 ${target}？\n\n更新会重启程序，正在运行的任务会被中断。`)) return;
    setBusy(true);
    setFailure(null);
    void update.apply().then((error) => {
      setBusy(false);
      if (error !== null) setFailure(`启动更新失败：${error}`);
      else toast("已开始下载新版本，进度见上方状态");
    });
  };

  const rollbackNow = (): void => {
    if (
      !window.confirm(
        "回滚到上一版本？\n\n程序会重启，正在运行的任务会被中断。\n注意：数据库结构不会回退，旧版本可能无法识别新版写入的数据。",
      )
    )
      return;
    setBusy(true);
    setFailure(null);
    void update.rollback().then((error) => {
      setBusy(false);
      if (error !== null) setFailure(`回滚失败：${error}`);
      else toast("已切换到上一版本，正在重启…");
    });
  };

  const progress = update.progress;
  const active = progress !== null && progress.phase !== "idle";
  const downloading = progress !== null && progress.phase === "downloading";
  // Only the download phase knows its percentage; later phases are unknown
  // length, so the bar fills and pulses while the process works.
  const percent = downloading ? Math.max(progress.percent, 0) : 100;
  const latest = check?.latest;
  const canApply = check?.has_update === true && check.asset_available !== false;
  const serviceLabel = phase === "loading" ? "检查中…" : phase === "ready" ? "已连接" : "连接失败";
  const authLabel =
    update.auth === null
      ? "未知"
      : update.auth.authDisabled
        ? "已关闭密码登录（本机直连）"
        : update.auth.initialized
          ? "需要密码登录"
          : "未初始化密码";

  return (
    <section className={css.section} role="group" aria-label="版本与更新">
      <h3 className={css.title}>版本与更新</h3>
      <p className={css.lead}>从 GitHub 检查并安装新版本。更新会重启程序，正在运行的任务会被中断。</p>

      <div className={css.statusList}>
        <div className={css.statusRow}>
          <span className={css.statusLabel}>当前版本</span>
          <span className={css.statusValue} data-field="current-version">
            <span className={css.mono}>{update.host?.version ?? "…"}</span>
            {check !== null ? (
              <>
                <Tag tone="neutral">{`${check.os}/${check.arch}`}</Tag>
                <Tag tone="neutral">{check.mode === "docker" ? "Docker" : "独立程序"}</Tag>
              </>
            ) : null}
          </span>
        </div>
        <div className={css.statusRow}>
          <span className={css.statusLabel}>服务状态</span>
          <span className={css.statusValue} data-field="service">
            <span className={css.dot} data-state={phase === "ready" ? "ok" : phase === "loading" ? "wait" : "bad"} />
            {serviceLabel}
            <Button variant="ghost" size="sm" className={css.inlineBtn} onClick={update.reload}>
              重新读取
            </Button>
          </span>
        </div>
        {latest !== undefined ? (
          <div className={css.statusRow}>
            <span className={css.statusLabel}>最新版本</span>
            <span className={css.statusValue} data-field="latest">
              <Tag tone={check?.has_update === true ? "warning" : "neutral"}>{latest}</Tag>
              {check?.html_url !== undefined ? (
                <a className={css.link} href={check.html_url} target="_blank" rel="noreferrer">
                  <IconLinkOutlineRegular size={12} />
                  更新日志
                </a>
              ) : null}
            </span>
          </div>
        ) : null}
        <div className={css.statusRow}>
          <span className={css.statusLabel}>登录方式</span>
          <span className={css.statusValue} data-field="auth">
            {authLabel}
          </span>
        </div>
        <div className={css.statusRow}>
          <span className={css.statusLabel}>检查时间</span>
          <span className={css.statusValue} data-field="checked-at">
            <span className={css.dim}>{checkedAt ?? "—"}</span>
          </span>
        </div>
        {active && progress !== null ? (
          <div className={css.statusRow}>
            <span className={css.statusLabel}>更新状态</span>
            <span className={css.statusValue} data-field="update-phase">
              {progressText(progress)}
            </span>
          </div>
        ) : null}
      </div>

      {active ? (
        <div className={css.progressWrap}>
          <div className={css.progressTrack} data-pulse={downloading ? "off" : "on"}>
            <div className={css.progressFill} style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : null}

      {check?.boot_notice !== undefined && check.boot_notice !== "" ? (
        <p className={css.notice}>
          <IconWarningTriangleOutlineRegular size={14} />
          {check.boot_notice}
        </p>
      ) : null}

      {check?.error !== undefined ? (
        <p className={css.notice} data-tone="bad">
          <IconWarningTriangleOutlineRegular size={14} />
          {`无法连接 GitHub：${check.error}　可在设置中配置全局代理后重试。`}
        </p>
      ) : null}

      {check !== null && check.comparable === false && check.reason !== undefined ? (
        <p className={css.hint}>{check.reason}</p>
      ) : null}

      {check?.has_update === true && check.asset_available === false ? (
        <p className={css.notice} data-tone="bad">
          <IconWarningTriangleOutlineRegular size={14} />
          {`${latest ?? ""} 没有提供 ${check.os}/${check.arch} 的发布包（缺少 ${check.asset ?? ""}），无法自动更新。`}
        </p>
      ) : null}

      {canApply ? (
        <p className={css.hint}>
          {`将下载 ${check?.asset ?? ""}`}
          {humanSize(check?.size) === "" ? "" : `（${humanSize(check?.size)}）`}
          {"，校验 SHA256 并冒烟测试后才会替换，失败自动保留当前版本。"}
        </p>
      ) : null}

      {check !== null && check.has_update !== true && check.comparable === true && check.error === undefined ? (
        <p className={css.hint}>当前已是最新版本。</p>
      ) : null}

      {check?.mode === "docker" && check.has_update === true ? (
        <p className={css.hint}>
          Docker 下的更新只替换程序本身，不更新镜像里的 playwright / nmap 等工具链，且 docker compose up -d
          重建容器后会退回镜像自带的版本。需要连镜像一起升级请执行 docker compose pull artex &amp;&amp; docker compose up -d
          artex。
        </p>
      ) : null}

      {failure !== null ? <p className={css.notice} data-tone="bad">{failure}</p> : null}

      <div className={css.actions}>
        <Button variant="outline" size="sm" onClick={runCheck} disabled={update.checking || busy}>
          <IconRefreshOutlineRegular size={14} />
          {update.checking ? "检查中…" : "检查更新"}
        </Button>
        <Button variant="primary" size="sm" onClick={applyNow} disabled={!canApply || busy}>
          <IconDownloadOutlineRegular size={14} />
          {check?.has_update === true && latest !== undefined ? `更新到 ${latest}` : "立即更新"}
        </Button>
        {check?.has_backup === true ? (
          <Button variant="ghost" size="sm" onClick={rollbackNow} disabled={busy}>
            回滚到上一版本
          </Button>
        ) : null}
      </div>

      <p className={css.hint}>
        一键更新依赖守护脚本重启程序。请通过 start.sh（Windows 为 start.bat）启动；直接运行 artex
        本体时，程序退出后不会被自动拉起。
      </p>
    </section>
  );
}
