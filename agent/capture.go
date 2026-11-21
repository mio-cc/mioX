package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/intercept"
	"github.com/Autumn-27/artex/sidequestion"
	"github.com/Autumn-27/norma/agentcore"
	"github.com/Autumn-27/norma/harness"
	"github.com/Autumn-27/norma/llm"
)

// captureRun drives one agent turn-to-completion over Session.Prompt and emits a
// coalesced ActivityRecord per execution step (tool_use / tool_result / text /
// thinking / result). It is shared by every LLM agent in the system (worker,
// planner, …) so their execution is visible instead of a black box — the old
// agentcore.Run discarded every event. The emitted records carry only
// Kind/Tool/ToolUseID/IsError/Summary/Detail; the caller's emit fills in
// IntentID/Worker. Returns the final assistant text + terminal error.
//
// KindText/KindThinking arrive as streaming deltas (one event per fragment); a
// contiguous run is coalesced into a single record so the trace shows whole
// messages, not dozens of fragments.
func captureRun(ctx context.Context, opts agentcore.Options, input string, emit func(db.Activity)) (string, harness.TerminalReason, error) {
	s := agentcore.NewSession(opts)
	defer s.Close() // release the session's background-task manager (temp dir + processes)
	return captureRunSession(ctx, s, input, emit)
}

