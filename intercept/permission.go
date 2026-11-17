// Package intercept — permission levels.
//
// DSH ui-permission-presets semantics (doc 42 §D10): a session-scoped
// permission preset with three levels plus "auto" (follow the existing
// rule + LLM-judge pipeline). The level is the DEFAULT action surface for
// tools that no intercept rule matches; explicit rules always win.
package intercept

import "strings"

// PermissionLevel mirrors DSH's read-only / workspace-write /
// danger-full-access presets, plus "auto" (no preset: the existing rule +
// judge pipeline decides).
type PermissionLevel string

const (
	// LevelAuto keeps current behavior: rules, then the LLM fallback judge.
	LevelAuto PermissionLevel = "auto"
	// LevelReadOnly denies every state-changing tool.
	LevelReadOnly PermissionLevel = "read-only"
	// LevelWorkspaceWrite allows file writes inside the workspace but
	// denies destructive / out-of-workspace / exfil tools.
	LevelWorkspaceWrite PermissionLevel = "workspace-write"
	// LevelDangerFull denies nothing (explicit rules still apply).
	LevelDangerFull PermissionLevel = "danger-full"
)

// ParsePermissionLevel normalizes a stored value; unknown values fall back
// to auto so an old DB row never bricks a session.
func ParsePermissionLevel(s string) PermissionLevel {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "read-only", "read_only", "readonly":
		return LevelReadOnly
	case "workspace-write", "workspace_write", "workspacewrite":
		return LevelWorkspaceWrite
	case "danger-full", "danger_full", "dangerfull", "full":
		return LevelDangerFull
	default:
		return LevelAuto
	}
}

// Valid reports whether l is one of the four known levels.
func (l PermissionLevel) Valid() bool {
	switch l {
	case LevelAuto, LevelReadOnly, LevelWorkspaceWrite, LevelDangerFull:
		return true
	default:
		return false
	}
}

// stateChangingTools are blocked at read-only. They mutate the file system,
// the database, or the task state (DSH read-only preset semantics).
var stateChangingTools = map[string]bool{
	"Write":              true,
	"Edit":               true,
	"MultiEdit":          true,
	"insert_assets":      true,
	"record_fact":        true,
	"report_finding":     true,
	"set_goals":          true,
	"add_task_scope":     true,
	"team_add":           true,
	"team_claim":         true,
	"team_complete":      true,
	"create_task":        true,
	"pause_task":         true,
	"resume_task":        true,
	"delete_assets_by_host": true,
}

// destructiveTools are additionally blocked at workspace-write: shell
// commands, deletion, and anything with global side effects beyond the
// workspace directory.
var destructiveTools = map[string]bool{
	"Bash":                true,
	"shell_open":          true,
	"shell_send":          true,
	"delete_assets_by_host": true,
}

// riskTools require explicit human confirmation regardless of the
// permission preset (D10-T3, DSH risk-confirmation flow). These perform
// irreversible global operations — no preset silently allows them.
var riskTools = map[string]bool{
	"delete_assets_by_host": true,
}

// RequiresConfirmation reports whether the tool always needs a human
// approve/deny decision, independent of the session permission level.
func RequiresConfirmation(tool string) bool {
	return riskTools[tool]
}

// PresetDenied returns true when the level forbids the tool outright.
// Explicit intercept rules still win: the caller checks rules first.
func (l PermissionLevel) PresetDenied(tool string) bool {
	switch l {
	case LevelReadOnly:
		return stateChangingTools[tool] || destructiveTools[tool]
	case LevelWorkspaceWrite:
		return destructiveTools[tool]
	default:
		return false
	}
}

// PresetMessage is the model-facing reason when the preset denies a call.
func (l PermissionLevel) PresetMessage(tool string) string {
	switch l {
	case LevelReadOnly:
		return "当前权限档为 read-only：不允许调用会改变状态的工具（" + tool + "）。改用只读工具侦察。"
	case LevelWorkspaceWrite:
		return "当前权限档为 workspace-write：不允许调用有全局副作用的工具（" + tool + "）。"
	default:
		return ""
	}
}
