package agent

import (
	"context"
	"log"
	"strings"

	"github.com/Autumn-27/norma/hook"
	"github.com/Autumn-27/norma/llm"
)

// History scrubbing: the part of context governance that actually removes the
// poisoned turn.
//
// A refusal is self-reinforcing — once the model has written "I can't", it keeps
// reading that line and keeps refusing. v0.66 could only add a corrective framing to
// the NEXT prompt, because the message list lives inside the SDK session. norma now
// exposes hook.Result.UpdatedMessages on UserPromptSubmit, so this hook can hand back a
// history with the refusal turns dropped.
//
// Safety: only pure-text assistant turns are dropped. A turn that contains tool blocks
// is never touched, because removing it would break tool_use / tool_result pairing and
// the next request would be rejected by the provider.

// ScrubRefusals is a UserPromptSubmit hook that removes refusal-only assistant turns.
func ScrubRefusals(_ context.Context, ev hook.Event) hook.Result {
	log.Printf("[context] scrub hook entered: %d message(s)", len(ev.Messages))
	if len(ev.Messages) == 0 {
		return hook.Result{}
	}
	kept := make([]llm.Message, 0, len(ev.Messages))
	dropped := 0
	for _, msg := range ev.Messages {
		if msg.Role != llm.RoleAssistant || !isPureRefusal(msg) {
			kept = append(kept, msg)
			continue
		}
		dropped++
	}
	// Observable: a silent hook makes "did governance run at all" unanswerable, which is
	// how the earlier version stayed unverified for a whole round.
	log.Printf("[context] scrub hook fired: %d message(s) in history, %d refusal turn(s) dropped", len(ev.Messages), dropped)
	if dropped == 0 {
		return hook.Result{}
	}
	return hook.Result{UpdatedMessages: kept}
}

// isPureRefusal reports whether an assistant message is a refusal with no tool work.
func isPureRefusal(msg llm.Message) bool {
	var text strings.Builder
	for _, block := range msg.Content {
		switch block.Type {
		case llm.BlockToolUse, llm.BlockToolResult:
			// Any tool activity means the turn did work; never drop it.
			return false
		case llm.BlockText:
			text.WriteString(block.Text)
		}
	}
	body := strings.TrimSpace(text.String())
	if body == "" {
		return false
	}
	// toolCalls=0 is correct here: the loop above already proved there are no tool
	// blocks, so the detector's "no tools" signal is accurate for this message.
	return DetectRefusal(body, 0, "").Matched
}
