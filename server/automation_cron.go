package server

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// cronSpec is a parsed 5-field cron expression: minute hour day-of-month month
// day-of-week. Supported per field: `*`, numbers, ranges `a-b`, lists `a,b`, and
// steps `*/n` / `a-b/n` / `a/n`. Day-of-week 0 and 7 are both Sunday. As in
// Vixie cron, when both day-of-month and day-of-week are restricted a day
// matches if EITHER does.
type cronSpec struct {
	minute, hour, dom, month, dow uint64
	domStar, dowStar              bool
}

type cronField struct {
	name     string
	min, max int
}

var cronFields = [5]cronField{
	{"分钟", 0, 59},
	{"小时", 0, 23},
	{"日", 1, 31},
	{"月", 1, 12},
	{"星期", 0, 7},
}

// parseCron validates and parses expr. Errors are user-facing (Chinese).
func parseCron(expr string) (*cronSpec, error) {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return nil, fmt.Errorf("cron 需要 5 个字段（分 时 日 月 周），当前 %d 个", len(fields))
	}
	var bits [5]uint64
	for i, f := range fields {
		b, err := parseCronField(f, cronFields[i])
		if err != nil {
			return nil, err
		}
		bits[i] = b
	}
	if bits[4]&(1<<7) != 0 { // 7 = Sunday
		bits[4] = (bits[4] | 1) &^ (1 << 7)
	}
	return &cronSpec{
		minute: bits[0], hour: bits[1], dom: bits[2], month: bits[3], dow: bits[4],
		domStar: fields[2] == "*" || fields[2] == "?",
		dowStar: fields[4] == "*" || fields[4] == "?",
	}, nil
}

func parseCronField(f string, spec cronField) (uint64, error) {
	if f == "" {
		return 0, fmt.Errorf("cron %s字段为空", spec.name)
	}
	var out uint64
	for _, part := range strings.Split(f, ",") {
		rng, stepStr, hasStep := strings.Cut(part, "/")
		step := 1
		if hasStep {
			n, err := strconv.Atoi(stepStr)
			if err != nil || n <= 0 {
				return 0, fmt.Errorf("cron %s字段步长无效：%q", spec.name, part)
			}
			step = n
		}
		lo, hi := spec.min, spec.max
		switch {
		case rng == "*" || rng == "?":
		case strings.Contains(rng, "-"):
			a, b, _ := strings.Cut(rng, "-")
			x, err1 := strconv.Atoi(a)
			y, err2 := strconv.Atoi(b)
			if err1 != nil || err2 != nil || x > y {
				return 0, fmt.Errorf("cron %s字段范围无效：%q", spec.name, part)
			}
			lo, hi = x, y
		default:
			x, err := strconv.Atoi(rng)
			if err != nil {
				return 0, fmt.Errorf("cron %s字段无效：%q", spec.name, part)
			}
			lo = x
			if !hasStep {
				hi = x
			}
		}
		if lo < spec.min || hi > spec.max {
			return 0, fmt.Errorf("cron %s字段超出范围 %d-%d：%q", spec.name, spec.min, spec.max, part)
		}
		for v := lo; v <= hi; v += step {
			out |= 1 << uint(v)
		}
	}
	return out, nil
}

func (c *cronSpec) dayMatches(t time.Time) bool {
	domOK := c.dom&(1<<uint(t.Day())) != 0
	dowOK := c.dow&(1<<uint(t.Weekday())) != 0
	switch {
	case c.domStar && c.dowStar:
		return true
	case c.domStar:
		return dowOK
	case c.dowStar:
		return domOK
	default:
		return domOK || dowOK
	}
}

// next returns the first matching minute strictly after `after`, evaluated in loc.
// The search is bounded (5 years) so an impossible rule like `0 0 31 2 *` errors
// instead of spinning.
func (c *cronSpec) next(after time.Time, loc *time.Location) (time.Time, error) {
	t := after.In(loc).Truncate(time.Minute).Add(time.Minute)
	limit := t.AddDate(5, 0, 0)
	for t.Before(limit) {
		if c.month&(1<<uint(t.Month())) == 0 {
			t = time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, loc)
			continue
		}
		if !c.dayMatches(t) {
			t = time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, loc)
			continue
		}
		if c.hour&(1<<uint(t.Hour())) == 0 {
			t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour()+1, 0, 0, 0, loc)
			continue
		}
		if c.minute&(1<<uint(t.Minute())) == 0 {
			t = t.Add(time.Minute)
			continue
		}
		return t, nil
	}
	return time.Time{}, fmt.Errorf("cron 规则在 5 年内没有可运行的时间")
}
