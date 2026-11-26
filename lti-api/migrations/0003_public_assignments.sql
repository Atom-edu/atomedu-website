CREATE TABLE public_assignments (
  id TEXT PRIMARY KEY,
  teacher_token_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  score_maximum REAL NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX public_assignments_expiry ON public_assignments(expires_at);

CREATE TABLE public_submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  student_name_key TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  manual_json TEXT NOT NULL DEFAULT '{}',
  score REAL NOT NULL,
  score_maximum REAL NOT NULL,
  grade_status TEXT NOT NULL,
  receipt TEXT NOT NULL UNIQUE,
  submitted_at INTEGER NOT NULL,
  graded_at INTEGER,
  UNIQUE (assignment_id, student_name_key)
);
CREATE INDEX public_submissions_assignment ON public_submissions(assignment_id, submitted_at);

CREATE TABLE public_create_limits (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, day)
);
