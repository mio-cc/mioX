package server

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/Autumn-27/artex/db"
)

// Team task board endpoints. The board is per task: agents claim from it, the UI
// renders it as the team panel.

const maxTeamTaskRequestBytes = 32 << 10

type teamTaskCreateRequest struct {
	Subject   *string `json:"subject"`
	Detail    string  `json:"detail"`
	DependsOn []int64 `json:"depends_on"`
}

type teamTaskClaimRequest struct {
	Owner *string `json:"owner"`
}

func decodeTeamTaskCreate(w http.ResponseWriter, r *http.Request) (*teamTaskCreateRequest, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxTeamTaskRequestBytes)
	var request teamTaskCreateRequest
	if err := decode(r, &request); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeErr(w, http.StatusRequestEntityTooLarge, "请求正文过大")
		} else {
			writeErr(w, http.StatusBadRequest, err.Error())
		}
		return nil, false
	}
	if request.Subject == nil || strings.TrimSpace(*request.Subject) == "" {
		writeErr(w, http.StatusBadRequest, "任务标题不能为空")
		return nil, false
	}
	return &request, true
}

func writeTeamTaskError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrTeamTaskInvalid):
		writeErr(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, db.ErrTeamTaskNotReady), errors.Is(err, db.ErrTeamTaskBadState):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, db.ErrTeamTaskNotFound), errors.Is(err, db.ErrTeamTaskTaskGone):
		writeErr(w, http.StatusNotFound, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, err.Error())
	}
}

func (s *Server) pgListTeamTasks(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	taskID, ok := pathID(w, r)
	if !ok {
		return
	}
	items, err := pg.ListTeamTasks(taskID)
	if err != nil {
		writeTeamTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tasks":    items,
		"progress": db.TeamTaskProgress(items),
	})
}

func (s *Server) pgCreateTeamTask(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	taskID, ok := pathID(w, r)
	if !ok {
		return
	}
	request, ok := decodeTeamTaskCreate(w, r)
	if !ok {
		return
	}
	item, err := pg.CreateTeamTask(taskID, *request.Subject, request.Detail, request.DependsOn)
	if err != nil {
		writeTeamTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) pgClaimTeamTask(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTeamTaskRequestBytes)
	var request teamTaskClaimRequest
	if err := decode(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	owner := ""
	if request.Owner != nil {
		owner = *request.Owner
	}
	item, err := pg.ClaimTeamTask(id, owner)
	if err != nil {
		writeTeamTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) pgCompleteTeamTask(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	item, err := pg.CompleteTeamTask(id)
	if err != nil {
		writeTeamTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) pgDeleteTeamTask(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := pg.DeleteTeamTask(id); err != nil {
		writeTeamTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}

// pgDispatchTeamTask turns a manual board row into an exploration intent so the
// existing scheduler can pick it up. Board rows projected from intents already
// have a worker path; manual rows used to be inert.
func (s *Server) pgDispatchTeamTask(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	row, err := pg.GetTeamTask(id)
	if err != nil {
		writeTeamTaskError(w, err)
		return
	}
	if row == nil {
		writeErr(w, http.StatusNotFound, "team task not found")
		return
	}
	if row.SourceIntentID != nil {
		writeErr(w, http.StatusConflict, "该任务已派发")
		return
	}
	if row.Status != db.TeamTaskStatusPending {
		writeErr(w, http.StatusConflict, "只有待处理的任务可以派发")
		return
	}
	task, ok := s.m.Task(strconv.FormatInt(row.TaskID, 10))
	if !ok || task == nil {
		writeErr(w, http.StatusNotFound, "任务未在运行中，无法派发")
		return
	}
	payload := map[string]any{"summary": row.Subject}
	if row.Detail != "" {
		payload["detail"] = row.Detail
	}
	intentID, err := task.Store.AddIntent(payload, 7, nil, "human")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if origin, _ := task.Store.OriginFactID(); origin > 0 {
		_ = task.Store.Link(origin, db.RelDerivedFrom, intentID)
	}
	// AddIntent auto-projects a board row for the new intent; drop it so THIS row
	// adopts the intent instead of colliding with the projection on the unique index.
	_ = pg.DeleteTeamTaskByIntent(row.TaskID, intentID)
	if err := pg.LinkTeamTaskIntent(id, intentID); err != nil {
		writeTeamTaskError(w, err)
		return
	}
	// Wake the task so a worker claims the new intent without waiting for the
	// next planner round.
	task.Notify()
	writeJSON(w, http.StatusOK, map[string]any{"intent_id": intentID, "status": "dispatched"})
}

// pathID parses the {id} path value shared by the board routes.
func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := r.PathValue("id")
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "无效的 id")
		return 0, false
	}
	return id, true
}
