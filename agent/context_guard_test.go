package agent

import (
	"strings"
	"testing"
)

func TestGovernedPromptNoPrefixWhenPreviousTurnWasFine(t *testing.T) {
	if got := GovernedPrompt(false, "继续扫描子域"); got != "继续扫描子域" {
		t.Fatalf("got %q, must not rewrite a normal turn", got)
	}
}

func TestGovernedPromptPrefixesAfterRefusal(t *testing.T) {
	got := GovernedPrompt(true, "继续扫描子域")
	if !strings.HasPrefix(got, GovernancePrefix) {
		t.Fatalf("missing governance prefix: %q", got)
	}
	if !strings.HasSuffix(got, "继续扫描子域") {
		t.Fatalf("must keep the original message: %q", got)
	}
}

func TestGovernedPromptDoesNotStack(t *testing.T) {
	once := GovernedPrompt(true, "继续")
	twice := GovernedPrompt(true, once)
	if strings.Count(twice, GovernancePrefix) != 1 {
		t.Fatalf("prefix stacked: %q", twice)
	}
}

func TestGovernedPromptLeavesEmptyMessageAlone(t *testing.T) {
	if got := GovernedPrompt(true, "   "); got != "   " {
		t.Fatalf("empty message must pass through untouched, got %q", got)
	}
}

func TestGovernancePrefixStaysProcedural(t *testing.T) {
	// The framing must never ask the model to ignore a rule or bypass anything: that is
	// exactly the escalation that makes refusals worse.
	for _, banned := range []string{"忽略", "绕过", "无视", "ignore", "bypass", "jailbreak", "不要拒绝"} {
		if strings.Contains(GovernancePrefix, banned) {
			t.Fatalf("governance prefix must not contain %q", banned)
		}
	}
}
