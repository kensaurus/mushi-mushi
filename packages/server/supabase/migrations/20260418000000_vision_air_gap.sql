-- M1 (Wave A v0.6.0): Vision air-gap closure
-- Adds telemetry columns capturing OCR text and prompt-injection detections from
-- the dedicated vision-only LLM call. The vision_analysis JSONB already exists.
-- These dedicated columns let us index/alert on injection attempts cheaply.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS vision_untrusted_text_detected boolean,
  ADD COLUMN IF NOT EXISTS vision_visible_text_in_image text[];

-- Partial index: only rows with detected injections (rare). Lets the
-- admin "security" dashboard scan recent injection attempts in <50ms.
CREATE INDEX IF NOT EXISTS idx_reports_vision_injection
  ON reports (project_id, created_at DESC)
  WHERE vision_untrusted_text_detected IS TRUE;

COMMENT ON COLUMN reports.vision_untrusted_text_detected IS
  'V5.3 §2.3.2: True when the vision LLM detected an instruction-injection attempt embedded in the screenshot.';
COMMENT ON COLUMN reports.vision_visible_text_in_image IS
  'V5.3 §2.3.2: OCR text from the screenshot, captured verbatim as DATA. Never used as instruction.';
