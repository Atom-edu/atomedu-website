CREATE TABLE platforms (
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  auth_url TEXT NOT NULL,
  token_url TEXT NOT NULL,
  jwks_url TEXT NOT NULL,
  service_origin TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (issuer, client_id)
);
CREATE TABLE deployments (
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (issuer, client_id, deployment_id)
);
CREATE TABLE launch_states (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  target_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  session_hash TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  roles TEXT NOT NULL,
  context_id TEXT NOT NULL,
  resource_link_id TEXT NOT NULL,
  services_json TEXT NOT NULL,
  deep_link_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE resource_links (
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  resource_link_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  PRIMARY KEY (issuer, client_id, deployment_id, context_id, resource_link_id)
);
CREATE INDEX launch_states_expiry ON launch_states(expires_at);
CREATE INDEX sessions_expiry ON sessions(expires_at);
