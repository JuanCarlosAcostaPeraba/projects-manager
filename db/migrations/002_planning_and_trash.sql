ALTER TABLE __SCHEMA__.tasks ADD COLUMN start_date date;
ALTER TABLE __SCHEMA__.tasks ADD CONSTRAINT tasks_date_range CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);

ALTER TABLE __SCHEMA__.areas
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES __SCHEMA__.users(id),
  ADD COLUMN deletion_batch uuid;
ALTER TABLE __SCHEMA__.projects
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES __SCHEMA__.users(id),
  ADD COLUMN deletion_batch uuid;
ALTER TABLE __SCHEMA__.tasks
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES __SCHEMA__.users(id),
  ADD COLUMN deletion_batch uuid;
ALTER TABLE __SCHEMA__.comments
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES __SCHEMA__.users(id),
  ADD COLUMN deletion_batch uuid;
CREATE INDEX areas_trash_idx ON __SCHEMA__.areas(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX projects_trash_idx ON __SCHEMA__.projects(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX tasks_trash_idx ON __SCHEMA__.tasks(deleted_at) WHERE deleted_at IS NOT NULL;
