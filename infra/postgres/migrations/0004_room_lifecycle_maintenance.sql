CREATE INDEX rooms_maintenance_status_updated_idx
  ON rooms (status, updated_at, id)
  WHERE status IN ('lobby', 'hand_result', 'closed');

CREATE INDEX sessions_expired_unrevoked_idx
  ON sessions (expires_at, id)
  WHERE revoked_at IS NULL;
