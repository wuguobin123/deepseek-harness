SELECT id, version, created_at, cwd, owner_id, parent_session, seed_length, origin,
       delegation_depth, agent_preset, incarnation, revision
FROM sessions
WHERE id = ?;
