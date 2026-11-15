package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// Memory is one durable note that outlives a task: a lesson, a technique that worked,
// a target fact. It lives outside the exploration graph so recall spans tasks and so an
// operator can rewrite a bad entry without editing a live transcript.
type Memory struct {
	ID        int64     `json:"id"`
	Scope     string    `json:"scope"`
	TaskID    string    `json:"task_id,omitempty"`
	Kind      string    `json:"kind"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Tags      []string  `json:"tags"`
	Hits      int       `json:"hits"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Memory kinds. Kept as a closed set so the UI can group without guessing.
const (
	MemoryNote      = "note"
	MemoryLesson    = "lesson"
	MemoryTechnique = "technique"
	MemoryTarget    = "target"
)

// MemoryQuery filters a recall. Zero values mean "no filter".
type MemoryQuery struct {
	Text   string // substring match on title + content
	Kind   string
	Scope  string
	TaskID string
	Tag    string
	Limit  int
}

const memoryCols = `id, scope, COALESCE(task_id,''), kind, title, content,
       COALESCE(array_to_json(tags)::text,'[]'), hits, created_at, updated_at`

func scanMemory(row interface{ Scan(...any) error }) (Memory, error) {
	var m Memory
	var tagsJSON string
	if err := row.Scan(&m.ID, &m.Scope, &m.TaskID, &m.Kind, &m.Title, &m.Content, &tagsJSON, &m.Hits, &m.CreatedAt, &m.UpdatedAt); err != nil {
		return m, err
	}
	// bigint[]/text[] come back as a JSON array string under simple-protocol mode.
	m.Tags = parseTagJSON(tagsJSON)
	return m, nil
}

func parseTagJSON(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" {
		return []string{}
	}
	raw = strings.TrimPrefix(raw, "[")
	raw = strings.TrimSuffix(raw, "]")
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.Trim(strings.TrimSpace(part), `"`)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

// CreateMemory stores one entry and returns it as written.
func (d *DB) CreateMemory(m Memory) (*Memory, error) {
	if strings.TrimSpace(m.Content) == "" {
		return nil, fmt.Errorf("content is required")
	}
	if m.Scope == "" {
		m.Scope = "global"
	}
	if m.Kind == "" {
		m.Kind = MemoryNote
	}
	var taskID *string
	if m.Scope == "task" && strings.TrimSpace(m.TaskID) != "" {
		taskID = &m.TaskID
	}
	var id int64
	err := d.QueryRow(`
INSERT INTO memories(scope, task_id, kind, title, content, tags)
VALUES ($1,$2,$3,$4,$5,string_to_array($6,',')) RETURNING id`,
		m.Scope, taskID, m.Kind, m.Title, m.Content, strings.Join(m.Tags, ",")).Scan(&id)
	if err != nil {
		return nil, err
	}
	// Read back rather than RETURNING derived columns: tags go through array_to_json.
	return d.GetMemory(id)
}

// GetMemory loads one entry by id.
func (d *DB) GetMemory(id int64) (*Memory, error) {
	row := d.QueryRow(`SELECT `+memoryCols+` FROM memories WHERE id=$1`, id)
	m, err := scanMemory(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// ListMemories returns entries newest-first, filtered by the query.
func (d *DB) ListMemories(q MemoryQuery) ([]Memory, error) {
	where := []string{"1=1"}
	args := []any{}
	if q.Text != "" {
		args = append(args, "%"+q.Text+"%")
		where = append(where, fmt.Sprintf("(title ILIKE $%d OR content ILIKE $%d)", len(args), len(args)))
	}
	if q.Kind != "" {
		args = append(args, q.Kind)
		where = append(where, fmt.Sprintf("kind=$%d", len(args)))
	}
	if q.Scope != "" {
		args = append(args, q.Scope)
		where = append(where, fmt.Sprintf("scope=$%d", len(args)))
	}
	if q.TaskID != "" {
		args = append(args, q.TaskID)
		where = append(where, fmt.Sprintf("task_id=$%d", len(args)))
	}
	if q.Tag != "" {
		args = append(args, q.Tag)
		where = append(where, fmt.Sprintf("$%d = ANY(tags)", len(args)))
	}
	limit := q.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args = append(args, limit)
	rows, err := d.Query(`SELECT `+memoryCols+` FROM memories WHERE `+
		strings.Join(where, " AND ")+
		fmt.Sprintf(` ORDER BY updated_at DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Memory{}
	for rows.Next() {
		m, scanErr := scanMemory(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// UpdateMemory rewrites an entry in place (memory rewriting, not deletion).
func (d *DB) UpdateMemory(id int64, title, content, kind string, tags []string) (*Memory, error) {
	sets := []string{"updated_at=NOW()"}
	args := []any{id}
	if content != "" {
		args = append(args, content)
		sets = append(sets, fmt.Sprintf("content=$%d", len(args)))
	}
	if title != "" {
		args = append(args, title)
		sets = append(sets, fmt.Sprintf("title=$%d", len(args)))
	}
	if kind != "" {
		args = append(args, kind)
		sets = append(sets, fmt.Sprintf("kind=$%d", len(args)))
	}
	if tags != nil {
		args = append(args, strings.Join(tags, ","))
		sets = append(sets, fmt.Sprintf("tags=string_to_array($%d,',')", len(args)))
	}
	if _, err := d.Exec(`UPDATE memories SET `+strings.Join(sets, ", ")+` WHERE id=$1`, args...); err != nil {
		return nil, err
	}
	return d.GetMemory(id)
}

// DeleteMemory removes one entry.
func (d *DB) DeleteMemory(id int64) error {
	_, err := d.Exec(`DELETE FROM memories WHERE id=$1`, id)
	return err
}

// TouchMemories bumps the recall counter so unused entries can be pruned later.
func (d *DB) TouchMemories(ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := d.Exec(`UPDATE memories SET hits=hits+1 WHERE id = ANY($1)`, ids)
	return err
}
