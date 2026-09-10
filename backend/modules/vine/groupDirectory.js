const escapeLike = (value) => value.replace(/[!%_]/g, (character) => `!${character}`);

export async function searchGroupCandidates(db, { actorId, query = "", excludeIds = [], offset = 0, limit = 30 }) {
  const terms = String(query).trim().replace(/^@/, "").toLowerCase().slice(0, 80).split(/\s+/).filter(Boolean);
  const ids = [...new Set([Number(actorId), ...excludeIds.map(Number)])];
  const params = [...ids, actorId, actorId];
  const search = terms.map((term) => {
    params.push(`%${escapeLike(term)}%`, `%${escapeLike(term)}%`);
    return "AND (LOWER(u.username) LIKE ? ESCAPE '!' OR LOWER(COALESCE(u.display_name, '')) LIKE ? ESCAPE '!')";
  }).join("\n");
  const pageSize = Math.min(60, Math.max(1, Math.trunc(Number(limit)) || 30));
  const start = Number.isSafeInteger(Number(offset)) ? Math.max(0, Number(offset)) : 0;
  const [rows] = await db.query(`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
    FROM vine_users u
    WHERE u.id NOT IN (${ids.map(() => "?").join(", ")})
      AND NOT EXISTS (
        SELECT 1 FROM vine_blocks b
        WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
           OR (b.blocker_id = u.id AND b.blocked_id = ?)
      )
      ${search}
    ORDER BY COALESCE(NULLIF(u.display_name, ''), u.username) ASC, u.id ASC
    LIMIT ? OFFSET ?
  `, [...params, pageSize + 1, start]);
  const hasMore = rows.length > pageSize;
  return { people: rows.slice(0, pageSize), hasMore, nextOffset: hasMore ? start + pageSize : null };
}

export async function getEligibleGroupUsers(db, actorId, userIds) {
  const ids = [...new Set(userIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0 && id !== Number(actorId)))];
  if (!ids.length) return [];
  const [rows] = await db.query(`
    SELECT u.id FROM vine_users u
    WHERE u.id IN (${ids.map(() => "?").join(", ")})
      AND NOT EXISTS (
        SELECT 1 FROM vine_blocks b
        WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
           OR (b.blocker_id = u.id AND b.blocked_id = ?)
      )
  `, [...ids, actorId, actorId]);
  return rows.map((row) => Number(row.id));
}
