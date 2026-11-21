"use client";

/**
 * Runtime + web-search settings with a staged write path (P3:S13–S22).
 *
 * Every field starts from the value the backend returned by GET /settings.
 * Edits stay local until「保存修改」writes one partial PUT /settings; a clean
 * form keeps the save disabled, so opening the page never changes runtime
 * behavior. The two probe buttons mirror the mioX handlers:
 * 「测试 Web 搜索」really performs a search (POST /settings/web-search/test),
 * 「重新检测」asks the Go side to re-run interpreter detection and store it
 * (POST /settings/python/detect).
 *
 * Form style follows DSH `ui-primitives/settings-form` (`SettingsValueField` +
 * `SettingsSecretField`, the controls behind `ConfigField`): label + control +
 * hint with staged text, and secrets never echoed back.
 */
import * as React from "react";

import { Button } from "@/vendor/dsh/primitives/Button";
import { Switch } from "@/vendor/dsh/primitives/Switch";
import { Badge, Card, EditorActions, Notice, Row as KitRow, Section, TextInput } from "@/components/v2/design/Kit";

import type { Settings } from "@/lib/types";
import { detectPython, testWebSearch, type SettingsState } from "@/v2/data/settings";

import { SelectMenu } from "./SelectMenu";
import { toast } from "./Toast";
import css from "./SettingsDialog.module.css";
import own from "./RuntimeSection.module.css";

const BACKENDS = [
  { value: "ddgs", label: "DuckDuckGo（ddgs）" },
  { value: "brave-free", label: "Brave（免费版）" },
  { value: "tavily", label: "Tavily" },
  { value: "deepseek", label: "DeepSeek（官方）" },
] as const;

/** Draft text for every staged field; secrets start blank because they are never echoed. */
interface Draft {
  noa: boolean;
  workers: string;
  python: string;
  searchOn: boolean;
  backend: string;
  tavily: string;
  searchProxy: string;
}

const EMPTY_DRAFT: Draft = {
  noa: false,
  workers: "",
  python: "",
  searchOn: false,
  backend: "ddgs",
  tavily: "",
  searchProxy: "",
};

function fromServer(value: Settings): Draft {
  return {
    noa: value.noa_compaction === true,
    workers: typeof value.workers === "number" ? String(value.workers) : "",
    python: value.python_interpreter ?? "",
    searchOn: value.web_search_enabled === true,
    backend: value.web_search_backend === undefined || value.web_search_backend === "" ? "ddgs" : value.web_search_backend,
    tavily: "",
    searchProxy: value.web_search_proxy ?? "",
  };
}

