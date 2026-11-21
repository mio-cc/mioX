package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// 自动化（定时任务）持久化。表结构见 schema.sql 末尾 automations / automation_runs。
// 时间计算在 server/automation_timing.go；这里只做存取。

var (
	ErrAutomationNotFound = errors.New("automation not found")
	ErrAutomationStale    = errors.New("automation was modified elsewhere")
)

// Automation is one scheduled rule.
type Automation struct {
	ID         int64           `json:"id"`
	Title      string          `json:"title"`
	Prompt     string          `json:"prompt"`
	TargetKind string          `json:"target_kind"` // task | agent | new_task
	TaskID     *int64          `json:"task_id,omitempty"`
	AgentKey   string          `json:"agent_key"`
	TimingKind string          `json:"timing_kind"` // once | every | daily | weekly | cron
	Timing     json.RawMessage `json:"timing"`
	Enabled    bool            `json:"enabled"`
	Safety     string          `json:"safety"` // readonly | inherit
	NextRunAt  *time.Time      `json:"next_run_at,omitempty"`
	LastRunAt  *time.Time      `json:"last_run_at,omitempty"`
	LastStatus string          `json:"last_status"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}

// AutomationRun is one (scheduled or manual) execution of an automation.
type AutomationRun struct {
	ID            int64      `json:"id"`
	AutomationID  int64      `json:"automation_id"`
	ScheduledAt   time.Time  `json:"scheduled_at"`
	StartedAt     *time.Time `json:"started_at,omitempty"`
	FinishedAt    *time.Time `json:"finished_at,omitempty"`
	Status        string     `json:"status"` // queued | running | done | failed | skipped
	Summary       string     `json:"summary"`
	FindingsDelta int        `json:"findings_delta"`
	TaskID        *int64     `json:"task_id,omitempty"`
	Error         string     `json:"error"`
}

const automationCols = `id, title, prompt, target_kind, task_id, agent_key, timing_kind, timing, enabled, safety,
	next_run_at, last_run_at, last_status, created_at, updated_at`

func scanAutomation(row interface{ Scan(...any) error }) (*Automation, error) {
	var a Automation
	var taskID sql.NullInt64
	var next, last sql.NullTime
	var timing []byte
	if err := row.Scan(&a.ID, &a.Title, &a.Prompt, &a.TargetKind, &taskID, &a.AgentKey, &a.TimingKind, &timing,
		&a.Enabled, &a.Safety, &next, &last, &a.LastStatus, &a.CreatedAt, &a.UpdatedAt); err != nil {
		return nil, err
	}
	if taskID.Valid {
		v := taskID.Int64
		a.TaskID = &v
	}
	if next.Valid {
		v := next.Time
		a.NextRunAt = &v
	}
	if last.Valid {
		v := last.Time
		a.LastRunAt = &v
	}
	a.Timing = json.RawMessage(timing)
	if len(a.Timing) == 0 {
		a.Timing = json.RawMessage(`{}`)
	}
	return &a, nil
}

const automationRunCols = `id, automation_id, scheduled_at, started_at, finished_at, status, summary, findings_delta, task_id, error`

func scanAutomationRun(row interface{ Scan(...any) error }) (*AutomationRun, error) {
	var r AutomationRun
	var started, finished sql.NullTime
	var taskID sql.NullInt64
	if err := row.Scan(&r.ID, &r.AutomationID, &r.ScheduledAt, &started, &finished, &r.Status, &r.Summary,
		&r.FindingsDelta, &taskID, &r.Error); err != nil {
		return nil, err
	}
	if started.Valid {
		v := started.Time
		r.StartedAt = &v
	}
	if finished.Valid {
		v := finished.Time
		r.FinishedAt = &v
	}
	if taskID.Valid {
		v := taskID.Int64
		r.TaskID = &v
	}
	return &r, nil
}

func nullInt64(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullTime(p *time.Time) any {
	if p == nil {
		return nil
	}
	return *p
}

// ListAutomations lists automations (newest first); taskID > 0 filters by target task.
func (d *DB) ListAutomations(taskID int64) ([]*Automation, error) {
	q := `SELECT ` + automationCols + ` FROM automations`
	args := []any{}
	if taskID > 0 {
		q += ` WHERE task_id=$1`
		args = append(args, taskID)
	}
	q += ` ORDER BY id DESC`
	rows, err := d.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Automation{}
	for rows.Next() {
		a, err := scanAutomation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetAutomation returns one automation or ErrAutomationNotFound.
func (d *DB) GetAutomation(id int64) (*Automation, error) {
	a, err := scanAutomation(d.QueryRow(`SELECT `+automationCols+` FROM automations WHERE id=$1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrAutomationNotFound
	}
	return a, err
}

