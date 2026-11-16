package db

import (
	"context"
	"fmt"
	"net/url"
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
// wrote (and deleted!) its fixtures there — one afternoon it created 86 junk tasks and
// wiped the configured LLM profile (v0.88/v0.90). Tests now default to a sibling
// `<db>_test` database that is created on demand, so a test run cannot touch real data.
//
// Precedence:
//  1. ARTEX_TEST_PG_DSN when set (lets CI point at a prepared server);
//  2. otherwise the live DSN with its database name suffixed by "_test";
//  3. the live DSN unchanged when it already ends with the suffix.
//
// The database name is replaced by URL surgery rather than by mutating pgx's ConnConfig:
// ConnConfig.ConnString() returns the ORIGINAL string it parsed, so a mutated Database
// field never reaches the caller (this exact mistake silently disabled the isolation).
func TestDatabaseDSN(liveDSN string) (string, error) {
	if explicit := strings.TrimSpace(os.Getenv("ARTEX_TEST_PG_DSN")); explicit != "" {
		return explicit, nil
	}
	u, err := url.Parse(liveDSN)
	if err != nil {
		return "", fmt.Errorf("parse dsn: %w", err)
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return "", fmt.Errorf("unsupported dsn scheme %q", u.Scheme)
	}
	live := strings.TrimPrefix(u.Path, "/")
	if live == "" {
		return "", fmt.Errorf("dsn has no database name")
	}
	if strings.HasSuffix(live, TestDatabaseNameSuffix) {
		return liveDSN, nil
	}
	testName := live + TestDatabaseNameSuffix
	if err := ensureTestDatabase(liveDSN, testName); err != nil {
		return "", err
	}
	out := *u
	out.Path = "/" + testName
	return out.String(), nil
}

// ensureTestDatabase creates name on the same server when it is missing. A concurrent
// create is not an error: PostgreSQL reports duplicate_database, which means it is there.
func ensureTestDatabase(liveDSN, name string) error {
	ctx := context.Background()
	u, err := url.Parse(liveDSN)
	if err != nil {
		return fmt.Errorf("parse dsn: %w", err)
	}
	admin := *u
	admin.Path = "/postgres"
	conn, err := pgx.Connect(ctx, admin.String())
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
