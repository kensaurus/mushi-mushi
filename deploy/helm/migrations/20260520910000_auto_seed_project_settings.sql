-- Auto-seed a default project_settings row whenever a project is created.
-- Prevents 400 AUTOFIX_DISABLED / NULL dereferences on new projects that
-- were created before this trigger existed (e.g. via the Onboarding flow).

CREATE OR REPLACE FUNCTION seed_project_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO project_settings (project_id)
  VALUES (NEW.id)
  ON CONFLICT (project_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_project_settings ON projects;
CREATE TRIGGER trg_seed_project_settings
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION seed_project_settings();

-- Back-fill: ensure every existing project has a settings row.
INSERT INTO project_settings (project_id)
SELECT id FROM projects
ON CONFLICT (project_id) DO NOTHING;
