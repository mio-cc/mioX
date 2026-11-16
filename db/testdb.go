package db

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// TestDatabaseNameSuffix is appended to the live database name to derive the database a
// test run uses.
const TestDatabaseNameSuffix = "_test"

// TestDatabaseDSN returns the DSN a test should use, never the live one.
//
// Why this exists: `go test ./server/ ./db/` used to run against the live database and
// wrote its fixtures there — one afternoon accumulated 86 junk tasks in the real task
// list (v0.88). Tests now default to a sibling `<db>_test` database that is created on
// demand, so a test run cannot pollute real data.
//
// Precedence:
//  1. ARTEX_TEST_PG_DSN when set (lets CI point at a prepared server);
//  2. otherwise the live DSN with its database name suffixed by "_test";
//  3. the live DSN unchanged when it already ends with the suffix.
func TestDatabaseDSN(liveDSN string) (string, error) {
	if explicit := strings.TrimSpace(os.Getenv("ARTEX_TEST_PG_DSN")); explicit != "" {
		return explicit, nil
	}
	cfg, err := pgx.ParseConfig(liveDSN)
	if err != nil {
		return "", fmt.Errorf("parse dsn: %w", err)
	}
	live := cfg.Database
	if live == "" {
		return "", fmt.Errorf("dsn has no database name")
	}
	if strings.HasSuffix(live, TestDatabaseNameSuffix) {
		return liveDSN, nil
	}
	testName := live + TestDatabaseNameSuffix
	if err := ensureTestDatabase(cfg, testName); err != nil {
		return "", err
	}
	testCfg := cfg.Copy()
	testCfg.Database = testName
	return testCfg.ConnString(), nil
}

// ensureTestDatabase creates name on the same server when it is missing. A concurrent
// create is not an error: PostgreSQL reports duplicate_database, which means it is there.
func ensureTestDatabase(cfg *pgx.ConnConfig, name string) error {
	ctx := context.Background()
	admin := cfg.Copy()
	admin.Database = "postgres"
	conn, err := pgx.ConnectConfig(ctx, admin)
	if err != nil {
		return fmt.Errorf("connect maintenance db: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()

	var exists bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname=$1)`, name).Scan(&exists); err != nil {
		return fmt.Errorf("check database %s: %w", name, err)
	}
	if exists {
		return nil
	}
	if _, err := conn.Exec(ctx, `CREATE DATABASE `+pgx.Identifier{name}.Sanitize()); err != nil {
		if pgErr, ok := err.(*pgconn.PgError); ok && pgErr.Code == "42P04" {
			return nil
		}
		return fmt.Errorf("create database %s: %w", name, err)
	}
	return nil
}
