package intercept

// 计划审阅（plan review）——按 DSH @deepseek-ai/dsh-plan-mode 的审阅闭环实现。
//
// DSH 源码事实（项目分析\dsh-src\dsh__node_modules__@deepseek-ai__dsh-plan-mode__src__index.ts）：
//   - :310-313 取 `userQuestions` 通道，没有通道就抛错（fail closed）：
//     "no user-questions channel is available to review the plan"
//   - :316-333 `await interaction.ask({questions:[{ id: REVIEW_ID, header: 'Plan review',
//     question: 'Approve this plan and leave plan mode?', detail: args.plan, options: [...] }]})`
//     —— 审阅是**当场提问**，detail 就是完整 markdown 计划，两个选项：
//     APPROVE_LABEL（离开计划模式，从下一步开始执行）/ KEEP_PLANNING_LABEL（继续规划，反馈回模型）。
//   - :339-341 用户取消/关闭提问（ASK_CANCELLED）→ `exec.concludeTurn()` + `return {approved:false}`：
//     **本轮结束，不再发模型请求**，也不是失败。
//   - :352-357 不是选 Approve → 抛错把反馈带回模型：
//     "The user chose to keep planning; revise the plan and present it again."，
//     带反馈时是 "The user chose to keep planning; their feedback: <feedback>"。
//   - :358-362 选 Approve → `pendingIntents.set(session, {active:false})`，计划模式退出。
//
// 本文件对应关系：复用已有的 intercept_pending 审批表与 ResolveIntercept 的
// audit.effective_action 字段承载三态结果（批准 / 继续规划 / 关闭审阅），
// 不新造第二套审批通道：
//   - pending 行：tool_name = "exit_plan_mode"（判别字段），tool_input = {title, plan}，
//     reason 以 "[计划]" 开头 → decision_source = "plan"。
//   - 用户决定：POST /api/intercept/pending/{id}/plan-review
//     {"decision":"approve"|"keep_planning"|"dismiss","feedback":"..."}
//   - 等待：与 HandleAsk 相同的内存 channel（此处承载 PlanReviewOutcome 而不是 bool）。

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/Autumn-27/artex/db"
)

// ExitPlanModeTool 是模型提交计划用的工具名（DSH index.ts:64），也是计划审阅
// pending 行的判别字段（tool_name）。保持 snake_case 原样。
const ExitPlanModeTool = "exit_plan_mode"

// 计划审阅的三种结果。前两个对应 DSH index.ts:322-325 的两个选项，
// 第三个对应 index.ts:339-341 的 ASK_CANCELLED（用户关闭审阅）。
const (
	PlanReviewApprove = "approve"
	PlanReviewKeep    = "keep_planning"
	PlanReviewDismiss = "dismiss"
)

// 写进 intercept_pending.audit.effective_action 的动作值，让审批历史/任务审批页
// 能把三种结果区分开（ResolveIntercept 会把它合并进 audit）。
const (
	PlanActionApprove = "plan_approve"
	PlanActionKeep    = "plan_keep"
	PlanActionDismiss = "plan_dismiss"
)

// PlanReasonPrefix 让 decision_source 标成 "plan"（见 interceptSource），
// 与规则命中（rule）/模型判定（model）区分开。
const PlanReasonPrefix = "[计划]"

// PlanReviewOutcome 是一次计划审阅的结果（DSH index.ts:314-362 的三种走向）。
type PlanReviewOutcome struct {
	// Approved 为 true = 用户选 Approve：退出计划模式，下一步开始执行。
	Approved bool
	// Dismissed 为 true = 用户关闭/取消审阅：本轮结束，不再请求模型（concludeTurn）。
	Dismissed bool
	// Feedback 是"继续规划"时用户写的反馈原文（可能为空）。
	Feedback string
}

// planPendingManager 跟踪在途的计划审阅（每个 pending 一个 channel）。
type planPendingManager struct {
	mu sync.Mutex
	ch map[int64]chan PlanReviewOutcome
}

func newPlanPendingManager() *planPendingManager {
	return &planPendingManager{ch: map[int64]chan PlanReviewOutcome{}}
}

func (p *planPendingManager) add(id int64) chan PlanReviewOutcome {
	ch := make(chan PlanReviewOutcome, 1)
	p.mu.Lock()
	p.ch[id] = ch
	p.mu.Unlock()
	return ch
}

func (p *planPendingManager) resolve(id int64, out PlanReviewOutcome) {
	p.mu.Lock()
	ch, ok := p.ch[id]
	delete(p.ch, id)
	p.mu.Unlock()
	if ok {
		ch <- out
	}
}

func (p *planPendingManager) remove(id int64) {
	p.mu.Lock()
	delete(p.ch, id)
	p.mu.Unlock()
}

// has 报告 id 是否是一次在途的计划审阅（供 Decide 分流用）。
func (p *planPendingManager) has(id int64) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	_, ok := p.ch[id]
	return ok
}

