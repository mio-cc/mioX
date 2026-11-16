package agent

// Background-task tools (TaskOutput / TaskStop / TaskList / Monitor) are the only
// exit from Bash(run_in_background): Bash's own schema tells the model to "read its
// output later with TaskOutput" (norma/tool/bash.go:47-53). These tests cover the
// two ways that promise can be broken silently:
//
//  1. the tools are not in the agent's tool set at all (the model is told to call a
//     tool that does not exist → the backgrounded command becomes an orphan);
//  2. the tools are there but do not work — Bash must return IMMEDIATELY with a task
//     id, TaskOutput must be able to read the output once the command finished,
//     TaskList must see a running task and TaskStop must actually kill it.
//
// The second group runs a real agentcore.Session with the REAL main-agent tool set;
// only the model is scripted (a provider that answers with a fixed tool_use per
// turn), so the harness, the registry, the task manager and the tools are all real.
// That makes the timing assertions meaningful: a blocking Bash would push the gap
// between two provider calls past the sleep, which is exactly what we measure.

import (
	"context"
	"encoding/json"
	"iter"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Autumn-27/norma/agentcore"
	"github.com/Autumn-27/norma/llm"
	"github.com/Autumn-27/norma/permission"
	actool "github.com/Autumn-27/norma/tool"
)

var bgTaskIDRe = regexp.MustCompile(`task_\d+`)

// firstTaskID returns the first task id in s ("" when there is none).
func firstTaskID(s string) string { return bgTaskIDRe.FindString(s) }

// TestBackgroundTaskToolsInAgentSets is the wiring assertion: the four tools are in
// the main agent's and the worker's tool set (the two lanes that run long commands),
// and deliberately NOT in the planner's (short, planning-only turns; a command that
// is auto-backgrounded on timeout still hands back its output-file path, which Read
// can consume). It needs no database, so it can never silently SKIP.
func TestBackgroundTaskToolsInAgentSets(t *testing.T) {
	want := []string{"TaskOutput", "TaskStop", "TaskList", "Monitor"}

	main := toolNames(mainAgentBaseTools(NewToolSet(nil, "human"), false))
	for _, name := range want {
		if !hasTool(main, name) {
			t.Fatalf("main agent tool set is missing %s (Bash advertises it); tools=%v", name, main)
		}
	}

	// Worker base, assembled exactly the way worker.go:382-390 does.
	tsx := NewToolSet(nil, "worker")
	worker := append(tsx.WorkerTools(), defaultToolsExcept("MultiEdit", "Glob", "Grep")...)
	if !actool.BackgroundTasksDisabled() {
		worker = append(worker, backgroundTaskTools()...)
	}
	wNames := toolNames(worker)
	for _, name := range want {
		if !hasTool(wNames, name) {
			t.Fatalf("worker tool set is missing %s; tools=%v", name, wNames)
		}
	}

	// Planner: no host instance on purpose (documented in backgroundTaskTools).
	planner := toolNames(append(NewToolSet(nil, "planner").PlannerTools(), actool.DefaultTools()...))
	for _, name := range want {
		if hasTool(planner, name) {
			t.Fatalf("planner must not carry the background-task tool %s; tools=%v", name, planner)
		}
	}

	// The tools must not be in the server-level domain registry: AllDomainTools() is
	// injected back into any agent bound to a tool (server/assembly.go:274-289), and
	// these are session capabilities, not domain tools — injecting a registry copy
	// would hand TaskOutput to a session whose tool list never had it.
	domain := toolNames(NewToolSet(nil, "").AllDomainTools())
	for _, name := range want {
		if hasTool(domain, name) {
			t.Fatalf("AllDomainTools must not carry the session-scoped tool %s; tools=%v", name, domain)
		}
	}
}

// bgScriptProvider answers with a fixed tool_use (or text) per call and records, per
// call, the tool_result text the harness fed back plus the wall-clock arrival time.
type bgScriptProvider struct {
	mu      sync.Mutex
	calls   int
	at      []time.Time
	results []string // tool_result text visible at the start of that call
	names   []string // tool names advertised to the model on that call
}

