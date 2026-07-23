ALTER TABLE demo_users
    ADD CONSTRAINT demo_users_identity_role_key UNIQUE (id, role);

CREATE TABLE demo_sessions (
    jti uuid PRIMARY KEY,
    identity_id uuid,
    identity_role text,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    FOREIGN KEY (identity_id, identity_role)
        REFERENCES demo_users(id, role) ON DELETE RESTRICT,
    CHECK (
        (identity_id IS NULL AND identity_role IS NULL)
        OR (identity_id IS NOT NULL AND identity_role IS NOT NULL)
    ),
    CHECK (expires_at > issued_at),
    CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);

CREATE INDEX demo_sessions_expiry_idx ON demo_sessions(expires_at);
CREATE INDEX demo_sessions_active_identity_idx
    ON demo_sessions(identity_id, expires_at)
    WHERE revoked_at IS NULL AND identity_id IS NOT NULL;

REVOKE ALL ON demo_sessions FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workcard_app') THEN
        GRANT SELECT, INSERT, DELETE ON demo_sessions TO workcard_app;
        GRANT UPDATE (revoked_at) ON demo_sessions TO workcard_app;
    END IF;
END;
$$;
