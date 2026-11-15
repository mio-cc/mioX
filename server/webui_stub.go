//go:build !embedui

package server

import (
	"net/http"
	"os"
	"path/filepath"
)

// webuiHandler is the no-embed handler (default build). The frontend is not
// bundled into this binary, but the same binary can still serve a production
// export straight from disk: point ARTEX_WEBUI_DIR at the exported directory
// (default: `web/out` next to the executable, or ./web/out in the working dir).
// That keeps `next build` → refresh as the whole iteration loop, with no
// 28-minute frontend rebuild and no second binary.
//
// When the directory is missing it keeps the original 404 so the development
// story (`next dev` on :3000/:3101) is unchanged.
func (s *Server) webuiHandler() http.Handler {
	dir := resolveWebuiDir()
	if dir == "" {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "前端未内嵌到此二进制（开发用 next dev；发布用 -tags embedui 构建，或用 ARTEX_WEBUI_DIR 指向导出的 web/out）", http.StatusNotFound)
		})
	}
	return webuiFSHandler(os.DirFS(dir))
}

// resolveWebuiDir returns the first candidate that actually holds an index.html.
func resolveWebuiDir() string {
	var candidates []string
	if v := os.Getenv("ARTEX_WEBUI_DIR"); v != "" {
		candidates = append(candidates, v)
	}
	if exe, err := os.Executable(); err == nil {
		base := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(base, "web", "out"),
			filepath.Join(base, "webui", "dist"),
		)
	}
	candidates = append(candidates, filepath.Join("web", "out"))
	for _, c := range candidates {
		if st, err := os.Stat(filepath.Join(c, "index.html")); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}
