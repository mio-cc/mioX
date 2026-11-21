import * as React from "react";

import { type DirListing, listDirs } from "@/v2/data/task-create";
import { Button } from "@/vendor/dsh/primitives/Button";
import { IconChevronLeftOutlineRegular, IconFolderOpenOutlineRegular } from "@/vendor/dsh/primitives/icons/index";
import { Modal } from "@/vendor/dsh/primitives/Modal";

import css from "./NativeDirPicker.module.css";

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

interface Props {
  open: boolean;
  initial: string;
  onClose: () => void;
  onPick: (path: string) => void;
}

/**
 * 工作目录选择：服务端目录浏览是主流程。
 *
 * 浏览器的 File System Access 只回一个本地句柄，不提供绝对路径（MDN 明确如此），
 * 而任务创建需要后端可用的绝对路径，所以 Codex Web / DSH 在纯浏览器环境也都用
 * 服务端目录浏览器。系统选择器仍保留为辅助：用户可以用它快速看一眼本地目录，
 * 但确认必须落在服务端路径上，不把句柄伪装成工作目录。
 */
export function NativeDirPicker({ open, initial, onClose, onPick }: Props): React.ReactNode {
  const [listing, setListing] = React.useState<DirListing>({ path: "", parent: "", roots: [], entries: [] });
  const [draft, setDraft] = React.useState(initial);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string | null>(null);
  const request = React.useRef(0);
  const trail = React.useRef<string[]>([]);

  const load = React.useCallback(async (path: string): Promise<void> => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const value = await listDirs(path);
      if (id !== request.current) return;
      setListing(value);
      setDraft(value.path);
    } catch (reason: unknown) {
      if (id === request.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    trail.current = [];
    setPicked(null);
    setDraft(initial);
    void load(initial);
  }, [open, initial, load]);

  if (!open) return null;

  const openNative = async (): Promise<void> => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (picker === undefined) return;
    try {
      const handle = await picker();
      setPicked(handle.name);
    } catch (reason: unknown) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? `系统目录选择器未打开：${reason.message}` : "系统目录选择器未打开。");
    }
  };

  const confirm = (): void => {
    const path = draft.trim();
    if (path === "") return;
    onPick(path);
    onClose();
  };

  const nativeAvailable = typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
  const rows = [...listing.roots, ...listing.entries];

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel="关闭"
      title="选择工作目录"
      description="Agent 将在这个服务端目录里读写文件、执行命令。"
      className={css.picker}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={draft.trim() === ""} onClick={confirm}>
            使用此目录
          </Button>
        </>
      }
    >
      <div className={css.body} data-dirpicker="">
        <div className={css.pathRow}>
          <Button
            size="sm"
            aria-label="返回上级目录"
            icon={<IconChevronLeftOutlineRegular size={14} />}
            disabled={listing.parent === "" && trail.current.length === 0}
            onClick={() => {
              if (trail.current.length > 0) void load(trail.current.pop() ?? "");
              else void load(listing.parent);
            }}
          />
          <button
            type="button"
            className={css.current}
            title={draft}
            onClick={() => draft.trim() !== "" && void load(draft.trim())}
          >
            {draft === "" ? "从磁盘根目录开始" : draft}
          </button>
          <Button size="sm" onClick={() => void load("")}>
            根目录
          </Button>
          {nativeAvailable ? (
            <Button
              size="sm"
              className={css.nativeButton}
              icon={<IconFolderOpenOutlineRegular size={14} />}
              onClick={() => void openNative()}
            >
              这台电脑
            </Button>
          ) : null}
        </div>

        {picked !== null ? (
          <p className={css.help}>
            已在系统选择器打开「{picked}」。浏览器不提供该文件夹的完整路径；要作为 Agent
            工作目录，请在下方找到同一目录并确认。
          </p>
        ) : null}

        <div className={css.listHead}>目录列表</div>
        <div className={css.browser}>
          {rows.map((row) => (
            <button
              type="button"
              key={row.path}
              className={css.entry}
              data-dirpicker-entry={row.path}
              onClick={() => {
                trail.current.push(listing.path);
                void load(row.path);
              }}
            >
              <IconFolderOpenOutlineRegular size={16} />
              <span>{row.name || row.path}</span>
            </button>
          ))}
          {loading ? <div className={css.hint}>正在读取目录…</div> : null}
          {!loading && rows.length === 0 && error === null ? (
            <div className={css.hint}>这个目录下没有可见子目录，可直接使用当前路径。</div>
          ) : null}
          {error !== null ? (
            <div className={css.error} role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className={css.manual}>
          <label htmlFor="new-task-dir-path">路径</label>
          <input
            id="new-task-dir-path"
            aria-label="工作目录路径"
            data-dirpicker-path=""
            value={draft}
            placeholder="输入服务端绝对路径后回车"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                trail.current.push(listing.path);
                void load(draft.trim());
              }
            }}
          />
          <Button size="sm" onClick={() => void load(draft.trim())}>
            打开
          </Button>
        </div>
      </div>
    </Modal>
  );
}
