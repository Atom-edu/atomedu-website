ALTER TABLE sessions ADD COLUMN activity_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN display_name TEXT NOT NULL DEFAULT '';

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  creator_subject TEXT NOT NULL,
  title TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  score_maximum REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX activities_context ON activities(issuer, client_id, deployment_id, context_id, created_at);

CREATE TABLE submissions (
  activity_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  resource_link_id TEXT NOT NULL,
  lineitem_url TEXT NOT NULL DEFAULT '',
  answers_json TEXT NOT NULL,
  manual_json TEXT NOT NULL DEFAULT '{}',
  score REAL NOT NULL,
  score_maximum REAL NOT NULL,
  submitted_at INTEGER NOT NULL,
  graded_at INTEGER,
  grade_status TEXT NOT NULL DEFAULT 'pending',
  grade_error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (activity_id, subject)
);
CREATE INDEX submissions_activity ON submissions(activity_id, submitted_at);
