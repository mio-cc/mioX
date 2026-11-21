package server

// P-1 计划模式硬边界开关（settings 键 plan_mode_strict，默认 false）。
//   - false：计划模式下调用非只读工具只记一条警告日志（不进模型），行为不变；
//   - true ：planGateHooks.PreToolUse 在计划批准前拒绝非只读工具，
//     回给模型「计划模式：此操作需在计划批准后执行」。
// 每轮读取（MainAgent.SetPlanStrict 接的是解析器），改设置即时生效、无需重建 agent。
const settingPlanModeStrict = "plan_mode_strict"

func (s *Server) planModeStrict() bool {
	if s == nil || s.m == nil || s.m.pg == nil {
		return false
	}
	return s.m.pg.GetBool(settingPlanModeStrict, false)
}
