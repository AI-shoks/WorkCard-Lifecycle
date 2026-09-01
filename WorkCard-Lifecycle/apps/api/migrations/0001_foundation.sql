CREATE TABLE demo_users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role_code text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  CONSTRAINT demo_users_username_format
    CHECK (username ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT demo_users_display_name_not_blank
    CHECK (display_name = btrim(display_name) AND display_name <> ''),
  CONSTRAINT demo_users_role_code_allowed
    CHECK (role_code IN ('PLANNER', 'MASTER', 'WORKER', 'QUALITY_CONTROLLER', 'ADMIN_AUDITOR'))
);

CREATE TABLE production_passports (
  id uuid PRIMARY KEY,
  product_code text NOT NULL UNIQUE,
  product_name text NOT NULL,
  planned_quantity integer NOT NULL,
  data_provenance text NOT NULL DEFAULT 'SYNTHETIC_DEMO',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT production_passports_code_not_blank
    CHECK (product_code = btrim(product_code) AND product_code <> ''),
  CONSTRAINT production_passports_name_not_blank
    CHECK (product_name = btrim(product_name) AND product_name <> ''),
  CONSTRAINT production_passports_quantity_positive CHECK (planned_quantity > 0),
  CONSTRAINT production_passports_provenance_synthetic
    CHECK (data_provenance = 'SYNTHETIC_DEMO')
);

CREATE TABLE operation_plans (
  id uuid PRIMARY KEY,
  passport_id uuid NOT NULL REFERENCES production_passports(id) ON DELETE RESTRICT,
  operation_number integer NOT NULL,
  operation_name text NOT NULL,
  planned_card_count integer NOT NULL,
  norm_hours numeric(10, 4) NOT NULL,
  CONSTRAINT operation_plans_number_positive CHECK (operation_number > 0),
  CONSTRAINT operation_plans_name_not_blank
    CHECK (operation_name = btrim(operation_name) AND operation_name <> ''),
  CONSTRAINT operation_plans_card_count_positive CHECK (planned_card_count > 0),
  CONSTRAINT operation_plans_norm_hours_positive CHECK (norm_hours > 0),
  CONSTRAINT operation_plans_passport_number_unique UNIQUE (passport_id, operation_number)
);

COMMENT ON TABLE demo_users IS
  'Только детерминированные синтетические пользователи локального demo-контура.';
COMMENT ON TABLE production_passports IS
  'Read-only синтетические производственные паспорта, не данные реального предприятия.';
COMMENT ON TABLE operation_plans IS
  'Синтетический состав операций и нормативов производственного паспорта.';
