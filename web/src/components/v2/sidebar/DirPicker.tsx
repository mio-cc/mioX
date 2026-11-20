"use client";

/**
 * 工作目录选择器（对照表 P1:A8、P1:A11 的目录部分）。
 * 旧页面依据：ARTEX/web/src/app/(main)/function/tasks/new/dir-picker.tsx:23-154。
 * 浏览器拿不到真实文件系统路径，所以逐级浏览服务端目录（`GET /fs/dirs`），返回绝对路径。
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Modal } from "@/vendor/dsh/primitives/Modal";
import { listDirs, type DirListing } from "@/v2/data/task-create";

import css from "./DirPicker.module.css";

const EMPTY: DirListing = { path: "", parent: "", roots: [], entries: [] };

/**
 * 渲染目录选择器。
 * @param props.open - 是否显示。
 * @param props.initial - 初始路径；空串表示从根目录开始。
 * @param props.onClose - 取消。
 * @param props.onPick - 选中某个绝对路径。
 * @returns 弹窗，或关闭时为 null。
 */
export function DirPicker({
  open,
  initial,
  onClose,
  onPick,
}: {
  open: boolean;
  initial: string;
  onClose: () => void;
  onPick: (path: string) => void;
}): ReactNode {
  const [listing, setListing] = useState<DirListing>(EMPTY);
  const [manual, setManual] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((next: string): void => {
    setLoading(true);
    setError(null);
    listDirs(next)
      .then((value) => {
        setListing(value);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        setLoading(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  // 每次打开都从传入的初始路径重新列一次；手动输入框同步到初始值。
  useEffect(() => {
    if (!open) return;
    setManual(initial);
    load(initial);
  }, [open, initial, load]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="选择工作目录"
      closeLabel="关闭"
      description="浏览服务器上的目录，选中后回填到新建任务表单。"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={listing.path === ""}
            data-dirpicker-pick=""
            onClick={() => {
              onPick(listing.path);
              onClose();
            }}
          >
            选择此目录
          </Button>
        </>
      }
    >
      <div className={css.wrap} data-dirpicker="">
        <div className={css.pathRow}>
          <Button
            variant="outline"
            size="sm"
            disabled={listing.parent === ""}
            aria-label="上一级"
            data-dirpicker-up=""
            onClick={() => load(listing.parent)}
          >
            上一级
          </Button>
          <input
            className={css.pathInput}
            value={manual}
            placeholder="输入绝对路径后回车"
            aria-label="目录路径"
            data-dirpicker-path=""
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                load(manual.trim());
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={() => load(manual.trim())} data-dirpicker-go="">
            转到
          </Button>
          <Button variant="outline" size="sm" onClick={() => load("")} data-dirpicker-root="">
            根目录
          </Button>
        </div>

        <div className={css.current} data-dirpicker-current={listing.path}>
          当前：{listing.path === "" ? "（根目录）" : listing.path}
        </div>

        {listing.roots.length > 0 ? (
          <div className={css.roots}>
            {listing.roots.map((root) => (
              <button key={root.path} type="button" className={css.rootChip} onClick={() => load(root.path)}>
                {root.path}
              </button>
            ))}
          </div>
        ) : null}

        <div className={css.list} role="listbox" aria-label="子目录">
          {loading ? <div className={css.hint}>读取中…</div> : null}
          {error !== null ? (
            <div className={css.errorLine} role="alert">
              读取目录失败：{error}
            </div>
          ) : null}
          {!loading && error === null && listing.entries.length === 0 ? (
            <div className={css.hint}>这个目录下没有子目录</div>
          ) : null}
          {listing.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              role="option"
              aria-selected={false}
              className={css.entry}
              data-dirpicker-entry={entry.path}
              onClick={() => {
                setManual(entry.path);
                load(entry.path);
              }}
            >
              {entry.name}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
