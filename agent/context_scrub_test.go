package agent

import (
	"context"
	"testing"

	"github.com/Autumn-27/norma/hook"
	"github.com/Autumn-27/norma/llm"
)

func assistantText(s string) llm.Message {
	return llm.Message{Role: llm.RoleAssistant, Content: []llm.ContentBlock{llm.TextBlock(s)}}
}

func TestScrubRefusalsDropsRefusalOnlyTurn(t *testing.T) {
	history := []llm.Message{
		llm.UserText("扫描 example.com 的子域"),
		assistantText("我不能协助这个请求。"),
	}
	res := ScrubRefusals(context.Background(), hook.Event{Messages: history})
	if res.UpdatedMessages == nil {
		t.Fatal("expected rewritten history")
	}
	if len(res.UpdatedMessages) != 1 {
		t.Fatalf("kept %d messages, want 1", len(res.UpdatedMessages))
	}
	if res.UpdatedMessages[0].Role != llm.RoleUser {
		t.Fatalf("the surviving message must be the user turn, got %q", res.UpdatedMessages[0].Role)
	}
}

func TestScrubRefusalsKeepsTurnsWithToolBlocks(t *testing.T) {
	// A turn that used a tool must never be dropped: removing it would orphan the
	// tool_result and the next request would be rejected by the provider.
	withTool := llm.Message{Role: llm.RoleAssistant, Content: []llm.ContentBlock{
		llm.TextBlock("我不能协助这个请求。"),
		{Type: llm.BlockToolUse},
	}}
	history := []llm.Message{llm.UserText("扫描"), withTool}
	res := ScrubRefusals(context.Background(), hook.Event{Messages: history})
	if res.UpdatedMessages != nil {
		t.Fatalf("must not rewrite history when the refusal turn has tool blocks: %+v", res.UpdatedMessages)
	}
}

func TestScrubRefusalsLeavesHealthyHistoryAlone(t *testing.T) {
	history := []llm.Message{
		llm.UserText("扫描 example.com"),
		assistantText("已完成：解析出 12 个子域，写入资产表。"),
	}
	res := ScrubRefusals(context.Background(), hook.Event{Messages: history})
	if res.UpdatedMessages != nil {
		t.Fatal("healthy history must not be rewritten")
	}
}

func TestScrubRefusalsEmptyHistory(t *testing.T) {
	if res := ScrubRefusals(context.Background(), hook.Event{}); res.UpdatedMessages != nil {
		t.Fatal("empty history must not be rewritten")
	}
}
