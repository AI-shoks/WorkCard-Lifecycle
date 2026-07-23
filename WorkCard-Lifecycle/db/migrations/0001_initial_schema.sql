CREATE TABLE demo_users (
    id uuid PRIMARY KEY,
    display_name text NOT NULL CHECK (btrim(display_name) <> ''),
    role text NOT NULL CHECK (
        role IN ('PLANNER', 'MASTER', 'WORKER', 'QUALITY_CONTROLLER', 'ADMIN_AUDITOR')
    ),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE production_passports (
    id uuid PRIMARY KEY,
    code text NOT NULL CHECK (btrim(code) <> ''),
    revision text NOT NULL CHECK (btrim(revision) <> ''),
    product_name text NOT NULL CHECK (btrim(product_name) <> ''),
    active boolean NOT NULL DEFAULT true,
    UNIQUE (code, revision)
);

CREATE TABLE operation_plans (
    id uuid PRIMARY KEY,
    passport_id uuid NOT NULL REFERENCES production_passports(id) ON DELETE RESTRICT,
    position integer NOT NULL CHECK (position > 0),
    operation_scope jsonb NOT NULL CHECK (jsonb_typeof(operation_scope) = 'object'),
    norm_hours numeric(8, 2) NOT NULL CHECK (norm_hours > 0),
    planned_card_count integer NOT NULL CHECK (planned_card_count > 0),
    UNIQUE (passport_id, position)
);

CREATE TABLE production_batches (
    id uuid PRIMARY KEY,
    passport_id uuid NOT NULL REFERENCES production_passports(id) ON DELETE RESTRICT,
    passport_snapshot jsonb NOT NULL CHECK (jsonb_typeof(passport_snapshot) = 'object'),
    batch_quantity integer NOT NULL CHECK (batch_quantity > 0),
    lifecycle_status text NOT NULL DEFAULT 'CREATED' CHECK (
        lifecycle_status IN ('CREATED', 'RELEASED', 'FINAL_ACCEPTED')
    ),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    CHECK (
        (lifecycle_status = 'CREATED' AND released_at IS NULL)
        OR (lifecycle_status IN ('RELEASED', 'FINAL_ACCEPTED') AND released_at IS NOT NULL)
    )
);

CREATE TABLE work_card_sets (
    id uuid PRIMARY KEY,
    batch_id uuid NOT NULL REFERENCES production_batches(id) ON DELETE RESTRICT,
    operation_plan_key text NOT NULL CHECK (btrim(operation_plan_key) <> ''),
    operation_scope_snapshot jsonb NOT NULL CHECK (
        jsonb_typeof(operation_scope_snapshot) = 'object'
    ),
    norm_hours_snapshot numeric(8, 2) NOT NULL CHECK (norm_hours_snapshot > 0),
    planned_card_count integer NOT NULL CHECK (planned_card_count > 0),
    gate_status text NOT NULL DEFAULT 'FIRST_ARTICLE_PENDING' CHECK (
        gate_status IN ('FIRST_ARTICLE_PENDING', 'SERIAL_ALLOWED')
    ),
    first_article_work_card_id uuid UNIQUE,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (batch_id, operation_plan_key),
    UNIQUE (id, batch_id),
    UNIQUE (first_article_work_card_id, id),
    CHECK (gate_status = 'FIRST_ARTICLE_PENDING' OR first_article_work_card_id IS NOT NULL)
);

CREATE TABLE work_cards (
    id uuid PRIMARY KEY,
    set_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    batch_quantity_snapshot integer NOT NULL CHECK (batch_quantity_snapshot > 0),
    operation_scope_snapshot jsonb NOT NULL CHECK (
        jsonb_typeof(operation_scope_snapshot) = 'object'
    ),
    norm_hours_snapshot numeric(8, 2) NOT NULL CHECK (norm_hours_snapshot > 0),
    purpose text CHECK (purpose IN ('FIRST_ARTICLE', 'SERIAL')),
    status text NOT NULL DEFAULT 'RELEASED' CHECK (
        status IN ('RELEASED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED')
    ),
    assignee_id uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    started_at timestamptz,
    started_by_master_id uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
    completed_at timestamptz,
    completed_by_master_id uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
    closed_at timestamptz,
    closed_by_quality_controller_id uuid REFERENCES demo_users(id) ON DELETE RESTRICT,
    close_kind text CHECK (close_kind IN ('FIRST_ARTICLE_ACCEPTANCE', 'WORK_CARD_QUALITY')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, set_id),
    FOREIGN KEY (set_id, batch_id)
        REFERENCES work_card_sets(id, batch_id) ON DELETE RESTRICT,
    CHECK (
        (status = 'RELEASED' AND purpose IS NULL AND assignee_id IS NULL)
        OR (status <> 'RELEASED' AND purpose IS NOT NULL AND assignee_id IS NOT NULL)
    ),
    CHECK (
        (status IN ('RELEASED', 'ASSIGNED')
            AND started_at IS NULL AND started_by_master_id IS NULL)
        OR (status IN ('IN_PROGRESS', 'COMPLETED', 'CLOSED')
            AND started_at IS NOT NULL AND started_by_master_id IS NOT NULL)
    ),
    CHECK (
        (status IN ('RELEASED', 'ASSIGNED', 'IN_PROGRESS')
            AND completed_at IS NULL AND completed_by_master_id IS NULL)
        OR (status IN ('COMPLETED', 'CLOSED')
            AND completed_at IS NOT NULL AND completed_by_master_id IS NOT NULL)
    ),
    CHECK (
        (status <> 'CLOSED' AND closed_at IS NULL
            AND closed_by_quality_controller_id IS NULL AND close_kind IS NULL)
        OR (status = 'CLOSED' AND closed_at IS NOT NULL
            AND closed_by_quality_controller_id IS NOT NULL AND close_kind IS NOT NULL)
    )
);

ALTER TABLE work_card_sets
    ADD CONSTRAINT work_card_sets_first_article_same_set_fk
    FOREIGN KEY (first_article_work_card_id, id)
    REFERENCES work_cards(id, set_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX work_cards_one_first_article_per_set_idx
    ON work_cards(set_id)
    WHERE purpose = 'FIRST_ARTICLE';

CREATE INDEX work_card_sets_batch_idx ON work_card_sets(batch_id, id);
CREATE INDEX work_cards_set_status_idx ON work_cards(set_id, status, id);
CREATE INDEX work_cards_batch_idx ON work_cards(batch_id, id);
CREATE INDEX work_cards_assignee_idx
    ON work_cards(assignee_id, status, id)
    WHERE assignee_id IS NOT NULL;

CREATE TABLE command_receipts (
    command_id uuid PRIMARY KEY,
    command_type text NOT NULL CHECK (btrim(command_type) <> ''),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    correlation_id uuid NOT NULL UNIQUE,
    result_type text NOT NULL CHECK (btrim(result_type) <> ''),
    result_id uuid NOT NULL,
    result_summary jsonb NOT NULL CHECK (jsonb_typeof(result_summary) = 'object'),
    completed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (command_id, correlation_id)
);

CREATE TABLE final_batch_acceptances (
    id uuid PRIMARY KEY,
    batch_id uuid NOT NULL UNIQUE REFERENCES production_batches(id) ON DELETE RESTRICT,
    controller_id uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
    command_id uuid NOT NULL UNIQUE REFERENCES command_receipts(command_id) ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED,
    accepted_at timestamptz NOT NULL,
    resulting_batch_version integer NOT NULL CHECK (resulting_batch_version > 0)
);

CREATE TABLE payroll_records (
    id uuid PRIMARY KEY,
    work_card_id uuid NOT NULL UNIQUE REFERENCES work_cards(id) ON DELETE RESTRICT,
    beneficiary_id uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
    norm_hours_snapshot numeric(8, 2) NOT NULL CHECK (norm_hours_snapshot > 0),
    exported_at timestamptz NOT NULL
);

CREATE TABLE audit_events (
    id uuid PRIMARY KEY,
    aggregate_type text NOT NULL CHECK (
        aggregate_type IN ('ProductionBatch', 'WorkCardSet', 'WorkCard', 'PayrollRecord')
    ),
    aggregate_id uuid NOT NULL,
    aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
    event_type text NOT NULL CHECK (btrim(event_type) <> ''),
    actor_id uuid NOT NULL REFERENCES demo_users(id) ON DELETE RESTRICT,
    actor_role text NOT NULL CHECK (
        actor_role IN ('PLANNER', 'MASTER', 'WORKER', 'QUALITY_CONTROLLER', 'ADMIN_AUDITOR')
    ),
    command_id uuid NOT NULL,
    correlation_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    UNIQUE (aggregate_type, aggregate_id, aggregate_version),
    FOREIGN KEY (command_id, correlation_id)
        REFERENCES command_receipts(command_id, correlation_id)
        ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX audit_events_history_idx
    ON audit_events(aggregate_type, aggregate_id, aggregate_version, occurred_at, id);
CREATE INDEX audit_events_correlation_idx
    ON audit_events(correlation_id, occurred_at, id);
CREATE INDEX audit_events_command_idx ON audit_events(command_id);
CREATE INDEX audit_events_type_time_idx ON audit_events(event_type, occurred_at);

CREATE FUNCTION reject_immutable_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER final_batch_acceptances_immutable
    BEFORE UPDATE OR DELETE ON final_batch_acceptances
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER payroll_records_immutable
    BEFORE UPDATE OR DELETE ON payroll_records
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workcard_app') THEN
        GRANT USAGE ON SCHEMA public TO workcard_app;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO workcard_app;
        GRANT INSERT ON production_batches, work_card_sets, work_cards,
            command_receipts, final_batch_acceptances, payroll_records, audit_events
            TO workcard_app;
        GRANT UPDATE ON production_batches, work_card_sets, work_cards TO workcard_app;
    END IF;
END;
$$;
