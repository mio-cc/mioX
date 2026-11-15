package agent

import (
	"context"
	"fmt"
)

// Refusal recovery loop: detect -> escalate -> retry, with a hard stop.
//
// v0.62 shipped the detector and the ladder but never ran them together, so "does a
// refusal actually recover" was unverified. This file is the loop, written as a pure
// driver over an injected `run` function so the whole chain can be exercised with a
// controllable fixture (see refusal_loop_test.go) instead of hoping a live model
// refuses on demand.

// TurnResult is what one attempt produced.
type TurnResult struct {
	Text      string
	ToolCalls int
	Reason    string
}

// RecoveryEvent records one attempt so the caller can surface it in the activity
// stream (the operator must be able to see "this turn was rescued at L1").
type RecoveryEvent struct {
	Attempt      int    `json:"attempt"`
	Intervention string `json:"intervention"`
	Refused      bool   `json:"refused"`
	Score        int    `json:"score"`
	Pattern      string `json:"pattern,omitempty"`
}

// Recovery is the outcome of a recovery run.
type Recovery struct {
	Attempts  int             `json:"attempts"`
	Recovered bool            `json:"recovered"`
	Final     TurnResult      `json:"-"`
	Events    []RecoveryEvent `json:"events"`
}

// RunWithRefusalRecovery drives the ladder.
//
// `run` performs ONE attempt; it receives the plan for that attempt (so the caller can
// append plan.Suffix to the request). The loop stops when the turn is not a refusal, or
// when the ladder reaches give_up — it never spins: REFUSAL_MAX_ATTEMPTS bounds it.
func RunWithRefusalRecovery(
	ctx context.Context,
	run func(ctx context.Context, plan RefusalPlan) (TurnResult, error),
) (Recovery, error) {
	rec := Recovery{Events: []RecoveryEvent{}}
	if run == nil {
		return rec, fmt.Errorf("refusal recovery: run is nil")
	}
	for attempt := 0; attempt < REFUSAL_MAX_ATTEMPTS; attempt++ {
		if err := ctx.Err(); err != nil {
			return rec, err
		}
		plan := NextRefusalPlan(attempt)
		if plan.Intervention == InterventionGiveUp {
			break
		}
		result, err := run(ctx, plan)
		rec.Attempts++
		if err != nil {
			return rec, err
		}
		sig := DetectRefusal(result.Text, result.ToolCalls, result.Reason)
		rec.Events = append(rec.Events, RecoveryEvent{
			Attempt:      attempt,
			Intervention: plan.Intervention,
			Refused:      sig.Matched,
			Score:        sig.Score,
			Pattern:      sig.Pattern,
		})
		rec.Final = result
		if !sig.Matched {
			rec.Recovered = true
			return rec, nil
		}
	}
	// Ladder exhausted: the caller decides what to tell the operator. We do NOT retry
	// again — burning tokens against a refusing model never converges.
	rec.Recovered = false
	return rec, nil
}
