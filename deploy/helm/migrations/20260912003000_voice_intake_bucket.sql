/*
FILE: 20260912003000_voice_intake_bucket.sql
PURPOSE: Private storage bucket for voice-inbox audio
         (plan docs/execplans/dead-code-voice-agent-loop.md, C1 "Storage", C6).

OVERVIEW:
- 25 MB cap matches the OpenAI transcription request limit.
- Audio MIME allow-list covers Telegram voice notes (audio/ogg), Slack/iOS
  clips (audio/mp4, audio/x-m4a, audio/aac), Android MediaRecorder
  (audio/webm), plus mp3/wav for shared files.
- Object path convention: `<project_id>/<intake_id>.<ext>`.
- No anon/authenticated storage policies: the bucket is service-role only,
  exactly like 'screenshots' (20260416000000_phase0_initial_schema.sql). The
  PWA uploads through a short-lived signed upload URL minted by the API, and
  objects are deleted right after transcription unless the project sets
  voice_audio_retention_days > 0.

Idempotent: safe to re-run (the caps are refreshed on conflict).
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'voice-intake',
  'voice-intake',
  false,
  26214400, -- 25 MB
  array[
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/webm',
    'audio/wav',
    'audio/x-m4a',
    'audio/aac',
    'audio/mp3'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit   = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
