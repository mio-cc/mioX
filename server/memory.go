package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/Autumn-27/artex/db"
)

// Memory endpoints back the cross-task memory surface: list/recall, write, rewrite,
// delete. They are deliberately plain REST so the agent tools and the UI share one
// implementation.

func (s *Server) listMemories(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	items, err := pg.ListMemories(db.MemoryQuery{
		Text:   strings.TrimSpace(q.Get("q")),
		Kind:   strings.TrimSpace(q.Get("kind")),
		Scope:  strings.TrimSpace(q.Get("scope")),
		TaskID: strings.TrimSpace(q.Get("task")),
		Tag:    strings.TrimSpace(q.Get("tag")),
		Limit:  limit,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// A recall is a recall: count it the same whether the agent or the operator asked,
	// so pruning can rely on one number.
	ids := make([]int64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	_ = pg.TouchMemories(ids)
	writeJSON(w, http.StatusOK, map[string]any{"memories": items})
}

func (s *Server) createMemory(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	var req struct {
		Scope   string   `json:"scope"`
		TaskID  string   `json:"task_id"`
		Kind    string   `json:"kind"`
		Title   string   `json:"title"`
		Content string   `json:"content"`
		Tags    []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := pg.CreateMemory(db.Memory{
		Scope: req.Scope, TaskID: req.TaskID, Kind: req.Kind,
		Title: req.Title, Content: req.Content, Tags: req.Tags,
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) updateMemory(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Title   string   `json:"title"`
		Content string   `json:"content"`
		Kind    string   `json:"kind"`
		Tags    []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := pg.UpdateMemory(id, req.Title, req.Content, req.Kind, req.Tags)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if item == nil {
		writeErr(w, http.StatusNotFound, "memory not found")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteMemory(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := pg.DeleteMemory(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}