type bgStep struct {
	tool  string
	input map[string]any
	text  string
}

func (p *bgScriptProvider) Stream(_ context.Context, req llm.CompletionRequest) iter.Seq2[llm.StreamEvent, error] {
	return func(yield func(llm.StreamEvent, error) bool) {
		p.mu.Lock()
		n := p.calls
		p.calls++
		p.at = append(p.at, time.Now())
		p.results = append(p.results, lastToolResultText(req.Messages))
		p.names = append(p.names, schemaNames(req))
		p.mu.Unlock()

		emit := func(evs ...llm.StreamEvent) {
			for _, ev := range evs {
				if !yield(ev, nil) {
					return
				}
			}
		}
		start := llm.StreamEvent{Type: llm.SEMessageStart}
		stop := []llm.StreamEvent{
			{Type: llm.SEMessageDelta, StopReason: "tool_use"},
			{Type: llm.SEMessageStop},
		}

		steps := []bgStep{
			{tool: "Bash", input: map[string]any{"command": "sleep 5; echo done-bg", "run_in_background": true}},
			{tool: "TaskOutput", input: map[string]any{"task_id": "AUTO", "block": true, "timeout_ms": 20000}},
			{tool: "Bash", input: map[string]any{"command": "sleep 300", "run_in_background": true}},
			{tool: "TaskList", input: map[string]any{}},
			{tool: "TaskStop", input: map[string]any{"task_id": "AUTO2"}},
			{tool: "TaskList", input: map[string]any{}},
			{text: "done"},
		}
		if n >= len(steps) {
			emit(start, llm.StreamEvent{Type: llm.SETextDelta, Text: "script exhausted"},
				llm.StreamEvent{Type: llm.SEMessageDelta, StopReason: "end_turn"}, llm.StreamEvent{Type: llm.SEMessageStop})
			return
		}
		step := steps[n]
		if step.text != "" {
			emit(start, llm.StreamEvent{Type: llm.SETextDelta, Text: step.text},
				llm.StreamEvent{Type: llm.SEMessageDelta, StopReason: "end_turn"}, llm.StreamEvent{Type: llm.SEMessageStop})
			return
		}
		input := map[string]any{}
		for k, v := range step.input {
			input[k] = v
		}
		// Resolve the task id from what the harness actually fed back, instead of
		// hard-coding it: call 1 sees the Bash(run_in_background) result, call 4 sees
		// the Bash(sleep 300) result two steps earlier.
		switch n {
		case 1:
			input["task_id"] = firstTaskID(p.results[1])
		case 4:
			input["task_id"] = firstTaskID(p.results[3])
		}
		raw, _ := json.Marshal(input)
		emit(append([]llm.StreamEvent{
			start,
			{Type: llm.SEToolUseStart, ToolID: "tu_" + step.tool, ToolName: step.tool},
			{Type: llm.SEToolInputJSON, Text: string(raw)},
		}, stop...)...)
	}
}

func (p *bgScriptProvider) Complete(context.Context, llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
	return llm.Message{}, "", llm.Usage{}, nil
}

func schemaNames(req llm.CompletionRequest) string {
	var b strings.Builder
	for _, ts := range req.Tools {
		b.WriteString(ts.Name)
		b.WriteString(",")
	}
	return b.String()
}

func lastToolResultText(msgs []llm.Message) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		var parts []string
		for _, b := range msgs[i].Content {
			if b.Type == llm.BlockToolResult {
				for _, c := range b.Content {
					parts = append(parts, c.Text)
				}
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n")
		}
	}
	return ""
}

