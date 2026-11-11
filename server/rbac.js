'use strict';
// Roles, permissions and salon scope. Every route decides access through this file, never in the UI.
const { forbidden } = require('./util');

const ROLES = ['stylist', 'salon_manager', 'district_leader', 'hr', 'executive', 'admin'];
const HOME_OFFICE = ['hr', 'executive', 'admin'];
const RANK = { stylist: 0, salon_manager: 1, district_leader: 2, hr: 3, executive: 3, admin: 4 };

const PERMISSIONS = {
  stylist: [],
  salon_manager: ['post.announce', 'kpi.dollars'],
  district_leader: ['post.announce', 'kpi.dollars', 'tickets.work'],
  hr: ['post.announce', 'admin.users', 'admin.content', 'hr.inbox', 'moderate'],
  executive: ['post.announce', 'kpi.dollars', 'kpi.company'],
  admin: ['post.announce', 'kpi.dollars', 'kpi.company', 'admin.users', 'admin.content', 'admin.settings', 'hr.inbox', 'tickets.work', 'moderate'],
};

const permissions = (user) => PERMISSIONS[user.role] || [];
const can = (user, perm) => permissions(user).includes(perm);
const requirePerm = (...perms) => (req, res, next) =>
  (req.user && perms.some((p) => can(req.user, p)) ? next() : next(forbidden()));
const isManagerPlus = (user) => RANK[user.role] >= 1;

function makeRbac(db) {
  const districtSalons = db.prepare("SELECT id FROM salons WHERE district_id = ?");
  const salonRow = db.prepare('SELECT id, district_id, market_id FROM salons WHERE id = ?');
  const ledDistricts = db.prepare('SELECT id FROM districts WHERE leader_user_id = ?');

  /** District a user belongs to: their own district_id, the district they lead, or their salon's district. */
  function userDistrictId(user) {
    if (user.district_id) return user.district_id;
    if (user.role === 'district_leader') {
      const d = ledDistricts.get(user.id);
      if (d) return d.id;
    }
    if (user.salon_id) return salonRow.get(user.salon_id)?.district_id ?? null;
    return null;
  }
  function userMarketId(user) {
    return user.salon_id ? salonRow.get(user.salon_id)?.market_id ?? null : null;
  }

  /**
   * Salons whose operating detail (dollar KPIs, alerts, checklists, tickets) the user may see.
   * 'all' for executives and admins; the district's salons for a district leader;
   * the user's own salon for managers and stylists; none for HR (people access is separate).
   */
  function scopeSalonIds(user) {
    if (user.role === 'admin' || user.role === 'executive') return 'all';
    if (user.role === 'district_leader') {
      const d = userDistrictId(user);
      return d ? districtSalons.all(d).map((r) => r.id) : [];
    }
    return user.salon_id ? [user.salon_id] : [];
  }
  const salonInScope = (user, salonId) => {
    const s = scopeSalonIds(user);
    return s === 'all' || s.includes(Number(salonId));
  };
  const requireSalonScope = (user, salonId) => {
    if (!salonInScope(user, salonId)) throw forbidden('That salon is outside your access.');
  };
  /** Label used by the UI: how wide this person's view is. */
  const scopeLabel = (user) => (HOME_OFFICE.includes(user.role) ? 'all' : user.role === 'district_leader' ? 'district' : 'salon');

  /** Individual stylist numbers: yourself, or manager and above with that stylist's salon in scope. */
  const canSeeStylistStats = (viewer, subject) =>
    viewer.id === subject.id || (isManagerPlus(viewer) && viewer.role !== 'hr' && subject.salon_id && salonInScope(viewer, subject.salon_id));

  return { userDistrictId, userMarketId, scopeSalonIds, salonInScope, requireSalonScope, scopeLabel, canSeeStylistStats };
}

module.exports = { ROLES, HOME_OFFICE, RANK, permissions, can, requirePerm, isManagerPlus, makeRbac };
