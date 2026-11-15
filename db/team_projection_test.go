package db

import (
	"fmt"
	"testing"
	"time"
)

// The team board is a projection of the exploration intent queue: creating an
// intent adds a row, state changes move it, and re-projecting never duplicates.
// Without this the board stays empty no matter what the planner does.
func TestTeamBoardProjectsIntents(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Skipf("postgres unavailable (%v) - skipping", err)
	}
	defer d.Close()

	task, err := d.CreateTask(fmt.Sprintf("projection %d", time.Now().UnixNano()), "project intents onto the board", nil, 3600, 60)
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	store := d.Exploration(task.ExplorationID)

	summary := fmt.Sprintf("枚举子域 %d", time.Now().UnixNano())
	intentID, err := store.AddIntent(map[string]any{"summary": summary}, 5, nil, "planner")
	if err != nil {
		t.Fatalf("add intent: %v", err)
	}

	rows, err := d.ListTeamTasks(task.ID)
	if err != nil {
		t.Fatalf("list board: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 projected row, got %d", len(rows))
	}
	row := rows[0]
	if row.Subject != summary || row.Status != TeamTaskStatusPending {
		t.Fatalf("projected row wrong: subject=%q status=%q", row.Subject, row.Status)
	}

	// Re-projecting the same intent must not duplicate the row.
	if err := d.ProjectIntentCreated(task.ExplorationID, intentID, summary); err != nil {
		t.Fatalf("re-project: %v", err)
	}
	again, _ := d.ListTeamTasks(task.ID)
	if len(again) != 1 {
		t.Fatalf("projection is not idempotent: %d rows", len(again))
	}

	// running → in_progress
	if err := store.SetIntentState(intentID, "running"); err != nil {
		t.Fatalf("set running: %v", err)
	}
	moved, _ := d.GetTeamTask(row.ID)
	if moved.Status != TeamTaskStatusInProgress {
		t.Fatalf("running did not project: %q", moved.Status)
	}

	// done → completed
	if err := store.SetIntentState(intentID, "done"); err != nil {
		t.Fatalf("set done: %v", err)
	}
	closed, _ := d.GetTeamTask(row.ID)
	if closed.Status != TeamTaskStatusCompleted || closed.CompletedAt == nil {
		t.Fatalf("done did not close the row: status=%q completed=%v", closed.Status, closed.CompletedAt)
	}

	// CompareAndSet path (worker settlement) projects too.
	second, err := store.AddIntent(map[string]any{"summary": "验证存活"}, 5, nil, "planner")
	if err != nil {
		t.Fatalf("add second intent: %v", err)
	}
	ok, err := store.CompareAndSetIntentState(second, "open", "exhausted")
	if err != nil || !ok {
		t.Fatalf("cas transition failed: ok=%v err=%v", ok, err)
	}
	rows, _ = d.ListTeamTasks(task.ID)
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
	if rows[1].Status != TeamTaskStatusCompleted {
		t.Fatalf("exhausted did not close the row: %q", rows[1].Status)
	}
}
