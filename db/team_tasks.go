package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// Team task board: the shared work list a multi-agent team claims from.
// Shape mirrors the reference harness's TeamTaskView (subject, status, owner,
// ready) so the UI can be ported without translation.

const (
	TeamTaskStatusPending    = "pending"
	TeamTaskStatusInProgress = "in_progress"
	TeamTaskStatusCompleted  = "completed"

	MaxTeamTaskSubjectRunes = 200
	MaxTeamTaskDetailRunes  = 4000
	MaxTeamTaskOwnerRunes   = 80
	MaxTeamTaskBatch        = 200
)

var (
	ErrTeamTaskInvalid   = errors.New("invalid team task")
	ErrTeamTaskNotFound  = errors.New("team task not found")
	ErrTeamTaskTaskGone  = errors.New("task not found")
	ErrTeamTaskNotReady  = errors.New("team task is blocked by unfinished dependencies")
	ErrTeamTaskBadState  = errors.New("team task status transition not allowed")
)

// TeamTask is one row of a task's shared board.
type TeamTask struct {
	ID          int64      `json:"id"`
	TaskID      int64      `json:"task_id"`
	Subject     string     `json:"subject"`
	Detail      string     `json:"detail"`
	Status      string     `json:"status"`
	Owner       string     `json:"owner"`
	DependsOn   []int64    `json:"depends_on"`
	// Ready is derived: pending with every dependency completed. The UI uses it
	// to distinguish "waiting on someone else" from "free to claim".
	Ready       bool       `json:"ready"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	// SourceIntentID is set when this row was projected from an exploration intent, or
	// when a manual row was dispatched into one. nil = manual, not yet dispatched.
	SourceIntentID *int64 `json:"source_intent_id"`
	CompletedAt *time.Time `json:"completed_at"`
}

// TeamProgress is the header summary above the board.
type TeamProgress struct {
	Total     int `json:"total"`
	Completed int `json:"completed"`
	Active    int `json:"active"`
	Pending   int `json:"pending"`
	Blocked   int `json:"blocked"`
}

// depends_on is NOT NULL DEFAULT '{}', so it is selected bare: wrapping it in
// COALESCE makes the driver deliver the array as text instead of []int64.
// depends_on is projected as JSON text: this connection's pgx mode delivers
// bigint[] as a string, so scanning straight into []int64 fails. array_to_json
// is protocol-agnostic and unmarshals deterministically.
const teamTaskCols = `t.id, t.task_id, t.subject, t.detail, t.status, t.owner,
       array_to_json(t.depends_on)::text,
       (t.status = 'pending' AND NOT EXISTS (
           SELECT 1 FROM team_tasks d
            WHERE d.id = ANY(t.depends_on) AND d.status <> 'completed'
       )) AS ready,
       t.created_at, t.updated_at, t.completed_at, t.source_intent_id`

func scanTeamTask(row interface{ Scan(...any) error }) (*TeamTask, error) {
	var item TeamTask
	var dependsOn string
	err := row.Scan(&item.ID, &item.TaskID, &item.Subject, &item.Detail, &item.Status,
		&item.Owner, &dependsOn, &item.Ready, &item.CreatedAt, &item.UpdatedAt, &item.CompletedAt, &item.SourceIntentID)
	if err != nil {
		return nil, err
	}
	item.DependsOn = []int64{}
	if dependsOn != "" && dependsOn != "[]" {
		if err := json.Unmarshal([]byte(dependsOn), &item.DependsOn); err != nil {
			return nil, fmt.Errorf("decode depends_on: %w", err)
		}
	}
	return &item, nil
}

func normalizeTeamTaskSubject(subject string) (string, error) {
	subject = strings.Join(strings.Fields(subject), " ")
	if subject == "" {
		return "", fmt.Errorf("%w: subject is required", ErrTeamTaskInvalid)
	}
	if utf8.RuneCountInString(subject) > MaxTeamTaskSubjectRunes {
		return "", fmt.Errorf("%w: subject exceeds %d characters", ErrTeamTaskInvalid, MaxTeamTaskSubjectRunes)
	}
	return subject, nil
}

func normalizeTeamTaskDetail(detail string) (string, error) {
	detail = strings.TrimSpace(detail)
	if utf8.RuneCountInString(detail) > MaxTeamTaskDetailRunes {
		return "", fmt.Errorf("%w: detail exceeds %d characters", ErrTeamTaskInvalid, MaxTeamTaskDetailRunes)
	}
	return detail, nil
}

func normalizeTeamTaskOwner(owner string) (string, error) {
	owner = strings.TrimSpace(owner)
	if utf8.RuneCountInString(owner) > MaxTeamTaskOwnerRunes {
		return "", fmt.Errorf("%w: owner exceeds %d characters", ErrTeamTaskInvalid, MaxTeamTaskOwnerRunes)
	}
	return owner, nil
}

// ListTeamTasks returns a task's board ordered by creation, newest last.
func (d *DB) ListTeamTasks(taskID int64) ([]*TeamTask, error) {
	rows, err := d.Query(`SELECT `+teamTaskCols+` FROM team_tasks t
	                       WHERE t.task_id = $1
	                       ORDER BY t.id`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]*TeamTask, 0, 8)
	for rows.Next() {
		item, err := scanTeamTask(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// TeamTaskProgress aggregates the board for the header summary.
func TeamTaskProgress(items []*TeamTask) TeamProgress {
	var progress TeamProgress
	progress.Total = len(items)
	for _, item := range items {
		switch item.Status {
		case TeamTaskStatusCompleted:
			progress.Completed++
		case TeamTaskStatusInProgress:
			progress.Active++
		default:
			progress.Pending++
			if !item.Ready {
				progress.Blocked++
			}
		}
	}
	return progress
}

// CreateTeamTask appends one row to a task's board.
func (d *DB) CreateTeamTask(taskID int64, subject, detail string, dependsOn []int64) (*TeamTask, error) {
	subject, err := normalizeTeamTaskSubject(subject)
	if err != nil {
		return nil, err
	}
	detail, err = normalizeTeamTaskDetail(detail)
	if err != nil {
		return nil, err
	}
	exists, err := d.taskExists(taskID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrTeamTaskTaskGone
	}
	if dependsOn == nil {
		dependsOn = []int64{}
	}
	// Insert, then re-read through the derived-ready projection: `ready` depends on
	// a subquery over other rows, so it cannot be produced by this row's RETURNING.
	var id int64
	if err := d.QueryRow(`INSERT INTO team_tasks (task_id, subject, detail, depends_on)
	                      VALUES ($1, $2, $3, $4)
	                   RETURNING id`, taskID, subject, detail, dependsOn).Scan(&id); err != nil {
		return nil, err
	}
	return d.GetTeamTask(id)
}

// GetTeamTask loads one row, or nil when it does not exist.
func (d *DB) GetTeamTask(id int64) (*TeamTask, error) {
	item, err := scanTeamTask(d.QueryRow(`SELECT `+teamTaskCols+` FROM team_tasks t WHERE t.id = $1`, id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return item, nil
}

// ClaimTeamTask moves a ready pending row to in_progress for the given owner.
func (d *DB) ClaimTeamTask(id int64, owner string) (*TeamTask, error) {
	owner, err := normalizeTeamTaskOwner(owner)
	if err != nil {
		return nil, err
	}
	current, err := d.GetTeamTask(id)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, ErrTeamTaskNotFound
	}
	if current.Status != TeamTaskStatusPending {
		return nil, fmt.Errorf("%w: only pending tasks can be claimed", ErrTeamTaskBadState)
	}
	if !current.Ready {
		return nil, ErrTeamTaskNotReady
	}
	if _, err := d.Exec(`UPDATE team_tasks SET status = 'in_progress', owner = $2 WHERE id = $1`, id, owner); err != nil {
		return nil, err
	}
	return d.GetTeamTask(id)
}

// CompleteTeamTask closes a row; an unclaimed one is closed without an owner.
func (d *DB) CompleteTeamTask(id int64) (*TeamTask, error) {
	current, err := d.GetTeamTask(id)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, ErrTeamTaskNotFound
	}
	if current.Status == TeamTaskStatusCompleted {
		return current, nil
	}
	if _, err := d.Exec(`UPDATE team_tasks SET status = 'completed', completed_at = now() WHERE id = $1`, id); err != nil {
		return nil, err
	}
	return d.GetTeamTask(id)
}

// LinkTeamTaskIntent records that a manual board row was dispatched into an intent.
// Idempotent: a second dispatch on the same row is refused by the unique index.
func (d *DB) LinkTeamTaskIntent(id, intentID int64) error {
	_, err := d.Exec(`UPDATE team_tasks SET source_intent_id=$2 WHERE id=$1 AND source_intent_id IS NULL`, id, intentID)
	return err
}

// DeleteTeamTaskByIntent drops the auto-projected row for an intent, so a manual
// row can adopt that intent instead of colliding with it on the unique index.
func (d *DB) DeleteTeamTaskByIntent(taskID, intentID int64) error {
	_, err := d.Exec(`DELETE FROM team_tasks WHERE task_id=$1 AND source_intent_id=$2`, taskID, intentID)
	return err
}

// DeleteTeamTask removes one row from the board.
func (d *DB) DeleteTeamTask(id int64) error {
	result, err := d.Exec(`DELETE FROM team_tasks WHERE id = $1`, id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrTeamTaskNotFound
	}
	return nil
}

// taskExists is the existence check shared by board writes.
func (d *DB) taskExists(taskID int64) (bool, error) {
	var exists bool
	err := d.QueryRow(`SELECT EXISTS (SELECT 1 FROM tasks WHERE id = $1 AND deleted_at IS NULL)`, taskID).Scan(&exists)
	return exists, err
}