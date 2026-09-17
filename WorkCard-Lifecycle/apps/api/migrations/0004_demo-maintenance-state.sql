-- A durable owner-managed gate. A fresh/recovered database starts closed.
CREATE TABLE demo_maintenance_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  maintenance boolean NOT NULL DEFAULT true,
  maintenance_requested boolean NOT NULL DEFAULT true,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  last_reset_verified_at timestamptz,
  runtime_role_name name
);

INSERT INTO demo_maintenance_state(singleton) VALUES (true);

ALTER TABLE demo_sessions ADD COLUMN generation bigint NOT NULL DEFAULT 1
  CHECK (generation > 0);

REVOKE ALL ON demo_maintenance_state FROM PUBLIC;
