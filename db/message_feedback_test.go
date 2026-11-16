package db

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// 消息反馈的存储语义（对照 DSH @deepseek-ai/dsh-client-ui-message-feedback）：
//   - MessageFeedbackActions.tsx:1-8  再点已记录的评分＝撤回；已记录的显示实心图标 → 一条消息
//     要么没有记录、要么恰好一条；
//   - controller.ts:161-170  rate() 是「创建或替换」→ 先赞后踩必须覆盖，不能变成两条。
func TestMessageFeedbackPutOverwriteAndRetract(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Skipf("postgres unavailable (%v) - skipping", err)
	}
	defer d.Close()

	task, err := d.CreateTaskWithOptions(fmt.Sprintf("message feedback %d", time.Now().UnixNano()), "goal", TaskCreateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	// 用 defer 而不是 t.Cleanup：t.Cleanup 在测试函数返回【之后】才跑，那时
	// `defer d.Close()` 已经把连接池关掉，删除会静默失败并留下垃圾任务。
	// defer 是 LIFO，所以这条先于 Close 执行。
	defer func() { _ = d.DeleteTask(task.ID) }()

	const sessionKey = "main:0"
	const seq = int64(42)
	category := "task-result"
	item, err := d.PutMessageFeedback(task.ID, sessionKey, seq, "up", &category, "  答案很准  ")
	if err != nil {
		t.Fatal(err)
	}
	if item.Rating != MessageFeedbackRatingUp || item.Category == nil || *item.Category != category || item.Text != "答案很准" {
		t.Fatalf("stored feedback = %+v, want up/task-result/答案很准 (text must be trimmed)", item)
	}
	if item.SessionKey != sessionKey || item.MessageSeq != seq || item.TaskID != task.ID {
		t.Fatalf("stored identity = %+v", item)
	}

	// 先赞后踩：必须覆盖成同一行，且只覆盖判断/分类/文字。
	other := "product-interaction"
	replaced, err := d.PutMessageFeedback(task.ID, sessionKey, seq, "down", &other, "其实答错了")
	if err != nil {
		t.Fatal(err)
	}
	if replaced.ID != item.ID {
		t.Fatalf("overwrite created a new row: id %d -> %d (UNIQUE(task_id,session_key,message_seq) missing)", item.ID, replaced.ID)
	}
	if replaced.Rating != MessageFeedbackRatingDown || replaced.Category == nil || *replaced.Category != other || replaced.Text != "其实答错了" {
		t.Fatalf("overwritten feedback = %+v, want down/product-interaction/其实答错了", replaced)
	}

	items, err := d.ListMessageFeedback(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("list returned %d rows, want exactly 1 (先赞后踩 is an overwrite)", len(items))
	}

	// 换一条消息 / 换一个会话都必须各自独立成行。
	if _, err := d.PutMessageFeedback(task.ID, sessionKey, seq+1, "up", nil, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := d.PutMessageFeedback(task.ID, "plan", seq, "down", nil, ""); err != nil {
		t.Fatal(err)
	}
	items, err = d.ListMessageFeedback(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 {
		t.Fatalf("list returned %d rows, want 3 (two seqs + two session keys)", len(items))
	}
	loaded, err := d.GetMessageFeedback(task.ID, sessionKey, seq+1)
	if err != nil || loaded == nil || loaded.Rating != MessageFeedbackRatingUp || loaded.Category != nil || loaded.Text != "" {
		t.Fatalf("message without category/text = %+v err=%v", loaded, err)
	}

	// 撤回：删掉匹配的那条；再撤一次是幂等的 false。
	deleted, err := d.DeleteMessageFeedback(task.ID, sessionKey, seq)
	if err != nil || !deleted {
		t.Fatalf("delete = %v err = %v, want true", deleted, err)
	}
	if loaded, _ := d.GetMessageFeedback(task.ID, sessionKey, seq); loaded != nil {
		t.Fatalf("retracted feedback still present: %+v", loaded)
	}
	if deleted, err = d.DeleteMessageFeedback(task.ID, sessionKey, seq); err != nil || deleted {
		t.Fatalf("repeated delete = %v err = %v, want false (idempotent)", deleted, err)
	}
	// 不带 session 的撤回（DELETE ?seq=N 的语义）仍然能删掉剩下的那条 plan:42。
	if deleted, err = d.DeleteMessageFeedback(task.ID, "", seq); err != nil || !deleted {
		t.Fatalf("session-less delete = %v err = %v, want true", deleted, err)
	}
	items, _ = d.ListMessageFeedback(task.ID)
	if len(items) != 1 {
		t.Fatalf("after retracting two rows %d remain, want 1", len(items))
	}
}

func TestMessageFeedbackRejectsBadInput(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Skipf("postgres unavailable (%v) - skipping", err)
	}
	defer d.Close()

	task, err := d.CreateTaskWithOptions(fmt.Sprintf("message feedback invalid %d", time.Now().UnixNano()), "goal", TaskCreateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = d.DeleteTask(task.ID) }()

	badCategory := "not-a-category"
	cases := []struct {
		name     string
		session  string
		seq      int64
		rating   string
		category *string
		text     string
	}{
		{name: "rating", session: "main:0", seq: 1, rating: "meh"},
		{name: "rating empty", session: "main:0", seq: 1, rating: ""},
		{name: "session key", session: "  ", seq: 1, rating: "up"},
		{name: "session key too long", session: strings.Repeat("x", MaxMessageFeedbackSessionKeyRunes+1), seq: 1, rating: "up"},
		{name: "seq zero", session: "main:0", seq: 0, rating: "up"},
		{name: "seq negative", session: "main:0", seq: -3, rating: "up"},
		{name: "text too long", session: "main:0", seq: 1, rating: "up", text: strings.Repeat("字", MaxMessageFeedbackTextRunes+1)},
		{name: "unknown category", session: "main:0", seq: 1, rating: "up", category: &badCategory},
	}
	for _, tc := range cases {
		if _, err := d.PutMessageFeedback(task.ID, tc.session, tc.seq, tc.rating, tc.category, tc.text); !errors.Is(err, ErrMessageFeedbackInvalid) {
			t.Fatalf("%s: error = %v, want ErrMessageFeedbackInvalid", tc.name, err)
		}
	}
	// 被拒绝的写入一行都不许留下。
	items, err := d.ListMessageFeedback(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("rejected writes left %d rows", len(items))
	}

	// 边界值必须被接受：正好 2000 字符的文字、空分类（nil）。
	if _, err := d.PutMessageFeedback(task.ID, "main:0", 1, "up", nil, strings.Repeat("字", MaxMessageFeedbackTextRunes)); err != nil {
		t.Fatalf("text at the 2000-rune limit was rejected: %v", err)
	}
	blank := "   "
	if item, err := d.PutMessageFeedback(task.ID, "main:0", 2, "down", &blank, ""); err != nil || item.Category != nil {
		t.Fatalf("blank category = %+v err = %v, want nil (no category)", item, err)
	}
}
