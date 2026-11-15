package intercept

import (
	"os"
	"testing"

	"github.com/Autumn-27/artex/db"
)

// Does an "ask" rule on tool_name=Bash actually match? The end-to-end approval
// loop depends on this; if matching is broken the guard silently allows and no
// pending record is ever created.
func TestAskRuleMatchesBashToolName(t *testing.T) {
	dsn := os.Getenv("ARTEX_TEST_DSN")
	if dsn == "" {
		dsn = "postgres://postgres@127.0.0.1:5434/postgres?sslmode=disable&default_query_exec_mode=simple_protocol"
	}
	handle, err := db.Open(dsn)
	if err != nil {
		t.Skipf("postgres unavailable (%v) - skipping", err)
	}
	defer handle.Close()

	ic := New(handle)
	rule, err := handle.CreateInterceptRule("e2e-ask-test", "tool_name", "string", "Bash", "ask", "need approval", 100, true, true, 60, "deny")
	if err != nil {
		t.Fatalf("create rule: %v", err)
	}
	defer func() { _ = handle.DeleteInterceptRule(rule.ID) }()
	ic.Invalidate()

	if !ic.IsToolEnabled("Bash") {
		t.Fatalf("Bash is not in the intercept-enabled set; the guard would skip it entirely")
	}
	dec, matched := ic.Match("Bash", []byte(`{"command":"echo hi"}`))
	if !matched {
		t.Fatalf("rule did not match tool_name=Bash")
	}
	if dec.Action != "ask" {
		t.Fatalf("expected ask, got %q", dec.Action)
	}
	if _, m := ic.Match("Read", []byte(`{"path":"x"}`)); m {
		t.Fatal("rule matched an unrelated tool")
	}
}
