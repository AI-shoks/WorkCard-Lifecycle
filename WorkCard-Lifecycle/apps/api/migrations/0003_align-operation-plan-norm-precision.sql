DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM operation_plans
    WHERE norm_hours <> round(norm_hours, 2)
       OR norm_hours > 999999.99
  ) THEN
    RAISE EXCEPTION
      'operation plan norm_hours cannot be converted to numeric(8,2) without loss'
      USING ERRCODE = '22003';
  END IF;
END;
$$;

ALTER TABLE operation_plans
  ALTER COLUMN norm_hours TYPE numeric(8, 2)
  USING norm_hours::numeric(8, 2);
