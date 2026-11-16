package db

import (
	"fmt"
	"testing"
	"time"
)

// The team board is a projection of the exploration intent queue: creating an
// intent adds a row, state changes move it, and re-projecting never duplicates.
// Without this the board stays empty no matter what the planner does.
//
// BEHAVIOUR CHANGE (v0.85): projection is gated on tasks.team_mode. An intent on a task
// whose team mode is off must NOT reach the board — the switch is a session-owned
// capability (TeamModeToggle.tsx:1), and projecting regardless made "off ⇒ empty board"
// impossible to assert. TestTeamBoardProjectionHonoursTeamMode covers the off case.
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
	defer func() { _ = d.DeleteTask(task.ID) }()
	// The board only exists for a session that holds the team capability.
	if err := d.SetTaskTeamMode(task.ID, true); err != nil {
		t.Fatalf("enable team mode: %v", err)
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

// TestTeamBoardProjectionHonoursTeamMode is the gate on the SECOND writer of the board.
// With team_mode off, intents (and their state changes) must not reach team_tasks — that
// is what makes "team mode off ⇒ the board stays empty" a usable assertion, and what
// keeps an ungranted session from filling a board its UI never shows.
func TestTeamBoardProjectionHonoursTeamMode(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Skipf("postgres unavailable (%v) - skipping", err)
	}
	defer d.Close()

	task, err := d.CreateTask(fmt.Sprintf("projection off %d", time.Now().UnixNano()), "team mode off", nil, 3600, 60)
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	defer func() { _ = d.DeleteTask(task.ID) }()
	if err := d.SetTaskTeamMode(task.ID, false); err != nil {
		t.Fatalf("disable team mode: %v", err)
	}
	store := d.Exploration(task.ExplorationID)

	intentID, err := store.AddIntent(map[string]any{"summary": "团队模式关闭时不该投影"}, 5, nil, "planner")
	if err != nil {
		t.Fatalf("add intent: %v", err)
	}
	rows, err := d.ListTeamTasks(task.ID)
	if err != nil {
		t.Fatalf("list board: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("team_mode=false still projected %d row(s): %+v", len(rows), rows[0])
	}

	// State changes must not resurrect the row either.
	if err := store.SetIntentState(intentID, "running"); err != nil {
		t.Fatalf("set running: %v", err)
	}
	if rows, _ = d.ListTeamTasks(task.ID); len(rows) != 0 {
		t.Fatalf("state change projected a row while team_mode=false: %+v", rows[0])
	}

	// Turning it on lets the NEXT intent project again (the gate is per-write, not sticky).
	if err := d.SetTaskTeamMode(task.ID, true); err != nil {
		t.Fatalf("enable team mode: %v", err)
	}
	if _, err := store.AddIntent(map[string]any{"summary": "开启后应投影"}, 5, nil, "planner"); err != nil {
		t.Fatalf("add intent after enabling: %v", err)
	}
	if rows, _ = d.ListTeamTasks(task.ID); len(rows) != 1 {
		t.Fatalf("expected 1 row after enabling team mode, got %d", len(rows))
	}
}
