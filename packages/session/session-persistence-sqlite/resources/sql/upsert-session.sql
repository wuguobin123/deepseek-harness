INSERT INTO sessions
  (id, version, created_at, cwd, owner_id, parent_session, seed_length, origin,
   delegation_depth, agent_preset, incarnation, revision)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
ON CONFLICT(id) DO UPDATE SET
  version = excluded.version,
  created_at = excluded.created_at,
  cwd = excluded.cwd,
  owner_id = excluded.owner_id,
  parent_session = excluded.parent_session,
  seed_length = excluded.seed_length,
  origin = excluded.origin,
  delegation_depth = excluded.delegation_depth,
  agent_preset = excluded.agent_preset;
