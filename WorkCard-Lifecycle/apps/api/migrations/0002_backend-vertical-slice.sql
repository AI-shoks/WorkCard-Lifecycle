ALTER TABLE production_passports
  DROP CONSTRAINT production_passports_product_code_key,
  ADD COLUMN revision text NOT NULL DEFAULT 'A',
  ADD CONSTRAINT production_passports_revision_not_blank
    CHECK (revision = btrim(revision) AND revision <> ''),
  ADD CONSTRAINT production_passports_code_revision_unique UNIQUE (product_code, revision);

ALTER TABLE operation_plans ADD COLUMN scope_code text;

UPDATE operation_plans
SET scope_code = 'OP-' || lpad(operation_number::text, 3, '0')
WHERE scope_code IS NULL;

ALTER TABLE operation_plans
  ALTER COLUMN scope_code SET NOT NULL,
  ADD CONSTRAINT operation_plans_scope_code_not_blank
    CHECK (scope_code = btrim(scope_code) AND scope_code <> ''),
  ADD CONSTRAINT operation_plans_passport_scope_unique UNIQUE (passport_id, scope_code);

CREATE TABLE demo_sessions (
  id uuid PRIMARY KEY,
  demo_user_id uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
  csrf_token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  CONSTRAINT demo_sessions_lifetime_valid
    CHECK (
      created_at <= last_seen_at
      AND last_seen_at <= idle_expires_at
      AND idle_expires_at <= expires_at
    )
);

CREATE INDEX demo_sessions_expires_at_idx ON demo_sessions(expires_at);
CREATE INDEX demo_sessions_demo_user_id_idx ON demo_sessions(demo_user_id);

CREATE TABLE production_batches (
  id uuid PRIMARY KEY,
  quantity integer NOT NULL CHECK (quantity > 0),
  source_passport_id uuid NOT NULL REFERENCES production_passports(id) ON DELETE RESTRICT,
  passport_code_snapshot text NOT NULL,
  passport_revision_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  lifecycle_status text NOT NULL
    CHECK (lifecycle_status IN ('CREATED', 'RELEASED', 'FINAL_ACCEPTED')),
  final_acceptance_id uuid UNIQUE,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL,
  released_at timestamptz,
  final_accepted_at timestamptz,
  created_by uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
  released_by uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
  CONSTRAINT production_batches_snapshot_not_blank
    CHECK (
      passport_code_snapshot = btrim(passport_code_snapshot)
      AND passport_code_snapshot <> ''
      AND passport_revision_snapshot = btrim(passport_revision_snapshot)
      AND passport_revision_snapshot <> ''
      AND product_name_snapshot = btrim(product_name_snapshot)
      AND product_name_snapshot <> ''
    ),
  CONSTRAINT production_batches_lifecycle_fields
    CHECK (
      (
        lifecycle_status = 'CREATED'
        AND released_at IS NULL
        AND released_by IS NULL
        AND final_accepted_at IS NULL
        AND final_acceptance_id IS NULL
      )
      OR (
        lifecycle_status = 'RELEASED'
        AND released_at IS NOT NULL
        AND released_by IS NOT NULL
        AND final_accepted_at IS NULL
        AND final_acceptance_id IS NULL
      )
      OR (
        lifecycle_status = 'FINAL_ACCEPTED'
        AND released_at IS NOT NULL
        AND released_by IS NOT NULL
        AND final_accepted_at IS NOT NULL
        AND final_acceptance_id IS NOT NULL
      )
    )
);

CREATE INDEX production_batches_created_at_idx ON production_batches(created_at DESC, id DESC);

CREATE TABLE batch_operation_plan_snapshots (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES production_batches(id) ON DELETE RESTRICT,
  source_operation_plan_id uuid NOT NULL REFERENCES operation_plans(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position > 0),
  scope_code text NOT NULL,
  scope_name text NOT NULL,
  norm_hours numeric(8, 2) NOT NULL CHECK (norm_hours > 0),
  planned_card_count integer NOT NULL CHECK (planned_card_count > 0),
  CONSTRAINT batch_operation_plan_snapshots_scope_not_blank
    CHECK (
      scope_code = btrim(scope_code)
      AND scope_code <> ''
      AND scope_name = btrim(scope_name)
      AND scope_name <> ''
    ),
  CONSTRAINT batch_operation_plan_snapshots_id_batch_unique UNIQUE (id, batch_id),
  CONSTRAINT batch_operation_plan_snapshots_position_unique UNIQUE (batch_id, position),
  CONSTRAINT batch_operation_plan_snapshots_scope_unique UNIQUE (batch_id, scope_code)
);

