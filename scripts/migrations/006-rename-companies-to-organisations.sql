-- Rename legacy companies table to organisations (idempotent).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'companies'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'organisations'
  ) THEN
    ALTER TABLE companies RENAME TO organisations;
  END IF;
END $$;
