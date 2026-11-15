"use client";

import * as React from "react";

import { Menu, MoreHorizontal, PanelRight } from "lucide-react";

import { AppFrame, useAppLayout } from "@/components/layout/app-frame";
import { NewSidebar } from "@/components/layout/new-sidebar";
import { RightPanel } from "@/components/layout/right-panel";

import styles from "./preview.module.css";

function PreviewWorkspace() {
  const { sidebarCollapsed, rightOpen, toggleSidebar, toggleRight } = useAppLayout();

  return (
    <div className={styles.main}>
      <header className={styles.header}>
        <div className={styles.crumb}>任务 / Acme 外网渗透</div>
        <div className={styles.titleRow}>
          <button type="button" className={styles.iconButton} onClick={toggleSidebar} title="折叠侧边栏 (Ctrl+B)" aria-label="折叠侧边栏" aria-expanded={!sidebarCollapsed} data-testid="toggle-sidebar">
            <Menu size={16} />
          </button>
          <h1 className={styles.title}>Acme 外网渗透</h1>
          <span className={styles.status}><span className={styles.statusDot} />运行中</span>
          <span className={styles.meta}>DeepSeek V4 · 128k tokens</span>
          <span className={styles.mode}>极简模式</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.textButton}>暂停</button>
          <button type="button" className={styles.iconButton} onClick={toggleRight} title="右侧栏 (Ctrl+Shift+B)" aria-label="切换右侧检查器" aria-expanded={rightOpen} data-testid="toggle-right">
            <PanelRight size={16} />
          </button>
          <button type="button" className={styles.iconButton} title="更多"><MoreHorizontal size={16} /></button>
        </div>
      </header>

      <nav className={styles.tabs}>
        <span className={`${styles.tab} ${styles.tabActive}`}>对话</span>
        <span className={styles.tab}>轨迹</span>
        <span className={styles.tab}>探索图</span>
        <span className={styles.tab}>发现</span>
        <span className={styles.tab}>报告</span>
      </nav>

      <section className={styles.conversation}>
        <div className={styles.chatColumn}>
          <div className={styles.userRow}>
            <div className={styles.bubble}>先确认 acme.com 后台的入口与权限边界。</div>
          </div>

          <div className={styles.assistant}>
            <p>我会先做被动信息收集，再对后台入口做低强度验证。</p>
            <p>已发现 3 个候选入口，下面先核对登录页与 API 网关。</p>
          </div>

          <div className={styles.codeBlock}>
            <div className={styles.codeHead}><span>bash · 输出</span><span>展开</span></div>
            <pre>{`Starting Nmap 7.95 ( https://nmap.org )
PORT    STATE SERVICE
80/tcp  open  http
443/tcp open  https
8080/tcp open  http-proxy`}</pre>
          </div>

          <div className={styles.process}>
            <div className={styles.processHead}><span>执行过程 · 4 步 · 12.4s</span><span>⌄</span></div>
            <div className={styles.processRow}>
              <span className={styles.toolIcon}>$_</span><span className={styles.toolName}>bash</span>
              <span className={styles.toolSummary}>nmap -sV -T2 acme.com</span><span className={`${styles.state} ${styles.stateDone}`}>完成</span>
            </div>
            <div className={styles.processRow}>
              <span className={styles.toolIcon}>↗</span><span className={styles.toolName}>http_request</span>
              <span className={styles.toolSummary}>GET /api/orders · 200 OK</span><span className={`${styles.state} ${styles.stateDone}`}>完成</span>
            </div>
            <div className={styles.processRow}>
              <span className={styles.toolIcon}>$_</span><span className={styles.toolName}>bash</span>
              <span className={styles.toolSummary}>curl -X POST /admin/login</span><span className={`${styles.state} ${styles.stateWait}`}>待审批</span>
            </div>
            <div className={styles.moreHint}>展开查看完整命令与响应 · 证据自动关联到流量面板</div>
          </div>

          <div className={styles.approval}>
            <div className={styles.approvalTitle}>Bash 请求审批</div>
            <div className={styles.approvalBody}>命令将向目标发送登录请求，可能触发账号锁定策略。</div>
            <div className={styles.approvalActions}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`}>拒绝</button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`}>允许一次</button>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.composerWrap}>
        <div className={styles.composer}>
          <div className={styles.composerInput}>输入指令，或输入 / 查看命令…</div>
          <div className={styles.composerBar}>
            <span className={styles.model}>DeepSeek V4</span>
            <span>审批模式：询问</span>
            <span>128k</span>
            <span className={styles.spacer} />
            <button type="button" className={styles.send}>↑</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UiPreviewPage() {
  return (
    <AppFrame
      // NewSidebar reads the task id via useSearchParams, which requires a
      // Suspense boundary under static export.
      sidebar={
        <React.Suspense fallback={null}>
          <NewSidebar />
        </React.Suspense>
      }
      rightPanel={
        <React.Suspense fallback={null}>
          <RightPanel />
        </React.Suspense>
      }
      defaultRightOpen
    >
      <PreviewWorkspace />
    </AppFrame>
  );
}
