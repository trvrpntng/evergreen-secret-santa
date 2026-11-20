CREATE TABLE IF NOT EXISTS draw_assignments (
  draw_id TEXT NOT NULL,
  name_key TEXT NOT NULL,
  recipient TEXT NOT NULL,
  revealed INTEGER NOT NULL DEFAULT 0 CHECK (revealed IN (0, 1)),
  PRIMARY KEY (draw_id, name_key)
) WITHOUT ROWID;
