package server

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// fsDirs lists the sub-directories of a path so the web UI can offer a folder picker
// (reference: DSH picks a working directory when a session is created).
//
// Only directory names are returned — never file contents — and the listing is bounded,
// so pointing it at a huge directory cannot stall the request.
type fsDirEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type fsDirsResponse struct {
	Path    string       `json:"path"`
	Parent  string       `json:"parent,omitempty"`
	Roots   []fsDirEntry `json:"roots,omitempty"`
	Entries []fsDirEntry `json:"entries"`
	Error   string       `json:"error,omitempty"`
}

const fsDirListLimit = 500

// fsDirs handles GET /api/fs/dirs?path=<absolute dir>.
func (s *Server) fsDirs(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("path"))

	// No path: hand back the drive roots (Windows) or "/" so the picker has a start.
	if raw == "" {
		resp := fsDirsResponse{Entries: []fsDirEntry{}}
		for _, drive := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
			root := string(drive) + ":\\"
			if info, err := os.Stat(root); err == nil && info.IsDir() {
				resp.Roots = append(resp.Roots, fsDirEntry{Name: root, Path: root})
			}
		}
		if len(resp.Roots) == 0 {
			resp.Roots = []fsDirEntry{{Name: "/", Path: "/"}}
		}
		writeJSON(w, 200, resp)
		return
	}

	abs, err := filepath.Abs(raw)
	if err != nil {
		writeErr(w, 400, "路径无效："+err.Error())
		return
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		writeErr(w, 400, "目录不存在："+abs)
		return
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		writeErr(w, 403, "无法读取目录："+err.Error())
		return
	}
	resp := fsDirsResponse{Path: abs, Entries: []fsDirEntry{}}
	parent := filepath.Dir(abs)
	if parent != abs {
		resp.Parent = parent
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		// Hidden/system folders are noise in a picker.
		if strings.HasPrefix(name, ".") || strings.HasPrefix(name, "$") {
			continue
		}
		resp.Entries = append(resp.Entries, fsDirEntry{Name: name, Path: filepath.Join(abs, name)})
		if len(resp.Entries) >= fsDirListLimit {
			break
		}
	}
	sort.Slice(resp.Entries, func(i, j int) bool {
		return strings.ToLower(resp.Entries[i].Name) < strings.ToLower(resp.Entries[j].Name)
	})
	writeJSON(w, 200, resp)
}
