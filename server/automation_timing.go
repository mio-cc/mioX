package server

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // Windows 没有系统 zoneinfo:内嵌时区库,tz 字段才能解析 Asia/Shanghai 等
)

// 自动化时间计算(S-2)。支持 once / every / daily / weekly / cron;cron 是自写的
// 5 字段解析(automation_cron.go),不引入新依赖。
//
//   once   {"at": "2026-11-22T09:00:00+08:00"}        RFC3339,必须在未来
//   every  {"every_sec": 300}                           最小 300 秒(5 分钟)
//   daily  {"time": "09:00", "tz": "Asia/Shanghai"}     tz 缺省 = 本机本地时区
//   weekly {"time": "09:00", "weekdays": [1,3,5], "tz": ""}  0=周日 … 6=周六
//   cron   {"expr": "0 9 * * 1-5", "tz": "Asia/Shanghai"}  分 时 日 月 周,间隔 ≥5 分钟
//
// 合并与追赶:调度器到期时用 nextAutomationRun(kind, timing, now) 求「严格晚于 now」
// 的下一次,所以停机期间错过的多次只会补跑最近一次(到期那一次),不会逐次重放。

const automationMinEverySec = 300

type automationTiming struct {
	At       string `json:"at,omitempty"`
	EverySec int64  `json:"every_sec,omitempty"`
	Time     string `json:"time,omitempty"`
	Weekdays []int  `json:"weekdays,omitempty"`
	TZ       string `json:"tz,omitempty"`
	Expr     string `json:"expr,omitempty"` // cron 5 字段表达式
}

// parseAutomationTiming validates kind + raw timing and returns the normalized
// struct plus its canonical JSON (only the fields that matter for the kind).
func parseAutomationTiming(kind string, raw json.RawMessage, now time.Time) (automationTiming, json.RawMessage, error) {
	var t automationTiming
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &t); err != nil {
			return t, nil, fmt.Errorf("timing 不是合法 JSON: %v", err)
		}
	}
	var canon any
	switch kind {
	case "once":
		at, err := time.Parse(time.RFC3339, strings.TrimSpace(t.At))
		if err != nil {
			return t, nil, fmt.Errorf("once 需要 timing.at(RFC3339 时间)")
		}
		if !at.After(now) {
			return t, nil, fmt.Errorf("时间必须在未来")
		}
		t.At = at.Format(time.RFC3339)
		canon = map[string]any{"at": t.At}
	case "every":
		if t.EverySec < automationMinEverySec {
			return t, nil, fmt.Errorf("every_sec 最小 %d 秒(5 分钟)", automationMinEverySec)
		}
		canon = map[string]any{"every_sec": t.EverySec}
	case "daily", "weekly":
		if _, _, err := parseHHMM(t.Time); err != nil {
			return t, nil, err
		}
		if _, err := automationLocation(t.TZ); err != nil {
			return t, nil, err
		}
		m := map[string]any{"time": t.Time}
		if t.TZ != "" {
			m["tz"] = t.TZ
		}
		if kind == "weekly" {
			days, err := normalizeWeekdays(t.Weekdays)
			if err != nil {
				return t, nil, err
			}
			t.Weekdays = days
			m["weekdays"] = days
		}
		canon = m
	case "cron":
		spec, err := parseCron(t.Expr)
		if err != nil {
			return t, nil, err
		}
		loc, err := automationLocation(t.TZ)
		if err != nil {
			return t, nil, err
		}
		if err := cronMinGapOK(spec, loc, now); err != nil {
			return t, nil, err
		}
		t.Expr = strings.Join(strings.Fields(t.Expr), " ")
		m := map[string]any{"expr": t.Expr}
		if t.TZ != "" {
			m["tz"] = t.TZ
		}
		canon = m
	default:
		return t, nil, fmt.Errorf("timing_kind 必须是 once/every/daily/weekly/cron")
	}
	b, _ := json.Marshal(canon)
	return t, b, nil
}

func parseHHMM(s string) (int, int, error) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("time 必须是 HH:MM")
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, fmt.Errorf("time 必须是 HH:MM(00:00-23:59)")
	}
	return h, m, nil
}

func normalizeWeekdays(in []int) ([]int, error) {
	if len(in) == 0 {
		return nil, fmt.Errorf("weekly 需要 weekdays(0=周日 … 6=周六,至少一天)")
	}
	seen := map[int]bool{}
	out := []int{}
	for _, d := range in {
		if d < 0 || d > 6 {
			return nil, fmt.Errorf("weekdays 取值 0-6(0=周日)")
		}
		if !seen[d] {
			seen[d] = true
			out = append(out, d)
		}
	}
	sort.Ints(out)
	return out, nil
}

