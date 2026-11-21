package server

import (
	"encoding/json"
	"testing"
	"time"
)

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return loc
}

func TestParseAutomationTimingValidation(t *testing.T) {
	now := time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)
	cases := []struct {
		kind, raw string
		ok        bool
	}{
		{"every", `{"every_sec":300}`, true},
		{"every", `{"every_sec":299}`, false},
		{"once", `{"at":"2026-11-22T09:00:00+08:00"}`, true},
		{"once", `{"at":"2026-11-20T09:00:00+08:00"}`, false}, // past
		{"daily", `{"time":"09:00","tz":"Asia/Shanghai"}`, true},
		{"daily", `{"time":"24:00"}`, false},
		{"daily", `{"time":"09:00","tz":"Mars/Base"}`, false},
		{"weekly", `{"time":"09:00","weekdays":[1,3,5]}`, true},
		{"weekly", `{"time":"09:00","weekdays":[]}`, false},
		{"weekly", `{"time":"09:00","weekdays":[7]}`, false},
		{"bogus", `{}`, false},
	}
	for _, c := range cases {
		_, _, err := parseAutomationTiming(c.kind, json.RawMessage(c.raw), now)
		if (err == nil) != c.ok {
			t.Errorf("%s %s: err=%v, want ok=%v", c.kind, c.raw, err, c.ok)
		}
	}
	cronCases := []struct {
		raw string
		ok  bool
	}{
		{`{"expr":"0 9 * * 1-5","tz":"Asia/Shanghai"}`, true},
		{`{"expr":"*/15 * * * *"}`, true},
		{`{"expr":"* * * * *"}`, false},   // every minute: below the 5-minute floor
		{`{"expr":"*/2 * * * *"}`, false}, // every 2 minutes
		{`{"expr":"0 9 * *"}`, false},     // 4 fields
		{`{"expr":"60 9 * * *"}`, false},  // minute out of range
		{`{"expr":"0 0 31 2 *"}`, false},  // never fires
		{`{"expr":"0 9 * * 1","tz":"Mars/Base"}`, false},
	}
	for _, c := range cronCases {
		_, _, err := parseAutomationTiming("cron", json.RawMessage(c.raw), now)
		if (err == nil) != c.ok {
			t.Errorf("cron %s: err=%v, want ok=%v", c.raw, err, c.ok)
		}
	}
}

func TestPreviewCronWeekdays(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	// Friday 2026-11-20 10:00 local → next three weekday 09:00 runs are Mon/Tue/Wed.
	now := time.Date(2026, 11, 20, 10, 0, 0, 0, loc)
	got, err := previewAutomationRuns("cron", automationTiming{Expr: "0 9 * * 1-5", TZ: "Asia/Shanghai"}, now, 3)
	if err != nil || len(got) != 3 {
		t.Fatalf("got %v err %v", got, err)
	}
	want := []string{"2026-11-23 09:00 Mon", "2026-11-24 09:00 Tue", "2026-11-25 09:00 Wed"}
	for i, w := range want {
		if g := got[i].In(loc).Format("2006-01-02 15:04 Mon"); g != w {
			t.Errorf("run %d = %s, want %s", i, g, w)
		}
	}
	// Day-of-month OR day-of-week (Vixie semantics): the 1st, or any Sunday.
	got, err = previewAutomationRuns("cron", automationTiming{Expr: "30 8 1 * 0", TZ: "Asia/Shanghai"}, now, 3)
	if err != nil || len(got) != 3 {
		t.Fatalf("dom|dow got %v err %v", got, err)
	}
	want = []string{"2026-11-22 08:30 Sun", "2026-11-29 08:30 Sun", "2026-12-01 08:30 Tue"}
	for i, w := range want {
		if g := got[i].In(loc).Format("2006-01-02 15:04 Mon"); g != w {
			t.Errorf("dom|dow run %d = %s, want %s", i, g, w)
		}
	}
}

func TestPreviewEvery(t *testing.T) {
	now := time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)
	got, err := previewAutomationRuns("every", automationTiming{EverySec: 300}, now, 3)
	if err != nil || len(got) != 3 {
		t.Fatalf("got %v err %v", got, err)
	}
	for i, want := range []time.Duration{5, 10, 15} {
		if !got[i].Equal(now.Add(want * time.Minute)) {
			t.Errorf("run %d = %v, want +%dm", i, got[i], want)
		}
	}
}

