import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const path = process.env.NHAC_DB_PATH || resolve(root, 'data', 'nhac.sqlite');
if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
export const db = new DatabaseSync(path);
db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('MAIN','CUSTOMER')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), totp_encrypted TEXT,
  last_totp_counter INTEGER NOT NULL DEFAULT -1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(role <> 'MAIN' OR totp_encrypted IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, target_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER IF NOT EXISTS protect_last_main_update BEFORE UPDATE OF active, role ON users
WHEN OLD.role='MAIN' AND OLD.active=1 AND (NEW.role<>'MAIN' OR NEW.active<>1)
AND (SELECT COUNT(*) FROM users WHERE role='MAIN' AND active=1)<=1
BEGIN SELECT RAISE(ABORT,'last active MAIN'); END;
CREATE TRIGGER IF NOT EXISTS protect_last_main_delete BEFORE DELETE ON users
WHEN OLD.role='MAIN' AND OLD.active=1 AND (SELECT COUNT(*) FROM users WHERE role='MAIN' AND active=1)<=1
BEGIN SELECT RAISE(ABORT,'last active MAIN'); END;
INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);`);
