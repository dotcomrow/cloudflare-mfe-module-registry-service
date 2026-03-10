CREATE TABLE IF NOT EXISTS modules (
  module_key TEXT PRIMARY KEY,
  provider TEXT,
  component_type TEXT,
  latest_version_preview TEXT,
  latest_version_prod TEXT,
  latest_published_at_preview TEXT,
  latest_published_at_prod TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS module_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_key TEXT NOT NULL,
  module_version TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('preview', 'prod')),
  bundle_url TEXT NOT NULL,
  manifest_url TEXT NOT NULL,
  published_at TEXT,
  provider TEXT,
  component_type TEXT,
  release_json TEXT NOT NULL,
  definition_ref_json TEXT NOT NULL,
  seed_ref_json TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  seed_json TEXT NOT NULL,
  checksums_json TEXT NOT NULL,
  source_payload_json TEXT NOT NULL,
  screenshots_json TEXT NOT NULL,
  integrations_json TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(module_key, module_version, channel)
);

CREATE INDEX IF NOT EXISTS idx_module_versions_module_key
  ON module_versions(module_key);

CREATE INDEX IF NOT EXISTS idx_module_versions_channel
  ON module_versions(channel);

CREATE INDEX IF NOT EXISTS idx_module_versions_published_at
  ON module_versions(published_at DESC);

CREATE TABLE IF NOT EXISTS publish_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  module_key TEXT NOT NULL,
  module_version TEXT NOT NULL,
  channel TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  principal TEXT,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_publish_events_module
  ON publish_events(module_key, module_version, channel);
