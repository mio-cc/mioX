package server

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/Autumn-27/artex/db"
)

// TestKeylessProfileTakesOverChat is the regression guard for the reported bug:
// setting a profile as the default did nothing when that profile has no API key.
//
// Root cause: loadLLMConfig/loadProfileConfig gated on a non-empty api_key
// (`if cfg.APIKey == "" { return cfg, false }`). A keyless profile — a local
// gateway or a public endpoint — therefore resolved as "unusable", so
// reapplyActiveProfile bailed out and the running engine kept whatever provider
// it had built before (from the environment or the previously active profile).
// The user saw "I set local-test as default, but chat still runs the global
// anthropic config".
//
// The rule pinned here: an empty api_key is a LEGAL keyless route. The active
// profile must resolve, the chat agent must be built from it, and the provider
// must be built with Keyless set so no ambient environment key is borrowed.
func TestKeylessProfileTakesOverChat(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("postgres unavailable (%v) — skipping", err)
	}
	defer m.Close()
	td := t.TempDir()
	s := New(context.Background(), m, td, td, td)

	// The fixture must be the only default row; other tests share this database.
	existing, _ := m.pg.ListProfiles()
	for _, p := range existing {
		if p.IsDefault {
			if _, err := m.pg.Exec(`UPDATE llm_profiles SET is_default=false WHERE id=$1`, p.ID); err != nil {
				t.Fatal(err)
			}
		}
	}

	const keylessModel = "auto/glm-5.3"
	// Unique name: this test may run repeatedly against the same *_test database,
	// and llm_profiles.name is UNIQUE.
	name := fmt.Sprintf("keyless-local-%d", time.Now().UnixNano())
	id, err := m.pg.SaveProfile(&db.LLMProfile{
		Name: name, Format: "openai-responses",
		BaseURL: "http://127.0.0.1:3425/v1", Model: keylessModel,
		Streaming: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = m.pg.Exec(`UPDATE llm_profiles SET is_default=false WHERE id=$1`, id)
		_ = m.pg.DeleteProfile(id)
	})

	// The profile really is keyless in storage (not "key_set but empty").
	stored, err := m.pg.ProfileByID(id)
	if err != nil || stored == nil {
		t.Fatalf("ProfileByID(%d): %v %v", id, stored, err)
	}
	if stored.APIKey != "" {
		t.Fatalf("fixture api_key = %q, want empty", stored.APIKey)
	}

	if err := m.pg.SetActiveProfile(id); err != nil {
		t.Fatal(err)
	}

	// ① the ACTIVE (is_default) profile resolves for the global/chat path.
	cfg, ok := s.loadLLMConfig()
	if !ok {
		t.Fatalf("loadLLMConfig() = false for a keyless active profile; the empty-key gate is back")
	}
	if cfg.Model != keylessModel {
		t.Fatalf("loadLLMConfig().Model = %q, want %q (the active profile must win)", cfg.Model, keylessModel)
	}
	if !cfg.Keyless {
		t.Fatalf("loadLLMConfig().Keyless = false; a keyless profile would borrow an ambient environment key")
	}

	// ② the same config resolves per-profile (agent binding / task chain path).
	pcfg, ok := s.loadProfileConfig(id)
	if !ok {
		t.Fatalf("loadProfileConfig(%d) = false for a keyless profile", id)
	}
	if !pcfg.Keyless || pcfg.Model != keylessModel {
		t.Fatalf("loadProfileConfig(%d) = {keyless:%v model:%q}, want {true %q}", id, pcfg.Keyless, pcfg.Model, keylessModel)
	}
	if _, _, ok := s.providerForProfile(id); !ok {
		t.Fatalf("providerForProfile(%d) = false; a keyless route still builds a provider", id)
	}

	// ③ chat resolves an agent from the active profile with no conversation pin
	//    and no agent binding — the decisive "the default profile took over".
	s.reapplyActiveProfile()
	if got := s.resolveChatAgent(&db.Conversation{AgentKey: "mainagent"}); got == nil {
		t.Fatalf("resolveChatAgent() = nil after activating a keyless profile; chat would fall back to nothing")
	}
}

// TestEffortWireValueSendsNothingForOff pins the `off` level's wire meaning:
// DSH ModelReasoningEfforts.tsx:18-20 `defaultValue(level)` returns null for Off,
// i.e. the request carries no reasoning-effort field at all.
func TestEffortWireValueSendsNothingForOff(t *testing.T) {
	cases := map[string]string{
		"off":    "",
		"low":    "low",
		"medium": "medium",
		"high":   "high",
		"xhigh":  "xhigh",
		"max":    "max",
	}
	for level, want := range cases {
		if got := db.EffortWireValue(level); got != want {
			t.Fatalf("EffortWireValue(%q) = %q, want %q", level, got, want)
		}
	}
}

// TestReasoningEffortsDeclarationRoundTrip pins the stored shape of a per-model
// level declaration: canonical order, deduplicated, unknown levels dropped.
func TestReasoningEffortsDeclarationRoundTrip(t *testing.T) {
	if got := db.JoinReasoningEfforts([]string{"high", "off", "low", "high", "bogus"}); got != "off,low,high" {
		t.Fatalf("JoinReasoningEfforts = %q, want %q", got, "off,low,high")
	}
	if got := db.JoinReasoningEfforts(nil); got != "" {
		t.Fatalf("JoinReasoningEfforts(nil) = %q, want empty (undeclared)", got)
	}
	got := db.ParseReasoningEfforts("high, off ,bogus,low")
	if len(got) != 3 || got[0] != "off" || got[1] != "low" || got[2] != "high" {
		t.Fatalf("ParseReasoningEfforts = %v, want [off low high]", got)
	}
	if len(db.ParseReasoningEfforts("")) != 0 {
		t.Fatalf("ParseReasoningEfforts(\"\") should be empty")
	}
}