// AskPlanReview 发起一次计划审阅并**阻塞**等用户决定：写一条 intercept_pending
// （tool_name=exit_plan_mode，tool_input={title,plan}），往会话流写一条
// kind="plan_review" 的 activity（前端渲染成审阅卡片），然后等
// DecidePlanReview / Decide 把结果送回来。
//
// 返回 error 只在"审阅通道不可用"时出现（DSH index.ts:310-313 的 fail closed）：
// 调用方必须把错误交给模型，而不是假装计划已提交。
func (i *Interceptor) AskPlanReview(ctx context.Context, title, plan string, emit func(db.Activity)) (PlanReviewOutcome, error) {
	if i == nil || i.db == nil {
		return PlanReviewOutcome{}, fmt.Errorf("审批存储不可用")
	}
	convID := ConvIDFromContext(ctx)
	taskID, agentName := taskInfoFromCtx(ctx)
	if emit == nil {
		emit = taskEmitFromCtx(ctx)
	}
	payload, err := json.Marshal(map[string]any{"title": title, "plan": plan})
	if err != nil {
		return PlanReviewOutcome{}, fmt.Errorf("计划序列化失败: %w", err)
	}
	reason := PlanReasonPrefix + "计划审阅：" + title
	// 带一份 audit：ResolveIntercept 会把 effective_action/decision_reason 合并进去，
	// 审批历史里就能看到"批准/继续规划/关闭"三种结果（见本文件头部说明）。
	audit := auditFor(ctx, Decision{Action: "ask", Message: reason}, payload, "pending")
	pendingID, err := i.db.CreateInterceptPending(0, convID, taskID, agentName, ExitPlanModeTool, payload, reason, audit)
	if err != nil {
		log.Printf("[intercept] create plan review pending failed (task=%q title=%q): %v", taskID, title, err)
		return PlanReviewOutcome{}, fmt.Errorf("创建审阅记录失败: %w", err)
	}

	ch := i.planPending.add(pendingID)
	defer i.planPending.remove(pendingID)
	// 与 HandleAsk 相同的竞态：INSERT 提交后、channel 注册前用户就可能已经决定了。
	// 注册后重读一次，避免这次决定丢失。
	if saved, err := i.db.GetInterceptDetail(pendingID); err == nil && saved != nil && saved.Status != "pending" {
		return planOutcomeFromDetail(saved), nil
	}

	detail, _ := json.Marshal(map[string]any{"pending_id": pendingID, "title": title, "plan": plan})
	activity := db.Activity{
		Kind:    "plan_review",
		Summary: fmt.Sprintf("计划审阅：%s (#%d)", title, pendingID),
		Detail:  string(detail),
	}
	if convID != 0 {
		_, _ = i.db.AppendConvActivity(convID, activity)
	} else if emit != nil {
		emit(activity)
	}

	select {
	case out := <-ch:
		return out, nil
	case <-ctx.Done():
		// 工作被取消（暂停/关机）：按"关闭审阅"收尾，别把 pending 留在表里。
		_, _ = i.db.ResolveIntercept(pendingID, "denied", PlanActionDismiss, "工作已取消")
		return PlanReviewOutcome{Dismissed: true}, nil
	}
}

// planOutcomeFromDetail 把一条已决定的 pending 行还原成审阅结果
// （用于"决定早于 channel 注册"的竞态，以及重启后的幂等读取）。
func planOutcomeFromDetail(d *db.InterceptDetail) PlanReviewOutcome {
	if d == nil {
		return PlanReviewOutcome{Dismissed: true}
	}
	if d.Audit != nil {
		switch d.Audit.EffectiveAction {
		case PlanActionApprove:
			return PlanReviewOutcome{Approved: true}
		case PlanActionKeep:
			return PlanReviewOutcome{Feedback: strings.TrimPrefix(d.Audit.DecisionReason, "用户要求继续规划：")}
		case PlanActionDismiss:
			return PlanReviewOutcome{Dismissed: true}
		}
	}
	if d.Status == "allowed" {
		return PlanReviewOutcome{Approved: true}
	}
	return PlanReviewOutcome{Dismissed: true}
}

// DecidePlanReview 处理一次计划审阅决定（由 HTTP 端点调用）。
// decision ∈ {approve, keep_planning, dismiss}；feedback 只在 keep_planning 时有意义。
func (i *Interceptor) DecidePlanReview(pendingID int64, decision, feedback string) error {
	feedback = strings.TrimSpace(feedback)
	var status, action, reason string
	switch decision {
	case PlanReviewApprove:
		status, action, reason = "allowed", PlanActionApprove, "用户批准计划，退出计划模式"
	case PlanReviewKeep:
		status, action, reason = "denied", PlanActionKeep, "用户要求继续规划"
		if feedback != "" {
			reason = "用户要求继续规划：" + feedback
		}
	case PlanReviewDismiss:
		status, action, reason = "denied", PlanActionDismiss, "用户关闭了计划审阅"
	default:
		return fmt.Errorf("decision 必须是 approve、keep_planning 或 dismiss")
	}
	resolved, err := i.db.ResolveIntercept(pendingID, status, action, reason)
	if err != nil {
		return err
	}
	if !resolved {
		return ErrAlreadyDecided
	}
	i.planPending.resolve(pendingID, PlanReviewOutcome{
		Approved:  decision == PlanReviewApprove,
		Dismissed: decision == PlanReviewDismiss,
		Feedback:  feedback,
	})
	return nil
}