func TestPreviewDailyAndWeeklyWithTZ(t *testing.T) {
	sh := mustLoc(t, "Asia/Shanghai")
	// Saturday 2026-11-21 10:00 Shanghai: 09:00 today already passed.
	now := time.Date(2026, 11, 21, 10, 0, 0, 0, sh)
	got, err := previewAutomationRuns("daily", automationTiming{Time: "09:00", TZ: "Asia/Shanghai"}, now, 3)
	if err != nil {
		t.Fatal(err)
	}
	want := []time.Time{
		time.Date(2026, 11, 22, 9, 0, 0, 0, sh),
		time.Date(2026, 11, 23, 9, 0, 0, 0, sh),
		time.Date(2026, 11, 24, 9, 0, 0, 0, sh),
	}
	for i := range want {
		if !got[i].Equal(want[i]) {
			t.Errorf("daily %d = %v want %v", i, got[i], want[i])
		}
	}
	// weekly Mon(1) + Fri(5)
	got, err = previewAutomationRuns("weekly", automationTiming{Time: "08:30", TZ: "Asia/Shanghai", Weekdays: []int{1, 5}}, now, 3)
	if err != nil {
		t.Fatal(err)
	}
	want = []time.Time{
		time.Date(2026, 11, 23, 8, 30, 0, 0, sh), // Mon
		time.Date(2026, 11, 27, 8, 30, 0, 0, sh), // Fri
		time.Date(2026, 11, 30, 8, 30, 0, 0, sh), // Mon
	}
	for i := range want {
		if !got[i].Equal(want[i]) {
			t.Errorf("weekly %d = %v want %v", i, got[i], want[i])
		}
	}
	// same-day later time is still today
	early := time.Date(2026, 11, 21, 7, 0, 0, 0, sh)
	n, _ := nextAutomationRun("daily", automationTiming{Time: "09:00", TZ: "Asia/Shanghai"}, early, time.Time{})
	if n == nil || !n.Equal(time.Date(2026, 11, 21, 9, 0, 0, 0, sh)) {
		t.Errorf("same-day next = %v", n)
	}
}

func TestPreviewOnceStopsAfterOne(t *testing.T) {
	now := time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)
	got, err := previewAutomationRuns("once", automationTiming{At: "2026-11-21T12:00:00Z"}, now, 3)
	if err != nil || len(got) != 1 {
		t.Fatalf("once preview = %v err %v", got, err)
	}
}

// 停机追赶:错过多次只补跑一次,下一次严格晚于 now 且保持原相位。
func TestDueAdvanceCollapsesMissedRuns(t *testing.T) {
	sched := time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)
	now := sched.Add(47 * time.Minute) // 9 个 5 分钟周期被错过
	next, disable, err := dueAutomationAdvance("every", automationTiming{EverySec: 300}, sched, now)
	if err != nil || disable || next == nil {
		t.Fatalf("next=%v disable=%v err=%v", next, disable, err)
	}
	want := sched.Add(50 * time.Minute)
	if !next.Equal(want) {
		t.Errorf("every next = %v want %v (phase-preserving, strictly after now)", next, want)
	}
	// daily: down for 3 days → next is the first 09:00 after now, not the missed ones.
	sh := mustLoc(t, "Asia/Shanghai")
	dSched := time.Date(2026, 11, 18, 9, 0, 0, 0, sh)
	dNow := time.Date(2026, 11, 21, 10, 0, 0, 0, sh)
	next, _, _ = dueAutomationAdvance("daily", automationTiming{Time: "09:00", TZ: "Asia/Shanghai"}, dSched, dNow)
	if next == nil || !next.Equal(time.Date(2026, 11, 22, 9, 0, 0, 0, sh)) {
		t.Errorf("daily catch-up next = %v", next)
	}
	// once: fires, then exhausted → disabled.
	next, disable, _ = dueAutomationAdvance("once", automationTiming{At: "2026-11-21T10:00:00Z"}, sched, now)
	if next != nil || !disable {
		t.Errorf("once after fire: next=%v disable=%v", next, disable)
	}
}

func TestAutomationDispatchDecision(t *testing.T) {
	cases := []struct {
		queued, active, busy bool
		want                 string
	}{
		{false, false, false, "deliver"},
		{false, false, true, "queue"},
		{false, true, false, "queue"},
		{true, false, false, "merge"},
		{true, true, true, "merge"},
	}
	for _, c := range cases {
		if got := automationDispatchDecision(c.queued, c.active, c.busy); got != c.want {
			t.Errorf("decision(%v,%v,%v) = %s want %s", c.queued, c.active, c.busy, got, c.want)
		}
	}
}
