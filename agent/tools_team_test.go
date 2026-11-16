package agent

import (
	"context"
	"encoding/json"
	"testing"

	actool "github.com/Autumn-27/norma/tool"

	"github.com/Autumn-27/artex/db"
)

// The team board tools are the agent-facing half of the shared task list. These tests
// cover the two things that can silently be fake:
//
//  1. the capability gate — with tasks.team_mode off the four tools must be ABSENT from
//     the main agent's tool set (not present-but-failing), and present when it is on;
//  2. the round trip — write a decomposition, list it, claim a ready row, confirm a
//     blocked row is refused, complete a row and watch the dependent row become ready.

// toolNames is the tool-name list a turn's tool set exposes.
func toolNames(tools []actool.CoreTool) []string {
	out := make([]string, 0, len(tools))
	for _, tool := range tools {
		out = append(out, tool.Name())
	}
	return out
}

func hasTool(names []string, want string) bool {
	for _, name := range names {
		if name == want {
			return true
		}
	}
	return false
}

// TestTeamToolCapabilityGate is the decisive unit assertion for team_mode: the tools are
// granted or not granted, never "granted and then refusing". It needs no database — the
// assertion is purely about which tools the turn's tool set contains — so it can never
// silently SKIP on a machine without PG (a skipped test is not evidence).
func TestTeamToolCapabilityGate(t *testing.T) {
	tsx := NewToolSet(nil, "human")

	teamTools := []string{"team_add", "team_list", "team_claim", "team_complete"}

	off := toolNames(mainAgentBaseTools(tsx, false))
	for _, name := range teamTools {
		if hasTool(off, name) {
			t.Fatalf("team_mode=false must not expose %s; tools=%v", name, off)
		}
	}
	for _, name := range off {
		if len(name) >= 5 && name[:5] == "team_" {
			t.Fatalf("team_mode=false exposes team tool %q; tools=%v", name, off)
		}
	}

	on := toolNames(mainAgentBaseTools(tsx, true))
	for _, name := range teamTools {
		if !hasTool(on, name) {
			t.Fatalf("team_mode=true must expose %s; tools=%v", name, on)
		}
	}
	if len(on) != len(off)+len(teamTools) {
		t.Fatalf("team_mode=true added %d tools, want %d", len(on)-len(off), len(teamTools))
	}
}

// TestTeamToolNotInDomainRegistry guards the OTHER half of the gate: AllDomainTools() is
// the server-level registry that ToolResolve injects back into every agent bound to a
// tool (server/assembly.go:274-289). If the team tools were in it, a session with
// team_mode=false would still receive team_add — the capability gate would silently
// collapse the moment the DB binding exists (which seedTeamToolBindings guarantees).
func TestTeamToolNotInDomainRegistry(t *testing.T) {
	ts := NewToolSet(nil, "human")
	names := toolNames(ts.AllDomainTools())
	for _, name := range []string{"team_add", "team_list", "team_claim", "team_complete"} {
		if hasTool(names, name) {
			t.Fatalf("AllDomainTools must not expose %s (it would be injected past the team_mode gate); tools=%v", name, names)
		}
	}
	// Positive control: the registry still carries ordinary domain tools.
	if !hasTool(names, "graph_overview") {
		t.Fatalf("AllDomainTools lost its domain tools: %v", names)
	}
}

