package agent

import (
	"context"
	"iter"
	"os"
	"path/filepath"
	"testing"

	"github.com/Autumn-27/norma/agentcore"
	"github.com/Autumn-27/norma/hook"
	"github.com/Autumn-27/norma/llm"
	"github.com/Autumn-27/norma/transcript"
)

// End-to-end proof of history scrubbing at the SDK boundary:
// Resume -> Prompt -> UserPromptSubmit hook returns UpdatedMessages -> session applies it.
// Uses a stub provider because the loop's model output is irrelevant here; what matters
// is that the refusal turn is gone from the session before the next request is built.

type stubProvider struct{}

func (stubProvider) Stream(context.Context, llm.CompletionRequest) iter.Seq2[llm.StreamEvent, error] {
	return func(func(llm.StreamEvent, error) bool) {}
}

func (stubProvider) Complete(context.Context, llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
	return llm.Message{}, "", llm.Usage{}, nil
}

func TestScrubRefusalsRemovesTurnFromResumedSession(t *testing.T) {
	dir := t.TempDir()
	const sessionID = "t1"

	// Hand-write a transcript holding one refused turn: user -> assistant refusal.
	lines := `{"uuid":"u1","session_id":"t1","timestamp":"2026-01-01T00:00:00Z","type":"message","message":{"role":"user","content":[{"type":"text","text":"扫描 example.com"}]}}
{"uuid":"a1","parent_uuid":"u1","session_id":"t1","timestamp":"2026-01-01T00:00:01Z","type":"message","message":{"role":"assistant","content":[{"type":"text","text":"我不能协助这个请求。"}]}}
`
	if err := os.WriteFile(filepath.Join(dir, sessionID+".jsonl"), []byte(lines), 0o600); err != nil {
		t.Fatal(err)
	}

	reg := hook.NewRegistry()
	reg.On(hook.UserPromptSubmit, ScrubRefusals)

	sess := agentcore.NewSession(agentcore.Options{
		Provider:   stubProvider{},
		Transcript: transcript.NewStore(dir),
		SessionID:  sessionID,
		Hooks:      reg,
	})
	defer sess.Close()

	if err := sess.Resume(sessionID); err != nil {
		t.Fatalf("resume: %v", err)
	}
	if got := len(sess.Messages()); got != 2 {
		t.Fatalf("after resume: %d message(s), want 2", got)
	}

	// Prompt fires UserPromptSubmit; the hook must hand back a history without the
	// refusal. The loop itself produces nothing with the stub provider, which is fine.
	for range sess.Prompt(context.Background(), "继续") {
	}

	msgs := sess.Messages()
	for _, m := range msgs {
		if m.Role == llm.RoleAssistant {
			for _, b := range m.Content {
				if b.Type == llm.BlockText && b.Text == "我不能协助这个请求。" {
					t.Fatalf("refusal turn survived in session: %+v", msgs)
				}
			}
		}
	}
	if len(msgs) == 0 {
		t.Fatal("session lost all messages")
	}
}