// automationLocation resolves tz; "" = the machine's local zone.
func automationLocation(tz string) (*time.Location, error) {
	tz = strings.TrimSpace(tz)
	if tz == "" || strings.EqualFold(tz, "local") {
		return time.Local, nil
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, fmt.Errorf("未知时区 %q", tz)
	}
	return loc, nil
}

// nextAutomationRun returns the first occurrence strictly after `after`, or nil
// when the rule has no further occurrence (a once rule in the past).
// anchor is the every-rule phase reference (previous scheduled time; zero = after).
func nextAutomationRun(kind string, t automationTiming, after, anchor time.Time) (*time.Time, error) {
	switch kind {
	case "once":
		at, err := time.Parse(time.RFC3339, t.At)
		if err != nil {
			return nil, err
		}
		if at.After(after) {
			return &at, nil
		}
		return nil, nil
	case "every":
		if t.EverySec < automationMinEverySec {
			return nil, fmt.Errorf("every_sec 最小 %d", automationMinEverySec)
		}
		step := time.Duration(t.EverySec) * time.Second
		if anchor.IsZero() || anchor.After(after) {
			n := after.Add(step)
			return &n, nil
		}
		// Keep the original phase: anchor + k*step, smallest one > after. Missed
		// intervals collapse into a single next occurrence (no replay).
		k := after.Sub(anchor)/step + 1
		n := anchor.Add(k * step)
		return &n, nil
	case "daily", "weekly":
		h, m, err := parseHHMM(t.Time)
		if err != nil {
			return nil, err
		}
		loc, err := automationLocation(t.TZ)
		if err != nil {
			return nil, err
		}
		days := map[int]bool{}
		if kind == "weekly" {
			for _, d := range t.Weekdays {
				days[d] = true
			}
			if len(days) == 0 {
				return nil, fmt.Errorf("weekly 需要 weekdays")
			}
		}
		local := after.In(loc)
		for i := 0; i <= 8; i++ {
			day := local.AddDate(0, 0, i)
			cand := time.Date(day.Year(), day.Month(), day.Day(), h, m, 0, 0, loc)
			if !cand.After(after) {
				continue
			}
			if kind == "weekly" && !days[int(cand.Weekday())] {
				continue
			}
			return &cand, nil
		}
		return nil, fmt.Errorf("无法计算下一次运行时间")
	case "cron":
		spec, err := parseCron(t.Expr)
		if err != nil {
			return nil, err
		}
		loc, err := automationLocation(t.TZ)
		if err != nil {
			return nil, err
		}
		n, err := spec.next(after, loc)
		if err != nil {
			return nil, err
		}
		return &n, nil
	}
	return nil, fmt.Errorf("未知 timing_kind %q", kind)
}

// cronMinGapOK rejects rules that fire more often than every 5 minutes (same
// floor as every_sec): a pentest round takes far longer than that. Checks the
// next 64 occurrences, which covers any minute/hour pattern within a day.
func cronMinGapOK(spec *cronSpec, loc *time.Location, now time.Time) error {
	if now.IsZero() {
		now = time.Now()
	}
	prev, err := spec.next(now, loc)
	if err != nil {
		return err
	}
	for i := 0; i < 64; i++ {
		n, err := spec.next(prev, loc)
		if err != nil {
			return nil // rule ends (e.g. a single date): no gap to check
		}
		if n.Sub(prev) < automationMinEverySec*time.Second {
			return fmt.Errorf("cron 两次运行间隔不能小于 5 分钟（%s 与 %s）", prev.Format("15:04"), n.Format("15:04"))
		}
		prev = n
	}
	return nil
}

// previewAutomationRuns returns up to n upcoming occurrences after now.
func previewAutomationRuns(kind string, t automationTiming, now time.Time, n int) ([]time.Time, error) {
	out := []time.Time{}
	after, anchor := now, time.Time{}
	for len(out) < n {
		next, err := nextAutomationRun(kind, t, after, anchor)
		if err != nil {
			return nil, err
		}
		if next == nil {
			break
		}
		out = append(out, *next)
		after, anchor = *next, *next
	}
	return out, nil
}

// dueAutomationAdvance decides what a due automation does at `now`:
// scheduled = the occurrence being fired (its stored next_run_at), next = the
// following occurrence strictly after now (missed ones collapse), disable = the
// rule is exhausted (once). This is the merge/no-replay rule in one place.
func dueAutomationAdvance(kind string, t automationTiming, scheduled, now time.Time) (next *time.Time, disable bool, err error) {
	next, err = nextAutomationRun(kind, t, now, scheduled)
	if err != nil {
		return nil, false, err
	}
	return next, next == nil, nil
}