// TestTeamToolsRoundTrip drives the four tools the way a model would.
func TestTeamToolsRoundTrip(t *testing.T) {
	d := testDB(t)
	task, err := d.CreateTask("team board tool test", "exercise the board", nil, 3600, 60)
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	t.Cleanup(func() { _ = d.DeleteTask(task.ID) })
	store := d.Exploration(task.ExplorationID)
	tools := NewToolSet(store, "worker")
	tools.SetTaskID(task.ID)
	tools.SetDB(d)
	tools.SetTeamMode(true)

	// 1. the single-step shape (subject/detail/depends_on at top level) appends one row.
	addTool := tools.teamAdd()
	single, _ := json.Marshal(map[string]any{"subject": "枚举子域", "detail": "被动源优先"})
	if _, err := addTool.Call(context.Background(), single, nil); err != nil {
		t.Fatalf("team_add single: %v", err)
	}
	rows, err := d.ListTeamTasks(task.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 || rows[0].Subject != "枚举子域" {
		t.Fatalf("single-step add did not append a row: %+v", rows)
	}
	first := rows[0]

	// 1b. the batch shape (items) appends rows too, and depends_on can point at an
	// existing row id — that is the real decomposition path.
	payload, _ := json.Marshal(map[string]any{
		"items": []map[string]any{
			{"subject": "验证存活", "depends_on": []int64{first.ID}},
			{"subject": "汇总结果", "detail": "写进 findings"},
		},
	})
	if _, err := addTool.Call(context.Background(), payload, nil); err != nil {
		t.Fatalf("team_add batch: %v", err)
	}
	rows, _ = d.ListTeamTasks(task.ID)
	if len(rows) != 3 {
		t.Fatalf("expected 3 rows after batch add, got %d", len(rows))
	}

	// 2. the dependent row is not ready; claiming it must fail.
	blocked := rows[1]
	if blocked.Ready {
		t.Fatalf("row with an unfinished dependency reports ready=true: %+v", blocked)
	}
	claimTool := tools.teamClaim()
	claimBlocked, _ := json.Marshal(map[string]any{"id": blocked.ID})
	if _, err := claimTool.Call(context.Background(), claimBlocked, nil); err != nil {
		t.Fatalf("claim blocked returned transport error: %v", err)
	}
	after, _ := d.GetTeamTask(blocked.ID)
	if after.Status != db.TeamTaskStatusPending {
		t.Fatalf("blocked row changed state to %q", after.Status)
	}

	// 3. the ready row claims and completes; that unblocks the dependent row.
	claimReady, _ := json.Marshal(map[string]any{"id": first.ID})
	if _, err := claimTool.Call(context.Background(), claimReady, nil); err != nil {
		t.Fatalf("claim ready: %v", err)
	}
	claimed, _ := d.GetTeamTask(first.ID)
	if claimed.Status != db.TeamTaskStatusInProgress || claimed.Owner != "worker" {
		t.Fatalf("claim did not take: status=%q owner=%q", claimed.Status, claimed.Owner)
	}

	completeTool := tools.teamComplete()
	completePayload, _ := json.Marshal(map[string]any{"id": first.ID, "detail": "子域清单已落库"})
	if _, err := completeTool.Call(context.Background(), completePayload, nil); err != nil {
		t.Fatalf("complete: %v", err)
	}
	closed, _ := d.GetTeamTask(first.ID)
	if closed.Status != db.TeamTaskStatusCompleted {
		t.Fatalf("complete did not close the row: status=%q", closed.Status)
	}

	unblocked, _ := d.GetTeamTask(blocked.ID)
	if !unblocked.Ready {
		t.Fatalf("dependent row still blocked after its dependency completed")
	}

	// 4. the list tool reports the same progress the UI shows, and filters by status.
	listTool := tools.teamList()
	all, err := listTool.Call(context.Background(), json.RawMessage(`{}`), nil)
	if err != nil {
		t.Fatalf("team_list: %v", err)
	}
	body := all.Flatten()
	if body == "" {
		t.Fatalf("team_list returned no body")
	}
	var board struct {
		Count    int             `json:"count"`
		Progress db.TeamProgress `json:"progress"`
	}
	if err := json.Unmarshal([]byte(body), &board); err != nil {
		t.Fatalf("team_list body: %v", err)
	}
	if board.Count != 3 || board.Progress.Total != 3 || board.Progress.Completed != 1 {
		t.Fatalf("unexpected board summary: %+v", board)
	}
	filtered, _ := listTool.Call(context.Background(), json.RawMessage(`{"status":"completed"}`), nil)
	var done struct {
		Count int `json:"count"`
	}
	_ = json.Unmarshal([]byte(filtered.Flatten()), &done)
	if done.Count != 1 {
		t.Fatalf("status filter returned %d rows, want 1", done.Count)
	}
}
