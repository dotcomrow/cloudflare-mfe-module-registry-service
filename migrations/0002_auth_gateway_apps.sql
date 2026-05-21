CREATE TABLE IF NOT EXISTS auth_gateway_apps (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  base_urls_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  module_key TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_gateway_apps_enabled
  ON auth_gateway_apps(enabled);

CREATE INDEX IF NOT EXISTS idx_auth_gateway_apps_module_key
  ON auth_gateway_apps(module_key);
