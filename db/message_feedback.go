package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// 消息级反馈（Like / Dislike + 分类 + 文字）—— 对齐 DSH
// @deepseek-ai/dsh-client-ui-message-feedback:
//
//   - MessageFeedbackActions.tsx:1-8  Like/Dislike 在助手消息的 icon actions 行里（复制与分支
//     之间）；点任一个都【先开】本会话的反馈对话框，提交时才把判断连同分类与文字记录；再点
//     已记录的那个评分＝撤回；已记录的评分显示实心图标（信号不依赖 hover）。
//   - dialog.ts:16-19  一份表单服务两个目标（整个会话 / 单条消息）；字段只有 category（可空）+ text。
//   - controller.ts:161-170  rate() 是「创建或替换」：同一目标只有一条记录。
//
// 因此这里的物理约束是 UNIQUE (task_id, session_key, message_seq)：先赞后踩是覆盖而不是两条
// （否则「再点已记录的那个评分＝撤回」就没有定义——该删哪条？）。
const (
	// MessageFeedbackRatingUp / MessageFeedbackRatingDown 是唯一的两种判断。
	MessageFeedbackRatingUp   = "up"
	MessageFeedbackRatingDown = "down"

	// MaxMessageFeedbackTextRunes 是补充文字上限。DSH 的 Host 对 note 有同样的量级限制
	// （controller.ts:69-70 的 note-too-large）。
	MaxMessageFeedbackTextRunes = 2000

	// MaxMessageFeedbackSessionKeyRunes 是会话键长度上限（'main:0' / 'plan' / 'intent:<id>'）。
	MaxMessageFeedbackSessionKeyRunes = 64
)

// ErrMessageFeedbackInvalid 是「请求本身不合法」的唯一哨兵，服务端映射成 400。
var ErrMessageFeedbackInvalid = errors.New("invalid message feedback")

// MessageFeedbackCategories 是分类白名单，与 DSH FeedbackDialog.tsx:23-32 的 FeedbackCategory
// 并集一一对应（client 包不能 import Host 的值，所以把联合类型重述成一张完整的表）。
var MessageFeedbackCategories = []string{
	"task-result",
	"instruction-following",
	"product-interaction",
	"service-stability",
	"resource-cost",
	"security-privacy-permission",
	"other",
}

// MessageFeedback 是一条消息的评分记录（每个 (task, session, seq) 最多一条）。
type MessageFeedback struct {
	ID         int64
	TaskID     int64
	SessionKey string
	MessageSeq int64
	Rating     string // up | down
	Category   *string
	Text       string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// "text" 是类型名同时也是非保留关键字，加引号避免任何歧义。
const messageFeedbackCols = `id, task_id, session_key, message_seq, rating, category, "text", created_at, updated_at`

func scanMessageFeedback(row interface{ Scan(...any) error }) (*MessageFeedback, error) {
	var item MessageFeedback
	var category sql.NullString
	if err := row.Scan(&item.ID, &item.TaskID, &item.SessionKey, &item.MessageSeq,
		&item.Rating, &category, &item.Text, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return nil, err
	}
	if category.Valid {
		value := category.String
		item.Category = &value
	}
	return &item, nil
}

// NormalizeMessageFeedbackRating 只接受 up / down（大小写与空白都归一化）。
func NormalizeMessageFeedbackRating(rating string) (string, error) {
	rating = strings.ToLower(strings.TrimSpace(rating))
	switch rating {
	case MessageFeedbackRatingUp, MessageFeedbackRatingDown:
		return rating, nil
	}
	return "", fmt.Errorf("%w: rating 只能是 up 或 down", ErrMessageFeedbackInvalid)
}

// NormalizeMessageFeedbackSessionKey 要求非空且不超过长度上限。
func NormalizeMessageFeedbackSessionKey(key string) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", fmt.Errorf("%w: session_key 不能为空", ErrMessageFeedbackInvalid)
	}
	if utf8.RuneCountInString(key) > MaxMessageFeedbackSessionKeyRunes {
		return "", fmt.Errorf("%w: session_key 不能超过 %d 字符", ErrMessageFeedbackInvalid, MaxMessageFeedbackSessionKeyRunes)
	}
	return key, nil
}

// NormalizeMessageFeedbackCategory 把 nil / 空白当作「没选分类」，其余必须在白名单里。
func NormalizeMessageFeedbackCategory(category *string) (*string, error) {
	if category == nil {
		return nil, nil
	}
	value := strings.TrimSpace(*category)
	if value == "" {
		return nil, nil
	}
	for _, allowed := range MessageFeedbackCategories {
		if value == allowed {
			return &value, nil
		}
	}
	return nil, fmt.Errorf("%w: category 必须是 %s 之一", ErrMessageFeedbackInvalid, strings.Join(MessageFeedbackCategories, " / "))
}

