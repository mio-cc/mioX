package server

import (
	"database/sql"
	"os"
	"testing"

	"github.com/Autumn-27/artex/db"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// TestMain acquires a PostgreSQL advisory lock (7337741002) for the entire
// server test suite so cross-package DELETE cleanup races with db/agent
// packages are avoided when running `go test ./...`.
func TestMain(m *testing.M) {
	dsn, _, err := db.DSN()
	if err != nil {
		os.Exit(m.Run())
	}
	// Never run fixtures against the live database.
	if testDSN, derr := db.TestDatabaseDSN(dsn); derr == nil {
		dsn = testDSN
	}
	// Publish it: NewManager and every other helper call db.DSN() internally, so the
	// only way to keep the whole suite off the live database is to set the env var they
	// read. Without this, 48 NewManager call sites wrote fixtures into production (v0.88).
	os.Setenv("ARTEX_PG_DSN", dsn)

	conn, err := sql.Open("pgx", dsn)
	if err != nil || conn.Ping() != nil {
		os.Exit(m.Run())
	}
	defer conn.Close()
	if _, err := conn.Exec(`SELECT pg_advisory_lock(7337741002)`); err != nil {
		os.Exit(m.Run())
	}
	defer conn.Exec(`SELECT pg_advisory_unlock(7337741002)`) //nolint:errcheck
	os.Exit(m.Run())
}
