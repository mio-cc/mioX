package agent

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/Autumn-27/artex/db"
)

// The team board tools are the agent-facing half of the shared task list. This
// test drives them exactly the way a model would: write a plan, list it, claim a
// ready row, and confirm a blocked row is refused.

func TestTeamBoardToolsRoundTrip(t *testing.T) {
	d := testDB(t)
	task, err := d.CreateTask("team board tool test", "exercise the board", nil, 3600, 60)
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	store := d.Exploration(task.ExplorationID)
	tools := NewToolSet(store, "worker")
	tools.SetTaskID(task.ID)
	tools.SetDB(d)

	// 1. planner writes two rows, the second depends on the first.
	writeTool := tools.teamBoardWrite()
	payload, _ := json.Marshal(map[string]any{
		"items": []map[string]any{
			{"subject": "枚举子域", "detail": "被动源优先"},
			{"subject": "验证存活", "depends_on": []int{1}},
		},
	})
	if _, err := writeTool.Call(context.Background(), payload, nil); err != nil {
		t.Fatalf("team_board_write: %v", err)
	}

	rows, err := d.ListTeamTasks(task.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}

	// 2. the dependent row is not ready; claiming it must fail.
	blocked := rows[1]
	claimTool := tools.teamBoardClaim()
	claimBlocked, _ := json.Marshal(map[string]any{"id": blocked.ID})
	if _, err := claimTool.Call(context.Background(), claimBlocked, nil); err != nil {
		t.Fatalf("claim blocked returned transport error: %v", err)
	}
	after, _ := d.GetTeamTask(blocked.ID)
	if after.Status != db.TeamTaskStatusPending {
		t.Fatalf("blocked row changed state to %q", after.Status)
	}

	// 3. the ready row claims and completes; that unblocks the dependent row.
	claimReady, _ := json.Marshal(map[string]any{"id": rows[0].ID})
	if _, err := claimTool.Call(context.Background(), claimReady, nil); err != nil {
		t.Fatalf("claim ready: %v", err)
	}
	claimed, _ := d.GetTeamTask(rows[0].ID)
	if claimed.Status != db.TeamTaskStatusInProgress || claimed.Owner != "worker" {
		t.Fatalf("claim did not take: status=%q owner=%q", claimed.Status, claimed.Owner)
	}

	completeTool := tools.teamBoardComplete()
	completePayload, _ := json.Marshal(map[string]any{"id": rows[0].ID})
	if _, err := completeTool.Call(context.Background(), completePayload, nil); err != nil {
		t.Fatalf("complete: %v", err)
	}

	unblocked, _ := d.GetTeamTask(blocked.ID)
	if !unblocked.Ready {
		t.Fatalf("dependent row still blocked after its dependency completed")
	}

	// 4. the list tool reports the same progress the UI shows.
	listTool := tools.teamBoardList()
	if _, err := listTool.Call(context.Background(), json.RawMessage(`{}`), nil); err != nil {
		t.Fatalf("team_board_list: %v", err)
	}
}