// captureRunSession is captureRun over an existing session, so a caller can run
// multiple prompts on the SAME conversation (e.g. a settlement round that reuses
// the worker's accumulated context after the main run hit max_turns).
func captureRunSession(ctx context.Context, s *agentcore.Session, input string, emit func(db.Activity)) (string, harness.TerminalReason, error) {
	ctx, auditTrace := intercept.WithTrace(ctx, input, approvalHistory(s.Messages()))
	defer auditTrace.Finish()
	var reason harness.TerminalReason
	rec := func(r db.Activity) {
		if r.Kind == "text" || r.Kind == "tool_result" {
			auditTrace.Append(db.InterceptContextEntry{Kind: r.Kind, Tool: r.Tool, ToolUseID: r.ToolUseID, Text: r.Detail, IsError: r.IsError})
		}
		if emit != nil {
			emit(r)
		}
	}
	toolNames := map[string]string{} // tool_use id -> name, to label results

	var tbuf strings.Builder
	var tkind string
	flush := func() {
		if tbuf.Len() == 0 {
			return
		}
		s := strings.TrimSpace(tbuf.String())
		k := tkind
		tbuf.Reset()
		tkind = ""
		if s != "" {
			rec(db.Activity{Kind: k, Summary: firstLine(s, 200), Detail: s})
		}
	}
	addDelta := func(kind, text string) {
		if text == "" {
			return
		}
		if tkind != "" && tkind != kind {
			flush()
		}
		tkind = kind
		tbuf.WriteString(text)
	}
	lastTool := &runTrace{startedAt: time.Now()}
	var lastUsage *llm.Usage

	// DSH sessionStats 口径（ui-chat StatsPills.tsx WindowStats）：每次 LLM 调用
	// （step）的 ttft（step 起点 → 首个模型输出 delta）与 decode（首 delta → 该
	// step 的 usage 事件）耗时，写进 usage 活动行的 metadata（不动 schema）。
	//
	// 计时边界只由 usage 事件推进：harness 在流式中边解析边执行工具
	// （norma/harness/query.go:838-839），同一 step 的工具结果可能在模型仍在输出时
	// 到达；若在 tool_result 处重置时钟，会清掉本 step 的首 delta 时刻，decode 计时
	// 丢失或从中途起算（tok/s 偏大）。工具调用本身（KindToolUse）也是模型输出，
	// 同样作为首 delta。
	//
	// harness 的 KindUsage 是本次 Prompt 循环的**累计**用量（query.go:456-461），
	// 所以这里同时写入本 step 的增量 step_*_tokens（累计差值），前端据此算
	// tok/s、缓存命中与当前上下文大小，不再对累计值求和。
	stepStartedAt := time.Now() // 本 step 起点：循环开始或上一个 step 的 usage 时刻
	var llmFirstDeltaAt time.Time
	var prevUsage llm.Usage // 上一个 usage 事件的累计值（同一 Prompt 循环内）
	markFirstDelta := func() {
		if llmFirstDeltaAt.IsZero() {
			llmFirstDeltaAt = time.Now()
		}
	}
	llmStats := func(cum llm.Usage) json.RawMessage {
		meta := map[string]int64{
			"step_input_tokens":       int64(cum.InputTokens - prevUsage.InputTokens),
			"step_output_tokens":      int64(cum.OutputTokens - prevUsage.OutputTokens),
			"step_cache_read_tokens":  int64(cum.CacheReadTokens - prevUsage.CacheReadTokens),
			"step_cache_write_tokens": int64(cum.CacheWriteTokens - prevUsage.CacheWriteTokens),
		}
		if !llmFirstDeltaAt.IsZero() { // 无流式 delta（非流式/协议错误）时不谎报计时
			meta["ttft_ms"] = llmFirstDeltaAt.Sub(stepStartedAt).Milliseconds()
			meta["decode_ms"] = time.Since(llmFirstDeltaAt).Milliseconds()
		}
		raw, err := json.Marshal(meta)
		if err != nil {
			return nil
		}
		return raw
	}
	endStep := func(cum llm.Usage) {
		prevUsage = cum
		stepStartedAt = time.Now()
		llmFirstDeltaAt = time.Time{}
	}

	// toolCalls counts this turn's tool invocations: a turn that used no tool is one
	// of the refusal signals (an agent that is working calls tools).
	toolCalls := 0
	var finalText string
	var rerr error
	for ev, err := range s.Prompt(ctx, input) {
		if err != nil {
			flush()
			if ctx.Err() != nil { // engine/user cancellation, not a provider failure
				sum, detail := terminalText(ctx, &harness.Terminal{Reason: reason, Err: ctx.Err()}, lastTool)
				rec(activityWithUsage(db.Activity{Kind: "result", Summary: firstLine(sum, 400), Detail: detail}, lastUsage))
				return finalText, reason, ctx.Err()
			}
			rec(activityWithUsage(db.Activity{Kind: "result", IsError: true, Summary: "执行出错: " + err.Error(), Detail: err.Error()}, lastUsage))
			return finalText, reason, err
		}
		switch ev.Kind {
		case harness.KindToolUse:
			toolCalls++
			if ev.ToolUse == nil {
				continue
			}
			markFirstDelta() // a tool call is model output too
			flush()
			toolNames[ev.ToolUse.ID] = ev.ToolUse.Name
			in := string(ev.ToolUse.Input)
			lastTool.start(ev.ToolUse.ID, ev.ToolUse.Name, in)
			auditTrace.Start(ev.ToolUse.ID, ev.ToolUse.Name, ev.ToolUse.Input)
			rec(db.Activity{Kind: "tool_use", Tool: ev.ToolUse.Name, ToolUseID: ev.ToolUse.ID,
				Summary: ev.ToolUse.Name + " " + firstLine(in, 200), Detail: in})
		case harness.KindToolResult:
			if ev.ToolResult == nil {
				continue
			}
			flush()
			out := blocksText(ev.ToolResult.Content)
			lastTool.done(ev.ToolResult.ToolUseID)
			auditTrace.Complete(ev.ToolResult.ToolUseID, out, ev.ToolResult.IsError)
			// No clock reset here: a result can arrive while the same step is still
			// streaming (tools run as soon as their arguments close).
			rec(db.Activity{Kind: "tool_result", Tool: toolNames[ev.ToolResult.ToolUseID], ToolUseID: ev.ToolResult.ToolUseID,
				IsError: ev.ToolResult.IsError, Summary: firstLine(out, 200), Detail: out})
		case harness.KindText:
			markFirstDelta()
			addDelta("text", ev.Text)
		case harness.KindThinking:
			markFirstDelta()
			addDelta("thinking", ev.Text)
		case harness.KindUsage:
			// live cumulative token usage (per model turn). Emitted as a non-rendered
			// "usage" activity carrying only the token fields; the UI uses the latest
			// one for a running session's live token count. Don't flush() here — the
			// buffered final-answer text must stay for the KindResult de-dup.
			if ev.Usage != nil {
				u := *ev.Usage
				meta := llmStats(u)
				lastUsage = &u
				rec(db.Activity{Kind: "usage", Metadata: meta,
					InputTokens: &u.InputTokens, OutputTokens: &u.OutputTokens,
					CacheReadTokens: &u.CacheReadTokens, CacheWriteTokens: &u.CacheWriteTokens})
				endStep(u)
			}
		case harness.KindResult:
			if ev.Terminal != nil {
				if ev.Terminal.Reason != harness.ReasonAbortedStreaming {
					sidequestion.Finish(ctx, ev.Terminal.Messages)
				}
				finalText = ev.Terminal.Text
				reason = ev.Terminal.Reason
				// the buffered tail text usually equals Terminal.Text (final answer);
				// drop it to avoid a duplicate record, the result row carries it.
				if tkind == "text" && strings.TrimSpace(tbuf.String()) == strings.TrimSpace(ev.Terminal.Text) {
					tbuf.Reset()
					tkind = ""
				}
				flush() // flush any trailing thinking / non-final text
				sum, detail := ev.Terminal.Text, ev.Terminal.Text
				if sum == "" || ev.Terminal.Reason == harness.ReasonAbortedTools || ev.Terminal.Reason == harness.ReasonAbortedStreaming {
					sum, detail = terminalText(ctx, ev.Terminal, lastTool)
				}
				// Refusal self-healing, step 1: record the verdict so the operator (and the
				// next round of work) can see that this turn was declined rather than
				// completed. The ladder that consumes it lives in refusal.go.
				if sig := DetectRefusal(ev.Terminal.Text, toolCalls, string(ev.Terminal.Reason)); sig.Matched {
					rec(db.Activity{
						Kind:    "refusal",
						Summary: fmt.Sprintf("模型拒答（信号 %d：开场白=%q，工具调用=%d）", sig.Score, sig.Pattern, sig.ToolCalls),
						Detail:  sig.Detail(),
					})
				}
				u := ev.Terminal.Usage // cumulative token usage for this session
				rec(db.Activity{Kind: "result", IsError: ev.Terminal.Err != nil,
					Summary: firstLine(sum, 400), Detail: detail,
					InputTokens: &u.InputTokens, OutputTokens: &u.OutputTokens,
					CacheReadTokens: &u.CacheReadTokens, CacheWriteTokens: &u.CacheWriteTokens})
				if ev.Terminal.Err != nil {
					rerr = ev.Terminal.Err
				}
			}
		}
	}
	flush() // safety: any unflushed text if the stream ended without KindResult
	return finalText, reason, rerr
}