// CreateAutomation inserts a new automation and returns the stored row.
func (d *DB) CreateAutomation(a *Automation) (*Automation, error) {
	timing := a.Timing
	if len(timing) == 0 {
		timing = json.RawMessage(`{}`)
	}
	return scanAutomation(d.QueryRow(`
INSERT INTO automations(title, prompt, target_kind, task_id, agent_key, timing_kind, timing, enabled, safety, next_run_at)
VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING `+automationCols,
		a.Title, a.Prompt, a.TargetKind, nullInt64(a.TaskID), a.AgentKey, a.TimingKind, string(timing),
		a.Enabled, a.Safety, nullTime(a.NextRunAt)))
}

// UpdateAutomation rewrites the editable fields. expectedUpdatedAt non-nil is a
// compare-and-set precondition (millisecond precision, the wire format's
// granularity); a mismatch returns ErrAutomationStale.
func (d *DB) UpdateAutomation(a *Automation, expectedUpdatedAt *time.Time) (*Automation, error) {
	timing := a.Timing
	if len(timing) == 0 {
		timing = json.RawMessage(`{}`)
	}
	q := `UPDATE automations SET title=$2, prompt=$3, target_kind=$4, task_id=$5, agent_key=$6, timing_kind=$7,
	timing=$8::jsonb, enabled=$9, safety=$10, next_run_at=$11, updated_at=clock_timestamp()
	WHERE id=$1`
	args := []any{a.ID, a.Title, a.Prompt, a.TargetKind, nullInt64(a.TaskID), a.AgentKey, a.TimingKind,
		string(timing), a.Enabled, a.Safety, nullTime(a.NextRunAt)}
	if expectedUpdatedAt != nil {
		q += ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $12::timestamptz)`
		args = append(args, *expectedUpdatedAt)
	}
	out, err := scanAutomation(d.QueryRow(q+` RETURNING `+automationCols, args...))
	if errors.Is(err, sql.ErrNoRows) {
		if _, gerr := d.GetAutomation(a.ID); gerr != nil {
			return nil, gerr
		}
		return nil, ErrAutomationStale
	}
	return out, err
}

// DeleteAutomation removes an automation (its runs cascade).
func (d *DB) DeleteAutomation(id int64) (bool, error) {
	res, err := d.Exec(`DELETE FROM automations WHERE id=$1`, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// DueAutomations returns enabled automations whose next_run_at <= now.
func (d *DB) DueAutomations(now time.Time) ([]*Automation, error) {
	rows, err := d.Query(`SELECT `+automationCols+` FROM automations
WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= $1 ORDER BY next_run_at, id`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Automation{}
	for rows.Next() {
		a, err := scanAutomation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// AdvanceAutomation moves next_run_at forward (nil = no further run) and, when
// disable is true, turns the automation off (one-shot finished). It does NOT
// touch updated_at so an editor's optimistic-lock token survives scheduling.
func (d *DB) AdvanceAutomation(id int64, next *time.Time, disable bool) error {
	_, err := d.Exec(`UPDATE automations SET next_run_at=$2, enabled = enabled AND NOT $3 WHERE id=$1`,
		id, nullTime(next), disable)
	return err
}

// MarkAutomationResult records the latest run outcome on the automation row
// (last_run_at / last_status), without touching updated_at.
func (d *DB) MarkAutomationResult(id int64, at time.Time, status string) error {
	_, err := d.Exec(`UPDATE automations SET last_run_at=$2, last_status=$3 WHERE id=$1`, id, at, status)
	return err
}

// CreateAutomationRun inserts a run row.
func (d *DB) CreateAutomationRun(r *AutomationRun) (*AutomationRun, error) {
	return scanAutomationRun(d.QueryRow(`
INSERT INTO automation_runs(automation_id, scheduled_at, started_at, status, summary, task_id, error)
VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING `+automationRunCols,
		r.AutomationID, r.ScheduledAt, nullTime(r.StartedAt), r.Status, r.Summary, nullInt64(r.TaskID), r.Error))
}

// UpdateAutomationRun writes a run's status / timing / result fields.
func (d *DB) UpdateAutomationRun(r *AutomationRun) error {
	_, err := d.Exec(`UPDATE automation_runs SET scheduled_at=$2, started_at=$3, finished_at=$4, status=$5,
	summary=$6, findings_delta=$7, task_id=$8, error=$9 WHERE id=$1`,
		r.ID, r.ScheduledAt, nullTime(r.StartedAt), nullTime(r.FinishedAt), r.Status, r.Summary,
		r.FindingsDelta, nullInt64(r.TaskID), r.Error)
	return err
}

// QueuedAutomationRun returns the automation's pending queued run (oldest), or nil.
func (d *DB) QueuedAutomationRun(automationID int64) (*AutomationRun, error) {
	r, err := scanAutomationRun(d.QueryRow(`SELECT `+automationRunCols+` FROM automation_runs
WHERE automation_id=$1 AND status='queued' ORDER BY id LIMIT 1`, automationID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

// ListQueuedAutomationRuns returns every queued run (oldest first).
func (d *DB) ListQueuedAutomationRuns() ([]*AutomationRun, error) {
	rows, err := d.Query(`SELECT ` + automationRunCols + ` FROM automation_runs WHERE status='queued' ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AutomationRun{}
	for rows.Next() {
		r, err := scanAutomationRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// FailStaleAutomationRuns marks runs left 'running' by a previous process as
// failed (their turn died with the process). Called once at scheduler start.
func (d *DB) FailStaleAutomationRuns() (int64, error) {
	res, err := d.Exec(`UPDATE automation_runs SET status='failed', finished_at=now(),
	error=CASE WHEN error='' THEN '服务重启，运行中断' ELSE error END WHERE status='running'`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ListAutomationRuns pages an automation's runs newest-first; before > 0 = id cursor.
func (d *DB) ListAutomationRuns(automationID, before int64, limit int) ([]*AutomationRun, error) {
	if limit <= 0 || limit > 200 {
		limit = 20
	}
	q := `SELECT ` + automationRunCols + ` FROM automation_runs WHERE automation_id=$1`
	args := []any{automationID}
	if before > 0 {
		q += ` AND id < $2`
		args = append(args, before)
	}
	q += ` ORDER BY id DESC LIMIT ` + strconv.Itoa(limit)
	rows, err := d.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AutomationRun{}
	for rows.Next() {
		r, err := scanAutomationRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// TaskFindingCount counts the findings table rows of one task (for findings_delta).
func (d *DB) TaskFindingCount(taskID int64) (int, error) {
	var n int
	err := d.QueryRow(`SELECT COUNT(*) FROM findings WHERE task_id=$1`, taskID).Scan(&n)
	return n, err
}

// TaskGoalsByTask batch-loads every task_goals row keyed by task id (G-5: the
// task list shows each task's goal phase without one query per task).
func (d *DB) TaskGoalsByTask() (map[int64]*TaskGoal, error) {
	rows, err := d.Query(`SELECT ` + taskGoalCols + ` FROM task_goals`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]*TaskGoal{}
	for rows.Next() {
		g, err := scanTaskGoal(rows)
		if err != nil {
			return nil, err
		}
		out[g.TaskID] = g
	}
	return out, rows.Err()
}

// PendingPlanReviewID returns the newest still-pending exit_plan_mode approval of
// a task (P-2), or 0 when there is none.
func (d *DB) PendingPlanReviewID(taskID string) (int64, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return 0, nil
	}
	var id int64
	err := d.QueryRow(`SELECT id FROM intercept_pending
WHERE task_id=$1 AND tool_name='exit_plan_mode' AND status='pending' ORDER BY id DESC LIMIT 1`, taskID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("pending plan review: %w", err)
	}
	return id, nil
}