/** A staged setting row: switch on the right, label + hint on the left. */
function ToggleRow(props: {
  field: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): React.ReactNode {
  return (
    <KitRow label={props.label} description={props.hint} data={{ "data-field": props.field }}>
      <Switch checked={props.checked} label={props.label} onChange={props.onChange} />
    </KitRow>
  );
}

/**
 * Staged runtime settings form.
 * @param props.server - the shared GET/PUT /settings state; the section only
 * renders once `data` is present.
 * @returns the runtime fields plus save and probe buttons.
 */
export function RuntimeSection({ server }: { server: SettingsState }): React.ReactNode {
  const [draft, setDraft] = React.useState<Draft>(() =>
    server.data === null ? EMPTY_DRAFT : fromServer(server.data),
  );
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [probing, setProbing] = React.useState<"search" | "python" | null>(null);
  const [probeResult, setProbeResult] = React.useState<string | null>(null);

  // Adopt every server snapshot (first read, reload, or an accepted write).
  React.useEffect(() => {
    if (server.data !== null) setDraft(fromServer(server.data));
  }, [server.data]);

  const data = server.data;
  if (data === null) return null;

  const workersOk =
    draft.workers === (typeof data.workers === "number" ? String(data.workers) : "") ||
    (/^\d+$/.test(draft.workers.trim()) && Number(draft.workers) > 0);
  const patch: Partial<Settings> = {};
  if (draft.noa !== (data.noa_compaction === true)) patch.noa_compaction = draft.noa;
  if (draft.searchOn !== (data.web_search_enabled === true)) patch.web_search_enabled = draft.searchOn;
  const serverBackend =
    data.web_search_backend === undefined || data.web_search_backend === "" ? "ddgs" : data.web_search_backend;
  if (draft.backend !== serverBackend) patch.web_search_backend = draft.backend;
  if (draft.python !== (data.python_interpreter ?? "")) patch.python_interpreter = draft.python.trim();
  if (draft.searchProxy !== (data.web_search_proxy ?? "")) patch.web_search_proxy = draft.searchProxy.trim();
  if (draft.workers !== (typeof data.workers === "number" ? String(data.workers) : "") && workersOk) {
    patch.workers = Number(draft.workers);
  }
  const typedSecret = draft.tavily.trim() !== "";
  if (typedSecret) patch.tavily_search_api_key = draft.tavily.trim();

  const dirty = Object.keys(patch).length > 0;
  const invalid = !workersOk;

  const save = async (): Promise<void> => {
    if (!dirty || invalid || saving) return;
    setSaving(true);
    setFailure(null);
    const error = await server.save(patch);
    if (error === null) {
      setDraft((current) => ({ ...current, tavily: "" }));
      toast("运行时设置已保存");
    } else {
      setFailure(error);
    }
    setSaving(false);
  };

  const probeSearch = async (): Promise<void> => {
    setProbing("search");
    setProbeResult(null);
    try {
      const result = await testWebSearch({
        web_search_backend: draft.backend,
        web_search_proxy: draft.searchProxy.trim(),
        tavily_search_api_key: draft.tavily.trim(),
      });
      setProbeResult(
        result.ok
          ? `测试成功 · ${result.backend ?? draft.backend} 返回 ${result.count ?? 0} 条结果`
          : `测试失败：${result.error ?? "未知错误"}`,
      );
    } catch (reason: unknown) {
      setProbeResult(`测试失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setProbing(null);
    }
  };

  const probePython = async (): Promise<void> => {
    setProbing("python");
    setProbeResult(null);
    try {
      const result = await detectPython();
      setDraft((current) => ({ ...current, python: result.python_interpreter }));
      // The Go handler stores the detected path, so re-read instead of assuming it.
      server.reload();
      toast(`已重新检测 Python 解释器：${result.python_interpreter}`);
    } catch (reason: unknown) {
      setProbeResult(`检测失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setProbing(null);
    }
  };

  const probeOk = probeResult !== null && probeResult.startsWith("测试成功");
  return (
    <div aria-label="运行时设置" data-section="runtime" className={own.section}>
      <Section title="Agent 运行">
        <Card>
          <ToggleRow
            field="noa-compaction"
            label="上下文压缩（noa）"
            hint="实验功能：由模型接管上下文压缩，取代内置 compaction；对之后启动的运行生效。"
            checked={draft.noa}
            onChange={(next) => setDraft((current) => ({ ...current, noa: next }))}
          />
          <KitRow
            label="并发工作数"
            description={invalid ? <span className={css.inlineError}>并发数必须是大于 0 的整数</span> : "每个任务并发运行的 worker 数（默认 3）；对之后启动的任务生效。"}
            labelAdornment={draft.workers !== "" && draft.workers !== String(data.workers ?? "") ? <Badge tone="info">已修改</Badge> : null}
            data={{ "data-field": "workers" }}
          >
            <span className={own.narrowInput}>
              <TextInput
                id="runtime-workers"
                inputMode="numeric"
                value={draft.workers}
                placeholder="3"
                aria-label="并发工作数"
                aria-invalid={invalid}
                disabled={saving}
                onChange={(event) => setDraft((current) => ({ ...current, workers: event.currentTarget.value }))}
              />
            </span>
          </KitRow>
          <KitRow
            label="Python 解释器"
            description="自定义脚本工具用它跑 Python；留空自动检测（python3 优先）。「重新检测」会直接写入后端。"
            labelAdornment={draft.python !== (data.python_interpreter ?? "") ? <Badge tone="info">已修改</Badge> : null}
            stacked
            data={{ "data-field": "python-interpreter" }}
          >
            <div className={css.inlineSave}>
              <TextInput
                id="runtime-python"
                mono
                value={draft.python}
                placeholder="/usr/bin/python3（留空=自动检测）"
                aria-label="Python 解释器"
                disabled={saving}
                onChange={(event) => setDraft((current) => ({ ...current, python: event.currentTarget.value }))}
              />
              <Button
                variant="outline"
                size="sm"
                data-action="detect-python"
                disabled={saving || probing !== null}
                onClick={() => void probePython()}
              >
                {probing === "python" ? "检测中…" : "重新检测"}
              </Button>
            </div>
          </KitRow>
        </Card>
      </Section>

      <Section title="网络搜索">
        <Card>
          <ToggleRow
            field="web-search-enabled"
            label="网络搜索总开关"
            hint="开启后，各 Agent 才能在自身配置里启用 web_search；搜索不走流量记录代理。"
            checked={draft.searchOn}
            onChange={(next) => setDraft((current) => ({ ...current, searchOn: next }))}
          />
          <KitRow
            label="搜索来源"
            description="Brave / Tavily 需填 Key；DeepSeek 复用当前生效的 anthropic 协议配置，每次搜索消耗一次模型调用。"
            data={{ "data-field": "web-search-backend" }}
          >
            <SelectMenu
              value={draft.backend}
              options={BACKENDS}
              disabled={saving}
              ariaLabel="搜索来源"
              onChange={(value) => setDraft((current) => ({ ...current, backend: value }))}
            />
          </KitRow>
          <KitRow
            label="Tavily Search API Key"
            labelAdornment={
              <Badge tone={data.tavily_key_set === true ? "success" : "neutral"}>
                {data.tavily_key_set === true ? "已配置" : "未配置"}
              </Badge>
            }
            description="已存 Key 不回显；留空保持原值，填写后随「保存修改」写入。"
            stacked
            data={{ "data-field": "tavily-key" }}
          >
            <TextInput
              id="runtime-tavily-key"
              mono
              type="password"
              autoComplete="new-password"
              value={draft.tavily}
              placeholder={data.tavily_key_set === true ? "••••••••（保持原值）" : "tvly-…"}
              aria-label="Tavily Search API Key"
              disabled={saving}
              onChange={(event) => setDraft((current) => ({ ...current, tavily: event.currentTarget.value }))}
            />
          </KitRow>
          <KitRow
            label="搜索出口代理"
            description="仅用于访问搜索端点（http / https / socks5），与记录流量的 MITM 代理无关；留空直连。"
            labelAdornment={draft.searchProxy !== (data.web_search_proxy ?? "") ? <Badge tone="info">已修改</Badge> : null}
            stacked
            data={{ "data-field": "web-search-proxy" }}
          >
            <TextInput
              id="runtime-search-proxy"
              mono
              value={draft.searchProxy}
              placeholder="http://host:port 或 socks5://host:port"
              aria-label="搜索出口代理"
              disabled={saving}
              onChange={(event) => setDraft((current) => ({ ...current, searchProxy: event.currentTarget.value }))}
            />
          </KitRow>
        </Card>
        {probeResult === null ? null : (
          <Notice tone={probeOk ? "success" : "danger"} data={{ "data-field": "runtime-probe-result" }}>
            {probeResult}
          </Notice>
        )}
      </Section>

      {failure === null ? null : <Notice tone="danger">保存失败：{failure}</Notice>}
      <EditorActions
        start={
          <Button
            variant="ghost"
            size="sm"
            data-action="test-web-search"
            disabled={saving || probing !== null}
            onClick={() => void probeSearch()}
          >
            {probing === "search" ? "测试中…" : "测试 Web 搜索"}
          </Button>
        }
      >
        <Button
          variant="primary"
          size="sm"
          data-action="save-runtime"
          disabled={!dirty || invalid || saving}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存修改"}
        </Button>
      </EditorActions>
    </div>
  );
}
