package agent

import (
	"testing"

	"github.com/Autumn-27/norma/llm"
)

// TestConfigFromOpenCodePublic locks the public free-tier wiring: OpenAI Chat
// Completions format, Zen base URL, space-bunny-free model, literal "public"
// key and the required x-opencode-session session header.
func TestConfigFromOpenCodePublic(t *testing.T) {
	c := ConfigFrom("opencode", "", "", "", "")
	if c.Format != llm.FormatOpenAI {
		t.Fatalf("format=%v, want FormatOpenAI", c.Format)
	}
	if c.BaseURL != "https://opencode.ai/zen/v1" {
		t.Fatalf("base_url=%q", c.BaseURL)
	}
	if c.Model != "space-bunny-free" {
		t.Fatalf("model=%q", c.Model)
	}
	if c.APIKey != "public" {
		t.Fatalf("api_key=%q", c.APIKey)
	}
	if c.SessionHeaderKey != "x-opencode-session" {
		t.Fatalf("session_header_key=%q", c.SessionHeaderKey)
	}
	if !c.Stream {
		t.Fatal("Stream should default true")
	}
	if _, err := c.NewProvider(); err != nil {
		t.Fatalf("NewProvider: %v", err)
	}
}

func TestConfigFromOpenCodeStripsEndpoint(t *testing.T) {
	c := ConfigFrom("opencode", "space-bunny-free", "https://opencode.ai/zen/v1/chat/completions", "public", "")
	if c.BaseURL != "https://opencode.ai/zen/v1" {
		t.Fatalf("base_url=%q, want the /chat/completions suffix stripped", c.BaseURL)
	}
}

func TestFromEnvOpenCodePublic(t *testing.T) {
	for key, value := range map[string]string{
		"ARTEX_LLM_PROVIDER":       "opencode",
		"OPENCODE_API_KEY":         "",
		"ARTEX_LLM_BASE_URL":       "",
		"ARTEX_LLM_MODEL":          "",
		"ARTEX_LLM_SESSION_HEADER": "",
		"ANTHROPIC_API_KEY":        "",
		"OPENAI_API_KEY":           "",
	} {
		t.Setenv(key, value)
	}
	c, ok := FromEnv()
	if !ok {
		t.Fatal("FromEnv returned ok=false")
	}
	if c.Format != llm.FormatOpenAI || c.BaseURL != "https://opencode.ai/zen/v1" ||
		c.Model != "space-bunny-free" || c.APIKey != "public" ||
		c.SessionHeaderKey != "x-opencode-session" {
		t.Fatalf("unexpected opencode env config: %+v", c)
	}
}