func activityWithUsage(activity db.Activity, usage *llm.Usage) db.Activity {
	if usage == nil {
		return activity
	}
	u := *usage
	activity.InputTokens = &u.InputTokens
	activity.OutputTokens = &u.OutputTokens
	activity.CacheReadTokens = &u.CacheReadTokens
	activity.CacheWriteTokens = &u.CacheWriteTokens
	return activity
}

// blocksText concatenates the text of a tool-result's content blocks.
func blocksText(blocks []llm.ContentBlock) string {
	var b strings.Builder
	for _, bl := range blocks {
		if bl.Type == llm.BlockText && bl.Text != "" {
			if b.Len() > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(bl.Text)
		}
	}
	return b.String()
}

// firstLine returns a single-line, rune-capped preview for the summary column.
func firstLine(s string, max int) string {
	s = strings.TrimSpace(s)
	if before, _, found := strings.Cut(s, "\n"); found {
		s = before
	}
	if utf8.RuneCountInString(s) > max {
		s = string([]rune(s)[:max]) + "…"
	}
	return s
}

// Preserve the recorded session's visible messages, excluding thinking blocks.
// This is audit context; the judge receives only bounded, paired execution
// evidence selected from it, never assistant prose or thinking blocks.
func approvalHistory(messages []llm.Message) []db.InterceptContextEntry {
	var entries []db.InterceptContextEntry
	for _, message := range messages {
		for _, block := range message.Content {
			entry := db.InterceptContextEntry{Kind: string(message.Role)}
			switch block.Type {
			case llm.BlockText:
				entry.Text = block.Text
			case llm.BlockToolUse:
				entry.Kind, entry.Tool, entry.ToolUseID, entry.Text = "tool_use", block.Name, block.ID, string(block.Input)
			case llm.BlockToolResult:
				entry.Kind, entry.ToolUseID, entry.Text, entry.IsError = "tool_result", block.ToolUseID, blocksText(block.Content), block.IsError
			default:
				continue
			}
			entries = append(entries, entry)
		}
	}
	return entries
}
