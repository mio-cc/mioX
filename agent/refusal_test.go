package agent

import "testing"

func TestDetectRefusalRequiresTwoSignals(t *testing.T) {
	cases := []struct {
		name      string
		text      string
		toolCalls int
		reason    string
		want      bool
		wantScore int
	}{
		{
			name: "plain refusal with no tools is detected",
			// opener + no tools + short => 3 signals
			text: "我不能协助这个请求。",
			want: true, wantScore: 3,
		},
		{
			name: "english refusal is detected",
			text: "I can't help with that.",
			want: true, wantScore: 3,
		},
		{
			name: "a normal short acknowledgement is NOT a refusal",
			// no opener, no tools, short => 2 signals... this is the risky case:
			// it must NOT fire because the opener signal is missing and we require
			// the opener OR a filter reason to reach two.
			text:      "收到",
			toolCalls: 0,
			want:      false,
		},
		{
			name:      "long answer with tools is not a refusal",
			text:      "已完成：写入 notes.md，读取确认三行内容，随后执行 echo 得到输出，链路正常。",
			toolCalls: 3,
			want:      false,
		},
		{
			name:      "content filter reason alone is enough",
			text:      "好的，我来处理。",
			toolCalls: 2,
			reason:    "content_filter",
			want:      true,
		},
		{
			name:      "opener late in the text does not count",
			text:      "先说结论：整体可用。顺带一提，我不能保证边界情况完全覆盖，这是正常的技术保留。",
			toolCalls: 2,
			want:      false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := DetectRefusal(tc.text, tc.toolCalls, tc.reason)
			if got.Matched != tc.want {
				t.Fatalf("Matched=%v want %v (score=%d pattern=%q)", got.Matched, tc.want, got.Score, got.Pattern)
			}
			if tc.wantScore > 0 && got.Score != tc.wantScore {
				t.Fatalf("Score=%d want %d", got.Score, tc.wantScore)
			}
		})
	}
}

func TestNextRefusalPlanTerminates(t *testing.T) {
	want := []string{
		InterventionRetry,
		InterventionReframe,
		InterventionStrip,
		InterventionFallback,
		InterventionGiveUp,
		InterventionGiveUp,
	}
	for attempt, expected := range want {
		plan := NextRefusalPlan(attempt)
		if plan.Intervention != expected {
			t.Fatalf("attempt %d => %q want %q", attempt, plan.Intervention, expected)
		}
		if plan.Intervention == InterventionGiveUp && (plan.Suffix != "" || plan.ReplaceMessage != "" || plan.UseFallback) {
			t.Fatalf("give_up must carry no intervention payload")
		}
	}
	// L2 replaces the message instead of appending to it.
	if p := NextRefusalPlan(2); p.ReplaceMessage == "" || p.Suffix != "" {
		t.Fatalf("strip plan must replace the message and not append: %+v", p)
	}
	// L3 must ask for the fallback provider.
	if p := NextRefusalPlan(3); !p.UseFallback {
		t.Fatalf("fallback plan must set UseFallback: %+v", p)
	}
	// Negative input must not panic or loop.
	if got := NextRefusalPlan(-5); got.Intervention != InterventionRetry {
		t.Fatalf("negative attempt => %q", got.Intervention)
	}
}

func TestReframeSuffixIsNeutral(t *testing.T) {
	// The suffix must stay a framing hint, never an instruction to bypass anything.
	for _, banned := range []string{"绕过", "规避", "忽略", "jailbreak", "ignore previous"} {
		if contains(reframeSuffix, banned) {
			t.Fatalf("reframe suffix must not contain %q", banned)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
