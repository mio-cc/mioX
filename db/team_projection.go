package db

import (
	"database/sql"
	"errors"
	"fmt"
)

// Intent → team board projection.
//
// The exploration graph's intents ARE the work queue: the planner creates them,
// workers claim and finish them. The team board is therefore a *view* of that
// queue rather than a second source of truth - projecting keeps the UI honest
// without asking the model to double-write (measured: it will not).
//
// Mapping:
//   open                 → pending
//   running              → in_progress
//   done                 → completed
//   blocked/exhausted/stopped → completed (closed; the outcome lives in the intent)

// projectIntentTaskID resolves the task that owns an exploration, or 0 when the
// exploration is not attached to a live task (tests, orphaned graphs) OR the task has
// team mode off.
//
// The team_mode check is what keeps the capability real: tasks.team_mode is the
// session-owned team capability (TeamModeToggle.tsx:1), and with it off the board must
// stay untouched. Projecting regardless made "team mode off ⇒ empty board" unassertable
// and let an ungranted session accumulate board rows behind a hidden UI panel.
// Turning the switch off does NOT delete rows already projected (TeamDisableConfirmation
// promises existing board rows survive); it only stops new projections and state mirrors.
func (d *DB) projectIntentTaskID(expID int64) (int64, error) {
	var taskID int64
	var teamMode bool
	err := d.QueryRow(`SELECT id, team_mode FROM tasks WHERE exploration_id=$1 AND deleted_at IS NULL ORDER BY id LIMIT 1`, expID).Scan(&taskID, &teamMode)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !teamMode {
		return 0, nil
	}
	return taskID, nil
}

// ProjectIntentCreated appends a board row for a freshly created intent.
// Idempotent: the unique index on (task_id, source_intent_id) keeps re-runs from
// duplicating rows.
func (d *DB) ProjectIntentCreated(expID, intentID int64, summary string) error {
	taskID, err := d.projectIntentTaskID(expID)
	if err != nil || taskID == 0 {
		return err
	}
	if summary == "" {
		summary = fmt.Sprintf("意图 #%d", intentID)
	}
	_, err = d.Exec(`INSERT INTO team_tasks (task_id, subject, source_intent_id, status)
	                 VALUES ($1, $2, $3, 'pending')
	                 ON CONFLICT (task_id, source_intent_id) DO NOTHING`, taskID, summary, intentID)
	return err
}

// ProjectIntentState mirrors an intent state change onto its board row.
func (d *DB) ProjectIntentState(expID, intentID int64, state string) error {
	taskID, err := d.projectIntentTaskID(expID)
	if err != nil || taskID == 0 {
		return err
	}
	status := TeamTaskStatusPending
	closed := false
	switch state {
	case "running":
		status = TeamTaskStatusInProgress
	case "done", "blocked", "exhausted", "stopped":
		status = TeamTaskStatusCompleted
		closed = true
	}
	if closed {
		_, err = d.Exec(`UPDATE team_tasks
		                    SET status='completed', completed_at=now()
		                  WHERE task_id=$1 AND source_intent_id=$2 AND status<>'completed'`, taskID, intentID)
		return err
	}
	_, err = d.Exec(`UPDATE team_tasks
	                    SET status=$3, completed_at=NULL
	                  WHERE task_id=$1 AND source_intent_id=$2`, taskID, intentID, status)
	return err
}
