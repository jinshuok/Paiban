-- Multi-group support: remove UNIQUE(tenant_id, username), add is_creator flag

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  is_creator INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, tenant_id, username, password_hash, role, is_creator, created_at)
SELECT id, tenant_id, username, password_hash, role, CASE WHEN role = 'admin' THEN 1 ELSE 0 END, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX idx_users_username ON users(username);