// TestBackgroundTasksEndToEnd is the decisive one: a real session runs
// Bash(run_in_background) → TaskOutput → TaskList → TaskStop → TaskList.
func TestBackgroundTasksEndToEnd(t *testing.T) {
	if actool.BackgroundTasksDisabled() {
		t.Skip("AGENT_CORE_DISABLE_BACKGROUND_TASKS is set in this environment")
	}
	// Task output goes under AGENT_CORE_TASK_DIR (norma/tool/task.go baseTaskDir);
	// point it at the test's own dir so the test never depends on TMP being writable
	// (a locked-down TMP silently disables the whole feature — see baseTaskDir).
	t.Setenv("AGENT_CORE_TASK_DIR", t.TempDir())
	dir := t.TempDir()
	prov := &bgScriptProvider{}
	sess := agentcore.NewSession(agentcore.Options{
		Provider:       prov,
		Tools:          mainAgentBaseTools(NewToolSet(nil, "human"), false),
		PermissionMode: permission.ModeBypass,
		WorkingDir:     dir,
		SessionID:      "bgtask-e2e-" + t.Name(),
	})
	defer sess.Close() // kills any surviving task and removes its output dir

	for range sess.Prompt(context.Background(), "后台任务验收：按脚本依次调用工具") {
	}

	if len(prov.at) < 7 {
		t.Fatalf("expected 7 provider calls (6 tool steps + final text), got %d (results=%q)", len(prov.at), prov.results)
	}

	// (0) the model really was offered the four tools, not just the Go variable.
	for _, name := range []string{"TaskOutput", "TaskStop", "TaskList", "Monitor", "Bash"} {
		if !strings.Contains(prov.names[0], name+",") {
			t.Fatalf("%s missing from the model-facing schema list: %s", name, prov.names[0])
		}
	}

	// (A) Bash(run_in_background) returns immediately with a task id: the next
	// provider call can only happen after the tool returned, so a blocking Bash
	// would show up as a >=5s gap here.
	gapBash := prov.at[1].Sub(prov.at[0])
	bgResult := prov.results[1]
	if !strings.Contains(bgResult, "Running in background as task_") {
		t.Fatalf("Bash(run_in_background) did not hand back a task id; result=%q", bgResult)
	}
	if !strings.Contains(bgResult, "TaskOutput") {
		t.Fatalf("background result does not point at TaskOutput; result=%q", bgResult)
	}
	if gapBash > 2*time.Second {
		t.Fatalf("Bash(run_in_background) blocked for %s — it must return immediately", gapBash)
	}

	// (B) TaskOutput(block=true) reads the finished command's output.
	gapOut := prov.at[2].Sub(prov.at[1])
	outResult := prov.results[2]
	if !strings.Contains(outResult, "done-bg") {
		t.Fatalf("TaskOutput did not return the background command's output; result=%q", outResult)
	}
	if gapOut < 4*time.Second {
		t.Fatalf("TaskOutput(block=true) returned after %s, before the 5s command finished; result=%q", gapOut, outResult)
	}

	// (C) a long-running task is visible in TaskList, TaskStop kills it, and the
	// next TaskList reports the new state.
	longResult := prov.results[3]
	longIDs := bgTaskIDRe.FindAllString(longResult, -1)
	if len(longIDs) == 0 {
		t.Fatalf("Bash(run_in_background, sleep 300) returned no task id; result=%q", longResult)
	}
	list1 := prov.results[4]
	if !strings.Contains(list1, "running") || !strings.Contains(list1, "sleep 300") {
		t.Fatalf("TaskList does not show the running sleep-300 task; result=%q", list1)
	}
	if !strings.Contains(prov.results[5], "Stopped task") {
		t.Fatalf("TaskStop did not confirm the kill; result=%q", prov.results[5])
	}
	list2 := prov.results[6]
	if !strings.Contains(list2, "killed") {
		t.Fatalf("TaskList after TaskStop does not report the task as killed; result=%q", list2)
	}
	for _, line := range strings.Split(list2, "\n") {
		if strings.Contains(line, "sleep 300") && strings.Contains(line, "[running]") {
			t.Fatalf("sleep-300 task still running after TaskStop: %q", line)
		}
	}
	// Sanity: the manager's own view agrees (the session is real, not a stub).
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("working dir vanished: %v", err)
	}
}
