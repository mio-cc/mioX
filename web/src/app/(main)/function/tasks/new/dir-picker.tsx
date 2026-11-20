"use client";

/**
 * Working-directory picker (reference: DSH picks a folder when creating a session).
 *
 * The browser cannot hand a real filesystem path to a web app, so the picker browses the
 * server's directories through `GET /api/fs/dirs` and returns the absolute path.
 */

import * as React from "react";

import { ArrowUp, Check, Folder, X } from "lucide-react";

import { api } from "@/lib/api";

import styles from "./dir-picker.module.css";

interface DirEntry {
  name: string;
  path: string;
}

export function DirPicker({
  open,
  initial,
  onClose,
  onPick,
}: {
  readonly open: boolean;
  readonly initial: string;
  readonly onClose: () => void;
  readonly onPick: (path: string) => void;
}) {
  const [path, setPath] = React.useState(initial);
  const [parent, setParent] = React.useState("");
  const [roots, setRoots] = React.useState<DirEntry[]>([]);
  const [entries, setEntries] = React.useState<DirEntry[]>([]);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [manual, setManual] = React.useState(initial);

  const load = React.useCallback((next: string) => {
    setLoading(true);
    setError("");
    api
      .fsDirs(next)
      .then((result) => {
        setPath(result.path ?? "");
        setParent(result.parent ?? "");
        setRoots(result.roots ?? []);
        setEntries(result.entries ?? []);
        // Deliberately NOT resetting the manual input here: an in-flight listing used to
        // resolve after the user started typing and wipe the path they had just entered.
      })
      .catch((e: Error) => setError(e.message || "读取目录失败"))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setManual(initial);
    load(initial);
  }, [open, initial, load]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={onClose} data-testid="dirpicker-backdrop">
      <div className={styles.dialog} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.head}>
          <span className={styles.title}>选择工作目录</span>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="关闭" data-testid="dirpicker-close">
            <X size={14} />
          </button>
        </div>

        <div className={styles.pathRow}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => parent && load(parent)}
            disabled={!parent}
            aria-label="上一级"
            data-testid="dirpicker-up"
          >
            <ArrowUp size={14} />
          </button>
          <input
            className={styles.pathInput}
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") load(manual);
            }}
            placeholder="输入绝对路径后回车"
            data-testid="dirpicker-path"
          />
          <button type="button" className={styles.goBtn} onClick={() => load(manual)} data-testid="dirpicker-go">
            转到
          </button>
          <button type="button" className={styles.goBtn} onClick={() => load("")} data-testid="dirpicker-root" title="回到根目录">
            根目录
          </button>
        </div>

        <div className={styles.list} data-testid="dirpicker-list">
          {roots.length > 0 ? (
            <div className={styles.rootRow}>
              {roots.map((root) => (
                <button key={root.path} type="button" className={styles.rootChip} onClick={() => load(root.path)}>
                  {root.path}
                </button>
              ))}
            </div>
          ) : null}
          {loading ? <div className={styles.hint}>读取中…</div> : null}
          {error ? <div className={styles.error}>{error}</div> : null}
          {!loading && !error && entries.length === 0 ? <div className={styles.hint}>这个目录下没有子目录</div> : null}
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={styles.row}
              onDoubleClick={() => load(entry.path)}
              onClick={() => load(entry.path)}
              data-testid="dirpicker-entry"
            >
              <Folder size={13} className={styles.folderIcon} />
              <span className={styles.rowName}>{entry.name}</span>
            </button>
          ))}
        </div>

        <div className={styles.foot}>
          <span className={styles.current} title={path} data-testid="dirpicker-current">
            {path || "（未选择）"}
          </span>
          <button
            type="button"
            className={styles.pickBtn}
            disabled={!path}
            onClick={() => {
              if (path) onPick(path);
              onClose();
            }}
            data-testid="dirpicker-pick"
          >
            <Check size={13} /> 用这个目录
          </button>
        </div>
      </div>
    </div>
  );
}
