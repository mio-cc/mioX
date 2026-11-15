package server

import (
	"bytes"
	"compress/gzip"
	"io/fs"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
)

// Shared static-file serving for the exported frontend. Both builds use it:
// the embedui build serves an embedded FS, the default build can serve a
// directory from disk (ARTEX_WEBUI_DIR), which lets the same binary serve the
// production export without a 28-minute frontend rebuild.

// gzipCache holds per-file gzipped payloads, produced on first request.
//
// The key includes the file's modtime and size, not just its name: this binary
// serves a directory that `next build` rewrites in place, and Turbopack reuses
// chunk names across builds. A name-only cache kept serving the previous build's
// bytes after a rebuild — the browser then loaded an HTML that referenced chunks
// which no longer existed and the page died with "Unexpected token '<'".
var gzipCache sync.Map // "name|modtime|size" -> []byte

// compressible reports whether a file benefits from gzip. Images and fonts are
// already compressed, so they are served as-is.
func compressible(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".map", ".webmanifest", ".xml":
		return true
	}
	return false
}

func gzipKey(name string, st fs.FileInfo) string {
	return name + "|" + strconv.FormatInt(st.ModTime().UnixNano(), 10) + "|" + strconv.FormatInt(st.Size(), 10)
}

// gzipped returns the gzipped bytes of name, computing and caching them once per
// (name, modtime, size) triple.
func gzipped(root fs.FS, name string, st fs.FileInfo) ([]byte, bool) {
	key := gzipKey(name, st)
	if cached, ok := gzipCache.Load(key); ok {
		return cached.([]byte), true
	}
	data, err := fs.ReadFile(root, name)
	if err != nil {
		return nil, false
	}
	var buf bytes.Buffer
	zw, err := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	if err != nil {
		return nil, false
	}
	if _, err := zw.Write(data); err != nil {
		_ = zw.Close()
		return nil, false
	}
	if err := zw.Close(); err != nil {
		return nil, false
	}
	out := buf.Bytes()
	gzipCache.Store(key, out)
	return out, true
}

// serveFileIfExists serves name from fsys when it exists as a regular file.
//
// Cache policy: everything revalidates.
//
// `immutable` was tried first and was WRONG here: Turbopack emits chunk names
// that are stable across builds (e.g. `1jexzsn2qdw84.js` kept its name while its
// contents changed), so a year-long immutable cache made browsers keep executing
// the previous build — the UI silently stayed on the old shell after a rebuild.
// Revalidation costs a 304 per asset on a local server, which is far cheaper than
// serving stale code. ETag/Last-Modified come from http.ServeContent.
func serveFileIfExists(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) bool {
	f, err := fsys.Open(name)
	if err != nil {
		return false
	}
	st, statErr := f.Stat()
	_ = f.Close()
	if statErr != nil || st.IsDir() {
		return false
	}

	w.Header().Set("Cache-Control", "no-cache")

	if compressible(name) && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		if data, ok := gzipped(fsys, name, st); ok {
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Set("Vary", "Accept-Encoding")
			http.ServeContent(w, r, name, st.ModTime(), bytes.NewReader(data))
			return true
		}
	}

	http.ServeFileFS(w, r, fsys, name)
	return true
}

// webuiFSHandler serves an exported Next app from root: exact file first, then
// `<p>/index.html` (trailingSlash export), then `<p>.html`, then the SPA
// fallback to index.html so client-side routing resolves unknown paths.
func webuiFSHandler(root fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		for _, cand := range []string{p, p + "/index.html", p + ".html"} {
			if serveFileIfExists(w, r, root, cand) {
				return
			}
		}
		serveFileIfExists(w, r, root, "index.html")
	})
}
