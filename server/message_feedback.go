package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	pgdb "github.com/Autumn-27/artex/db"
)

// 消息级反馈（Like / Dislike + 分类 + 文字）的人工接口 —— 对齐 DSH
// @deepseek-ai/dsh-client-ui-message-feedback:
//
//   - MessageFeedbackActions.tsx:1-8  Like/Dislike 在助手消息的 icon actions 行里（复制与分支
//     之间）；点任一个都【先开】本会话的反馈对话框，提交时才把判断连同分类与文字记录；再点已
//     记录的那个评分＝撤回；已记录的评分显示实心图标。
//   - MessageFeedbackActions.tsx:27  只在有权限时渲染（useAccess('messageFeedback/put')）。
//     mioX 没有 Peer 权限模型，接口按「本任务可见即可写」处理，UI 侧不再做权限判断。
//   - dialog.ts:1-6/16-19  一份表单服务两个目标（整个会话 / 单条消息）；字段只有 category
//     （可空）+ text；提交中忽略编辑。
//   - controller.ts:161-187  写＝创建或替换（rate），撤回＝删掉匹配的那条（retract）。
//
// 三个动词就是这三条语义的直译：PUT 写/覆盖、GET 列表（前端一次性 seed 所有按钮）、
// DELETE ?seq=N 撤回。

// MessageFeedbackDTO 是一条评分的线上形状（id 一律是字符串，跟本 API 其它 id 一致）。
type MessageFeedbackDTO struct {
	ID         string  `json:"id"`
	TaskID     string  `json:"task_id"`
	SessionKey string  `json:"session_key"`
	MessageSeq int64   `json:"message_seq"`
	Rating     string  `json:"rating"` // up | down
	Category   *string `json:"category"`
	Text       string  `json:"text"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
}

func messageFeedbackDTO(item *pgdb.MessageFeedback) *MessageFeedbackDTO {
	if item == nil {
		return nil
	}
	return &MessageFeedbackDTO{
		ID:         i64s(item.ID),
		TaskID:     i64s(item.TaskID),
		SessionKey: item.SessionKey,
		MessageSeq: item.MessageSeq,
		Rating:     item.Rating,
		Category:   item.Category,
		Text:       item.Text,
		CreatedAt:  rfc3339(item.CreatedAt),
		UpdatedAt:  rfc3339(item.UpdatedAt),
	}
}

func messageFeedbackDTOs(items []pgdb.MessageFeedback) []MessageFeedbackDTO {
	out := make([]MessageFeedbackDTO, 0, len(items))
	for i := range items {
		out = append(out, *messageFeedbackDTO(&items[i]))
	}
	return out
}

// messageFeedbackTaskID 解析路径里的任务号；任务不存在 → 404。
func (s *Server) messageFeedbackTaskID(w http.ResponseWriter, r *http.Request) (int64, *Task, bool) {
	t, ok := s.m.Task(r.PathValue("id"))
	if !ok {
		writeErr(w, 404, "task not found")
		return 0, nil, false
	}
	taskID, err := strconv.ParseInt(t.ID, 10, 64)
	if err != nil || taskID <= 0 {
		writeErr(w, 400, "bad task id")
		return 0, nil, false
	}
	return taskID, t, true
}

// writeMessageFeedbackError 把校验失败映射成 400（其余是 500）。
func writeMessageFeedbackError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgdb.ErrMessageFeedbackInvalid) {
		writeErr(w, 400, err.Error())
		return
	}
	writeErr(w, 500, err.Error())
}

// messageFeedbackPut 写入或覆盖一条评分：PUT /api/tasks/{id}/message-feedback。
// 唯一约束 (task_id, session_key, message_seq) 保证「先赞后踩」覆盖成一条。
func (s *Server) messageFeedbackPut(w http.ResponseWriter, r *http.Request) {
	taskID, t, ok := s.messageFeedbackTaskID(w, r)
	if !ok {
		return
	}
	// 反馈是旁挂记录，但它写的是本任务的行：任务正在删除时直接拒绝，
	// 避免 INSERT 与 DELETE 抢同一行（与目标/约束 CRUD 的纪律一致）。
	if !s.engine.beginTaskOperation(t.ID) {
		writeErr(w, 409, "任务正在删除,无法记录反馈")
		return
	}
	defer s.engine.decInflight(t.ID)

	var body struct {
		SessionKey string  `json:"session_key"`
		MessageSeq int64   `json:"message_seq"`
		Rating     string  `json:"rating"`
		Category   *string `json:"category"`
		Text       string  `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	item, err := s.m.PG().PutMessageFeedback(taskID, body.SessionKey, body.MessageSeq, body.Rating, body.Category, body.Text)
	if err != nil {
		writeMessageFeedbackError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"feedback": messageFeedbackDTO(item)})
}

// messageFeedbackList 列出本任务的全部评分：GET /api/tasks/{id}/message-feedback。
// 前端拿这份列表一次性 seed 所有按钮（已记录的显示实心图标），刷新后仍然实心。
func (s *Server) messageFeedbackList(w http.ResponseWriter, r *http.Request) {
	taskID, _, ok := s.messageFeedbackTaskID(w, r)
	if !ok {
		return
	}
	items, err := s.m.PG().ListMessageFeedback(taskID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"items": messageFeedbackDTOs(items)})
}

// messageFeedbackDelete 撤回一条评分：DELETE /api/tasks/{id}/message-feedback?seq=N[&session=main:0]。
// 不带 session 时按序号撤回（跨会话），与验收脚本的写法一致；重复撤回幂等。
func (s *Server) messageFeedbackDelete(w http.ResponseWriter, r *http.Request) {
	taskID, t, ok := s.messageFeedbackTaskID(w, r)
	if !ok {
		return
	}
	if !s.engine.beginTaskOperation(t.ID) {
		writeErr(w, 409, "任务正在删除,无法撤回反馈")
		return
	}
	defer s.engine.decInflight(t.ID)

	seq, err := strconv.ParseInt(r.URL.Query().Get("seq"), 10, 64)
	if err != nil || seq <= 0 {
		writeErr(w, 400, "seq 必须是正整数")
		return
	}
	deleted, err := s.m.PG().DeleteMessageFeedback(taskID, r.URL.Query().Get("session"), seq)
	if err != nil {
		writeMessageFeedbackError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "deleted": deleted})
}
