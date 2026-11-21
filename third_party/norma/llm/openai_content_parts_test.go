package llm

import "testing"

// Regression (2026-11-21, mi / zai-glm-5-3): the gateway switched `content` from a
// string to an array of typed parts for one frame; the frame failed to decode and
// the reply lost its first text chunk ("在线确认") — the turn began with "：1、2…".
func TestParseOpenAIFrameContentParts(t *testing.T) {
	started := map[int]bool{}
	evs, _, _, _ := parseOpenAIFrame(`{"choices":[{"index":0,"delta":{"index":0,"content":[{"type":"thinking","thinking":[{"type":"text","text":"."}],"closed":true},{"type":"text","text":"在线确认"}]},"finish_reason":null}]}`, started)
	var text, think string
	for _, e := range evs {
		switch e.Type {
		case SETextDelta:
			text += e.Text
		case SEThinkingDelta:
			think += e.Text
		}
	}
	if text != "在线确认" || think != "." {
		t.Fatalf("text=%q think=%q events=%+v", text, think, evs)
	}
}

// The content-part thinking must not be echoed back as reasoning_content: the
// same gateway answers that with 422 extra_forbidden (task 271, 2026-11-21).
func TestContentPartThinkingNotReplayed(t *testing.T) {
	started := map[int]bool{}
	acc := NewAccumulator()
	evs, _, _, _ := parseOpenAIFrame(`{"choices":[{"index":0,"delta":{"content":[{"type":"thinking","thinking":[{"type":"text","text":"plan"}],"closed":true},{"type":"text","text":"hi"}]}}]}`, started)
	for _, e := range evs {
		acc.Add(e)
	}
	msg := acc.Message()
	if len(msg.Content) != 2 || msg.Content[0].Type != BlockThinking || msg.Content[0].Signature != contentPartThinkingSig {
		t.Fatalf("accumulated=%+v", msg.Content)
	}
	out := toOpenAIMessages("", []Message{msg})
	if len(out) != 1 || out[0].ReasoningContent != "" || out[0].Content != "hi" {
		t.Fatalf("replayed=%+v", out)
	}
	// Real reasoning_content is still echoed back.
	real := Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockThinking, Thinking: "r"}, TextBlock("x")}}
	if got := toOpenAIMessages("", []Message{real}); got[0].ReasoningContent != "r" {
		t.Fatalf("real reasoning dropped: %+v", got)
	}
	// Anthropic replay drops the marker block even with thinking enabled.
	if f := filterThinkingBlocks([]Message{msg}, true); len(f) != 1 || len(f[0].Content) != 1 || f[0].Content[0].Type != BlockText {
		t.Fatalf("anthropic filter=%+v", f)
	}
}

func TestParseOpenAIFrameContentString(t *testing.T) {
	started := map[int]bool{}
	evs, _, _, _ := parseOpenAIFrame(`{"choices":[{"index":0,"delta":{"content":"：1、"}}]}`, started)
	if len(evs) != 1 || evs[0].Type != SETextDelta || evs[0].Text != "：1、" {
		t.Fatalf("events=%+v", evs)
	}
	evs, _, _, _ = parseOpenAIFrame(`{"choices":[{"index":0,"delta":{"content":null,"reasoning_content":"r"}}]}`, started)
	if len(evs) != 1 || evs[0].Type != SEThinkingDelta || evs[0].Text != "r" {
		t.Fatalf("null content events=%+v", evs)
	}
}

func TestParseOpenAIResponseContentParts(t *testing.T) {
	msg, _, _, err := parseOpenAIResponse([]byte(`{"choices":[{"message":{"content":[{"type":"text","text":"hello "},{"type":"text","text":"world"}]},"finish_reason":"stop"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(msg.Content) != 1 || msg.Content[0].Text != "hello world" {
		t.Fatalf("content=%+v", msg.Content)
	}
}
