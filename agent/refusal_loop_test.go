package agent

import (
	"context"
	"errors"
	"testing"
)

// A scripted fixture stands in for the model: it is exactly the "controllable fixture"
// the design asks for, because a live model cannot be made to refuse on demand.
type scriptedTurns struct {
	turns []TurnResult
	calls []RefusalPlan
	err   error
}

func (s *scriptedTurns) run(_ context.Context, plan RefusalPlan) (TurnResult, error) {
	s.calls = append(s.calls, plan)
	if s.err != nil {
		return TurnResult{}, s.err
	}
	idx := len(s.calls) - 1
	if idx >= len(s.turns) {
		return TurnResult{Text: "（fixture 用尽）", ToolCalls: 1}, nil
	}
	return s.turns[idx], nil
}

var refusedTurn = TurnResult{Text: "我不能协助这个请求。", ToolCalls: 0, Reason: "stop"}
var goodTurn = TurnResult{Text: "已完成：读取配置、生成报告、写入结果文件，三步都跑通了。", ToolCalls: 3, Reason: "stop"}

func TestRecoveryStopsImmediatelyWhenNotRefused(t *testing.T) {
	f := &scriptedTurns{turns: []TurnResult{goodTurn}}
	rec, err := RunWithRefusalRecovery(context.Background(), f.run)
	if err != nil {
		t.Fatal(err)
	}
	if !rec.Recovered || rec.Attempts != 1 || len(f.calls) != 1 {
		t.Fatalf("recovered=%v attempts=%d calls=%d", rec.Recovered, rec.Attempts, len(f.calls))
	}
	if f.calls[0].Intervention != InterventionRetry {
		t.Fatalf("first intervention=%q want retry", f.calls[0].Intervention)
	}
}

func TestRecoveryEscalatesAndRecovers(t *testing.T) {
	// refuse once, then answer: the second attempt must be the L1 reframe.
	f := &scriptedTurns{turns: []TurnResult{refusedTurn, goodTurn}}
	rec, err := RunWithRefusalRecovery(context.Background(), f.run)
	if err != nil {
		t.Fatal(err)
	}
	if !rec.Recovered || rec.Attempts != 2 {
		t.Fatalf("recovered=%v attempts=%d", rec.Recovered, rec.Attempts)
	}
	if len(f.calls) != 2 {
		t.Fatalf("calls=%d want 2", len(f.calls))
	}
	if f.calls[0].Intervention != InterventionRetry || f.calls[1].Intervention != InterventionReframe {
		t.Fatalf("ladder=%q,%q", f.calls[0].Intervention, f.calls[1].Intervention)
	}
	if f.calls[1].Suffix == "" {
		t.Fatal("reframe attempt must carry a suffix")
	}
	// The first attempt must be recorded as a refusal, the second as recovered.
	if len(rec.Events) != 2 || !rec.Events[0].Refused || rec.Events[1].Refused {
		t.Fatalf("events=%+v", rec.Events)
	}
}

func TestRecoveryGivesUpAtTheCap(t *testing.T) {
	// always refuse: must stop at REFUSAL_MAX_ATTEMPTS and report failure.
	f := &scriptedTurns{turns: []TurnResult{refusedTurn, refusedTurn, refusedTurn, refusedTurn, refusedTurn}}
	rec, err := RunWithRefusalRecovery(context.Background(), f.run)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Recovered {
		t.Fatal("must not report recovery when every attempt refused")
	}
	if rec.Attempts != REFUSAL_MAX_ATTEMPTS {
		t.Fatalf("attempts=%d want %d", rec.Attempts, REFUSAL_MAX_ATTEMPTS)
	}
	if len(f.calls) != REFUSAL_MAX_ATTEMPTS {
		t.Fatalf("calls=%d want %d (ladder must not spin)", len(f.calls), REFUSAL_MAX_ATTEMPTS)
	}
	for i, e := range rec.Events {
		if !e.Refused {
			t.Fatalf("event %d should be a refusal: %+v", i, e)
		}
	}
}

func TestRecoveryPropagatesRunError(t *testing.T) {
	boom := errors.New("provider exploded")
	f := &scriptedTurns{err: boom}
	if _, err := RunWithRefusalRecovery(context.Background(), f.run); !errors.Is(err, boom) {
		t.Fatalf("err=%v want %v", err, boom)
	}
}

func TestRecoveryHonoursContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	f := &scriptedTurns{turns: []TurnResult{goodTurn}}
	if _, err := RunWithRefusalRecovery(ctx, f.run); !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v want context.Canceled", err)
	}
	if len(f.calls) != 0 {
		t.Fatalf("must not run after cancellation, calls=%d", len(f.calls))
	}
}
