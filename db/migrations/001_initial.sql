CREATE TABLE __SCHEMA__.users (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE __SCHEMA__.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON __SCHEMA__.sessions(user_id);
CREATE TABLE __SCHEMA__.login_attempts (
  key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE __SCHEMA__.areas (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE __SCHEMA__.area_members (
  area_id uuid NOT NULL REFERENCES __SCHEMA__.areas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('manager', 'member', 'viewer')),
  PRIMARY KEY (area_id, user_id)
);
CREATE INDEX area_members_user_idx ON __SCHEMA__.area_members(user_id);
CREATE TABLE __SCHEMA__.projects (
  id uuid PRIMARY KEY,
  area_id uuid NOT NULL REFERENCES __SCHEMA__.areas(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  key text NOT NULL UNIQUE CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  description text NOT NULL DEFAULT '',
  next_task_number integer NOT NULL DEFAULT 1,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES __SCHEMA__.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_area_idx ON __SCHEMA__.projects(area_id);
CREATE TABLE __SCHEMA__.tasks (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES __SCHEMA__.projects(id),
  number integer NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','todo','in_progress','review','done')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  assignee_id uuid REFERENCES __SCHEMA__.users(id),
  due_date date,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES __SCHEMA__.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);
CREATE INDEX tasks_project_status_idx ON __SCHEMA__.tasks(project_id,status);
CREATE INDEX tasks_assignee_idx ON __SCHEMA__.tasks(assignee_id);
CREATE TABLE __SCHEMA__.comments (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES __SCHEMA__.tasks(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES __SCHEMA__.users(id),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_task_idx ON __SCHEMA__.comments(task_id,created_at);
CREATE TABLE __SCHEMA__.activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES __SCHEMA__.tasks(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES __SCHEMA__.users(id),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_task_idx ON __SCHEMA__.activity(task_id,created_at);
