'use strict';
// Response shapes shared by every route (SPEC section 5).

const USER_SELECT = `
  SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.role, u.title, u.avatar_url, u.salon_id, u.district_id,
         u.phone, u.hire_date, u.birthday_md, u.bio, u.status, u.must_change_password, u.last_login_at, u.created_at,
         s.name AS salon_name, s.salon_number AS salon_number, m.name AS market_name
  FROM users u
  LEFT JOIN salons s ON s.id = u.salon_id
  LEFT JOIN markets m ON m.id = s.market_id`;

/** The public user shape. Never includes contact details or credentials. */
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: `${row.first_name} ${row.last_name}`.trim(),
    first_name: row.first_name,
    role: row.role,
    title: row.title || null,
    avatar_url: row.avatar_url || null,
    salon: row.salon_id ? { id: row.salon_id, name: row.salon_name, salon_number: row.salon_number, market: row.market_name || null } : null,
  };
}

function tenureLabel(hireDate, today) {
  if (!hireDate) return null;
  const a = new Date(hireDate + 'T00:00:00Z');
  const b = new Date(today + 'T00:00:00Z');
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  if (months < 1) return 'New this month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  return m ? `${y} yr ${m} mo` : `${y} yr`;
}

function makeShapes(db) {
  const one = db.prepare(`${USER_SELECT} WHERE u.id = ?`);
  const userRow = (id) => one.get(id) || null;
  const userById = (id) => publicUser(userRow(id));
  /** Map of id -> public user for a list of ids (one query). */
  function usersByIds(ids) {
    const uniq = [...new Set(ids.filter((x) => Number.isInteger(x)))];
    const map = new Map();
    for (let i = 0; i < uniq.length; i += 400) {
      const chunk = uniq.slice(i, i + 400);
      const rows = db.prepare(`${USER_SELECT} WHERE u.id IN (${chunk.map(() => '?').join(',')})`).all(...chunk);
      for (const r of rows) map.set(r.id, publicUser(r));
    }
    return map;
  }
  return { userRow, userById, usersByIds };
}

module.exports = { USER_SELECT, publicUser, tenureLabel, makeShapes };