CREATE TABLE work_card_sets (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES production_batches(id) ON DELETE RESTRICT,
  plan_snapshot_id uuid NOT NULL,
  scope_code_snapshot text NOT NULL,
  scope_name_snapshot text NOT NULL,
  norm_hours_snapshot numeric(8, 2) NOT NULL CHECK (norm_hours_snapshot > 0),
  planned_card_count integer NOT NULL CHECK (planned_card_count > 0),
  gate_status text NOT NULL
    CHECK (gate_status IN ('FIRST_ARTICLE_PENDING', 'SERIAL_ALLOWED')),
  first_article_work_card_id uuid,
  first_article_controller_id uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
  first_article_accepted_at timestamptz,
  version integer NOT NULL CHECK (version > 0),
  released_at timestamptz NOT NULL,
  CONSTRAINT work_card_sets_snapshot_not_blank
    CHECK (
      scope_code_snapshot = btrim(scope_code_snapshot)
      AND scope_code_snapshot <> ''
      AND scope_name_snapshot = btrim(scope_name_snapshot)
      AND scope_name_snapshot <> ''
    ),
  CONSTRAINT work_card_sets_plan_batch_fk
    FOREIGN KEY (plan_snapshot_id, batch_id)
    REFERENCES batch_operation_plan_snapshots(id, batch_id)
    ON DELETE RESTRICT,
  CONSTRAINT work_card_sets_id_batch_unique UNIQUE (id, batch_id),
  CONSTRAINT work_card_sets_plan_unique UNIQUE (batch_id, plan_snapshot_id),
  CONSTRAINT work_card_sets_gate_fields
    CHECK (
      (
        gate_status = 'FIRST_ARTICLE_PENDING'
        AND first_article_controller_id IS NULL
        AND first_article_accepted_at IS NULL
      )
      OR (
        gate_status = 'SERIAL_ALLOWED'
        AND first_article_work_card_id IS NOT NULL
        AND first_article_controller_id IS NOT NULL
        AND first_article_accepted_at IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX work_card_sets_first_article_unique
  ON work_card_sets(first_article_work_card_id)
  WHERE first_article_work_card_id IS NOT NULL;

CREATE TABLE work_cards (
  id uuid PRIMARY KEY,
  work_card_set_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  batch_quantity_snapshot integer NOT NULL CHECK (batch_quantity_snapshot > 0),
  scope_code_snapshot text NOT NULL,
  scope_name_snapshot text NOT NULL,
  norm_hours_snapshot numeric(8, 2) NOT NULL CHECK (norm_hours_snapshot > 0),
  purpose text CHECK (purpose IN ('FIRST_ARTICLE', 'SERIAL')),
  status text NOT NULL
    CHECK (status IN ('RELEASED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED')),
  closure_type text
    CHECK (closure_type IN ('FIRST_ARTICLE_ACCEPTANCE', 'SERIAL_QUALITY_CONFIRMATION')),
  assignee_id uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  released_at timestamptz NOT NULL,
  assigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  released_by uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
  started_by uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
  completed_by uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
  closed_by uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
  CONSTRAINT work_cards_set_batch_fk
    FOREIGN KEY (work_card_set_id, batch_id)
    REFERENCES work_card_sets(id, batch_id)
    ON DELETE RESTRICT,
  CONSTRAINT work_cards_snapshot_not_blank
    CHECK (
      scope_code_snapshot = btrim(scope_code_snapshot)
      AND scope_code_snapshot <> ''
      AND scope_name_snapshot = btrim(scope_name_snapshot)
      AND scope_name_snapshot <> ''
    ),
  CONSTRAINT work_cards_lifecycle_fields
    CHECK (
      (
        status = 'RELEASED'
        AND purpose IS NULL
        AND assignee_id IS NULL
        AND assigned_at IS NULL
        AND assigned_by IS NULL
        AND started_at IS NULL
        AND started_by IS NULL
        AND completed_at IS NULL
        AND completed_by IS NULL
        AND closed_at IS NULL
        AND closed_by IS NULL
        AND closure_type IS NULL
      )
      OR (
        status = 'ASSIGNED'
        AND purpose IS NOT NULL
        AND assignee_id IS NOT NULL
        AND assigned_at IS NOT NULL
        AND assigned_by IS NOT NULL
        AND started_at IS NULL
        AND started_by IS NULL
        AND completed_at IS NULL
        AND completed_by IS NULL
        AND closed_at IS NULL
        AND closed_by IS NULL
        AND closure_type IS NULL
      )
      OR (
        status = 'IN_PROGRESS'
        AND purpose IS NOT NULL
        AND assignee_id IS NOT NULL
        AND assigned_at IS NOT NULL
        AND assigned_by IS NOT NULL
        AND started_at IS NOT NULL
        AND started_by IS NOT NULL
        AND completed_at IS NULL
        AND completed_by IS NULL
        AND closed_at IS NULL
        AND closed_by IS NULL
        AND closure_type IS NULL
      )
      OR (
        status = 'COMPLETED'
        AND purpose IS NOT NULL
        AND assignee_id IS NOT NULL
        AND assigned_at IS NOT NULL
        AND assigned_by IS NOT NULL
        AND started_at IS NOT NULL
        AND started_by IS NOT NULL
        AND completed_at IS NOT NULL
        AND completed_by IS NOT NULL
        AND closed_at IS NULL
        AND closed_by IS NULL
        AND closure_type IS NULL
      )
      OR (
        status = 'CLOSED'
        AND purpose IS NOT NULL
        AND assignee_id IS NOT NULL
        AND assigned_at IS NOT NULL
        AND assigned_by IS NOT NULL
        AND started_at IS NOT NULL
        AND started_by IS NOT NULL
        AND completed_at IS NOT NULL
        AND completed_by IS NOT NULL
        AND closed_at IS NOT NULL
        AND closed_by IS NOT NULL
        AND (
          (purpose = 'FIRST_ARTICLE' AND closure_type = 'FIRST_ARTICLE_ACCEPTANCE')
          OR (purpose = 'SERIAL' AND closure_type = 'SERIAL_QUALITY_CONFIRMATION')
        )
      )
    )
);

CREATE INDEX work_cards_set_status_idx ON work_cards(work_card_set_id, status, id);
CREATE INDEX work_cards_assignee_status_idx ON work_cards(assignee_id, status, id);
CREATE INDEX work_cards_batch_status_idx ON work_cards(batch_id, status);
CREATE UNIQUE INDEX work_cards_first_article_per_set_unique
  ON work_cards(work_card_set_id, purpose)
  WHERE purpose = 'FIRST_ARTICLE';

ALTER TABLE work_card_sets
  ADD CONSTRAINT work_card_sets_first_article_fk
  FOREIGN KEY (first_article_work_card_id)
  REFERENCES work_cards(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE command_receipts (
  command_id uuid PRIMARY KEY,
  command_type text NOT NULL,
  actor_id uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
  actor_role text NOT NULL
    CHECK (actor_role IN ('PLANNER', 'MASTER', 'WORKER', 'QUALITY_CONTROLLER', 'ADMIN_AUDITOR')),
  request_fingerprint char(64) NOT NULL,
  correlation_id uuid NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('IN_PROGRESS', 'SUCCEEDED')),
  http_status integer,
  result_type text,
  result_id uuid,
  response_body jsonb,
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT command_receipts_completion_fields
    CHECK (
      (
        state = 'IN_PROGRESS'
        AND http_status IS NULL
        AND result_type IS NULL
        AND result_id IS NULL
        AND response_body IS NULL
        AND completed_at IS NULL
      )
      OR (
        state = 'SUCCEEDED'
        AND http_status BETWEEN 200 AND 299
        AND result_type IS NOT NULL
        AND response_body IS NOT NULL
        AND completed_at IS NOT NULL
      )
    )
);

CREATE TABLE final_batch_acceptances (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL UNIQUE REFERENCES production_batches(id) ON DELETE RESTRICT,
  controller_id uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL,
  command_id uuid NOT NULL UNIQUE
    REFERENCES command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
  resulting_batch_version integer NOT NULL CHECK (resulting_batch_version > 0)
);

ALTER TABLE production_batches
  ADD CONSTRAINT production_batches_final_acceptance_fk
  FOREIGN KEY (final_acceptance_id)
  REFERENCES final_batch_acceptances(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE payroll_records (
  id uuid PRIMARY KEY,
  work_card_id uuid NOT NULL UNIQUE REFERENCES work_cards(id) ON DELETE RESTRICT,
  beneficiary_id uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
  norm_hours_snapshot numeric(8, 2) NOT NULL CHECK (norm_hours_snapshot > 0),
  exported_by uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
  exported_at timestamptz NOT NULL,
  command_id uuid NOT NULL UNIQUE
    REFERENCES command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  occurred_at timestamptz NOT NULL,
  actor_id uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
  actor_role text NOT NULL
    CHECK (actor_role IN ('PLANNER', 'MASTER', 'WORKER', 'QUALITY_CONTROLLER', 'ADMIN_AUDITOR')),
  command_id uuid NOT NULL
    REFERENCES command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
  correlation_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_events_aggregate_version_unique
    UNIQUE (aggregate_type, aggregate_id, aggregate_version)
);

CREATE INDEX audit_events_aggregate_idx
  ON audit_events(aggregate_type, aggregate_id, aggregate_version, occurred_at, id);
CREATE INDEX audit_events_correlation_idx
  ON audit_events(correlation_id, occurred_at, id);
CREATE INDEX audit_events_command_idx ON audit_events(command_id);

CREATE FUNCTION enforce_first_article_membership() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.first_article_work_card_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM work_cards
    WHERE id = NEW.first_article_work_card_id
      AND work_card_set_id = NEW.id
      AND purpose = 'FIRST_ARTICLE'
  ) THEN
    RAISE EXCEPTION 'first article card must belong to the same work card set'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER work_card_sets_first_article_membership
AFTER INSERT OR UPDATE OF first_article_work_card_id ON work_card_sets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_first_article_membership();

CREATE FUNCTION enforce_final_acceptance_link() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'production_batches' THEN
    IF NEW.final_acceptance_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM final_batch_acceptances
      WHERE id = NEW.final_acceptance_id AND batch_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'final acceptance must reference the same batch'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM production_batches
      WHERE id = NEW.batch_id AND final_acceptance_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'batch must reference its final acceptance'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER production_batches_final_acceptance_link
AFTER INSERT OR UPDATE OF final_acceptance_id ON production_batches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_final_acceptance_link();

CREATE CONSTRAINT TRIGGER final_batch_acceptances_batch_link
AFTER INSERT OR UPDATE ON final_batch_acceptances
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_final_acceptance_link();

CREATE FUNCTION enforce_completed_command_receipt() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM command_receipts
    WHERE command_id = NEW.command_id AND state = 'SUCCEEDED'
  ) THEN
    RAISE EXCEPTION 'command receipt must be completed before commit'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER command_receipts_completed_before_commit
AFTER INSERT OR UPDATE ON command_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_completed_command_receipt();

CREATE FUNCTION reject_immutable_row_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER batch_operation_plan_snapshots_immutable
BEFORE UPDATE OR DELETE ON batch_operation_plan_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER final_batch_acceptances_immutable
BEFORE UPDATE OR DELETE ON final_batch_acceptances
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER payroll_records_immutable
BEFORE UPDATE OR DELETE ON payroll_records
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

COMMENT ON TABLE production_batches IS
  'Партии с immutable passport snapshots; operation-scoped нормы здесь отсутствуют.';
COMMENT ON TABLE work_cards IS
  'UUID-карточки без sequence number и без идентичности физической детали.';
COMMENT ON TABLE final_batch_acceptances IS
  'Единственная immutable digital final acceptance завершённой партии.';
COMMENT ON TABLE payroll_records IS
  'Локальная immutable mock payroll boundary без денежных данных.';