// NormalizeMessageFeedbackText 去掉首尾空白并限制长度（空文字是合法的：DSH dialog.ts:94
// 提交前 trim，空串就不带 text）。
func NormalizeMessageFeedbackText(text string) (string, error) {
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) > MaxMessageFeedbackTextRunes {
		return "", fmt.Errorf("%w: 文字不能超过 %d 字符", ErrMessageFeedbackInvalid, MaxMessageFeedbackTextRunes)
	}
	return text, nil
}

// PutMessageFeedback 写入或覆盖一条评分（DSH controller.ts:161-170 的 rate()）。
// 唯一约束让「先赞后踩」覆盖成一行：UPDATE 时 created_at 保留首次记录时间，
// updated_at 由触发器推进。
func (d *DB) PutMessageFeedback(taskID int64, sessionKey string, messageSeq int64, rating string, category *string, text string) (*MessageFeedback, error) {
	if taskID <= 0 {
		return nil, fmt.Errorf("%w: task_id 非法", ErrMessageFeedbackInvalid)
	}
	if messageSeq <= 0 {
		return nil, fmt.Errorf("%w: message_seq 必须是正整数", ErrMessageFeedbackInvalid)
	}
	sessionKey, err := NormalizeMessageFeedbackSessionKey(sessionKey)
	if err != nil {
		return nil, err
	}
	rating, err = NormalizeMessageFeedbackRating(rating)
	if err != nil {
		return nil, err
	}
	category, err = NormalizeMessageFeedbackCategory(category)
	if err != nil {
		return nil, err
	}
	text, err = NormalizeMessageFeedbackText(text)
	if err != nil {
		return nil, err
	}
	item, err := scanMessageFeedback(d.QueryRow(`
INSERT INTO message_feedback(task_id, session_key, message_seq, rating, category, "text")
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (task_id, session_key, message_seq) DO UPDATE
SET rating = EXCLUDED.rating,
    category = EXCLUDED.category,
    "text" = EXCLUDED."text",
    updated_at = now()
RETURNING `+messageFeedbackCols,
		taskID, sessionKey, messageSeq, rating, category, text))
	if err != nil {
		return nil, err
	}
	return item, nil
}

// ListMessageFeedback 返回本任务全部评分，按会话键 + 消息序号排序（前端一次性 seed 所有按钮，
// 对齐 controller.ts:241-257 的 load()）。
func (d *DB) ListMessageFeedback(taskID int64) ([]MessageFeedback, error) {
	if taskID <= 0 {
		return nil, nil
	}
	rows, err := d.Query(`SELECT `+messageFeedbackCols+`
FROM message_feedback WHERE task_id=$1 ORDER BY session_key, message_seq`, taskID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]MessageFeedback, 0, 8)
	for rows.Next() {
		item, scanErr := scanMessageFeedback(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

// GetMessageFeedback 读一条评分；(nil, nil) 表示这条消息还没有评分。
func (d *DB) GetMessageFeedback(taskID int64, sessionKey string, messageSeq int64) (*MessageFeedback, error) {
	item, err := scanMessageFeedback(d.QueryRow(`SELECT `+messageFeedbackCols+`
FROM message_feedback WHERE task_id=$1 AND session_key=$2 AND message_seq=$3`,
		taskID, sessionKey, messageSeq))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return item, nil
}

// DeleteMessageFeedback 撤回一条评分（DSH controller.ts:180-187 的 retract()）。
// sessionKey 为空表示不限会话（DELETE ?seq=N 的语义），返回是否真的删掉了一行，
// 这样重复撤回是幂等的而不是错误。
func (d *DB) DeleteMessageFeedback(taskID int64, sessionKey string, messageSeq int64) (bool, error) {
	if taskID <= 0 || messageSeq <= 0 {
		return false, fmt.Errorf("%w: task_id / message_seq 非法", ErrMessageFeedbackInvalid)
	}
	var (
		res sql.Result
		err error
	)
	if strings.TrimSpace(sessionKey) == "" {
		res, err = d.Exec(`DELETE FROM message_feedback WHERE task_id=$1 AND message_seq=$2`, taskID, messageSeq)
	} else {
		res, err = d.Exec(`DELETE FROM message_feedback WHERE task_id=$1 AND session_key=$2 AND message_seq=$3`,
			taskID, sessionKey, messageSeq)
	}
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
