package server

import (
	"net/http"
	"strconv"

	"github.com/Autumn-27/artex/db"
)

// turnFiles 返回一个主 Agent 回合的「改动文件卡」数据。
//
// 数据来源铁律（DSH `ui-deliverables/src/client/turn-deliverables.ts:1-7`）：
// 改动文件只能由**记录下来的成功改写调用**推出，绝不解析模型回复文本。这里复用
// db.TurnFileRows（只取 result 边界与 Write/Edit/MultiEdit 调用行）再由
// db.DeriveTurnFiles 聚合，接口本身不做任何文本解析。
//
// 参数：
//   - seg：主会话分段（缺省=当前分段），对应活动的 main_seg 列；
//   - end：收尾该回合的 result 活动 id；缺省=该分段最新回合（进行中的回合优先）；
//   - all=1：一次返回该分段全部回合 {"seg":N,"turns":[{"end":..,"files":[..]}]}，
//     供聊天流给每个回合各渲染一张卡（避免每回合一次请求）。
//
// 没有任何改动时返回空数组 []（不是 404）——「这个回合没改文件」是正常结果。
func (s *Server) turnFiles(w http.ResponseWriter, r *http.Request) {
	t, ok := s.m.Task(r.PathValue("id"))
	if !ok {
		writeErr(w, 404, "task not found")
		return
	}
	q := r.URL.Query()
	seg := 0
	if raw := q.Get("seg"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			writeErr(w, 400, "bad seg")
			return
		}
		seg = parsed
	} else {
		current, err := t.Store.CurrentMainSeg()
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		seg = current
	}
	rows, err := t.Store.TurnFileRows(seg)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	turns := db.DeriveTurnFiles(rows)
	if q.Get("all") == "1" {
		writeJSON(w, 200, map[string]any{"seg": seg, "turns": turns})
		return
	}
	end := int64(atoiDefault(q.Get("end"), 0))
	files := []db.TurnFile{}
	if end > 0 {
		// 指定回合：找不到（或该回合没改文件）就是空数组。
		for _, turn := range turns {
			if turn.End == end {
				files = turn.Files
				break
			}
		}
	} else if len(turns) > 0 {
		// 缺省取最新回合：进行中的回合若已有改动就是它（DeriveTurnFiles 只在
		// 进行中的回合有文件时才追加 End=0 组），否则是最近一个已收尾回合。
		files = turns[len(turns)-1].Files
	}
	writeJSON(w, 200, files)
}
