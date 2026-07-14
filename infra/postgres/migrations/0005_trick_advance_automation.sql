ALTER TABLE room_automation_jobs
  DROP CONSTRAINT IF EXISTS room_automation_jobs_kind_check;

ALTER TABLE room_automation_jobs
  ADD CONSTRAINT room_automation_jobs_kind_check
  CHECK (
    kind IN (
      'BOT_ACTION',
      'TURN_TIMEOUT',
      'DISCONNECT_GRACE',
      'TRICK_ADVANCE'
    )
  );
