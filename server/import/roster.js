'use strict';
// Employee upload: turns one row of a roster CSV (our template, or an iSolved employee export) into the
// fields the portal needs. Header names are matched loosely ("First Name", "first_name", "Legal First Name").

const ALIASES = {
  first_name: ['first_name', 'first name', 'firstname', 'legal first name', 'employee first name', 'preferred first name'],
  last_name: ['last_name', 'last name', 'lastname', 'legal last name', 'employee last name'],
  salon_number: ['salon_number', 'salon number', 'salon #', 'salon', 'store', 'store number', 'store #', 'location', 'location code', 'department', 'cost center', 'work location'],
  title: ['title', 'job title', 'position', 'job', 'job description', 'position title'],
  role: ['role', 'portal role'],
  shift_manager: ['shift_manager', 'shift manager', 'shift lead', 'is shift manager'],
  employee_id: ['employee_id', 'employee id', 'employee number', 'employee #', 'emp id', 'emp #', 'id', 'file number'],
  email: ['email', 'email address', 'work email', 'personal email'],
  phone: ['phone', 'mobile', 'cell', 'cell phone', 'mobile phone', 'phone number'],
  hire_date: ['hire_date', 'hire date', 'date of hire', 'original hire date', 'start date'],
  pay_plan: ['pay_plan', 'pay plan', 'pay plan state'],
  username: ['username', 'portal username'],
};

const ROSTER_TEMPLATE = [
  'first_name,last_name,salon_number,title,shift_manager,employee_id,hire_date,phone,email,pay_plan',
  'Jordan,Reyes,8495,Stylist,no,100234,2026-11-02,,,CA',
  'Ana,Lopez,8495,Salon Manager,,100118,2024-03-18,,,CA',
  'Marcus,Bell,82298,Stylist,yes,200457,2025-07-09,,,NV',
  '',
].join('\n');

const clean = (x) => (x === undefined || x === null ? '' : String(x).trim());

/** "03/14/2025", "3/14/25", "2025-03-14" -> "2025-03-14"; anything else -> null. */
function isoDate(s) {
  const t = clean(s);
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

/** Salon numbers come as "8495", "#8495" or "02 ARCADIA 8768": take the last run of 4 to 6 digits. */
function salonNumber(s) {
  const t = clean(s);
  if (!t) return '';
  const all = t.match(/\d{4,6}/g);
  return all ? all[all.length - 1] : t;
}

/** Portal role from an explicit role column, else from the job title. Field uploads never create leadership. */
function roleFrom(role, title) {
  const r = clean(role).toLowerCase().replace(/\s+/g, '_');
  if (['stylist', 'salon_manager'].includes(r)) return r;
  if (r === 'manager') return 'salon_manager';
  const t = clean(title).toLowerCase();
  if (/shift|assistant/.test(t)) return 'stylist';
  if (/manager/.test(t)) return 'salon_manager';
  return 'stylist';
}

const yes = (s) => /^(y|yes|true|1|x)$/i.test(clean(s));

function mapRosterRecord(raw, header) {
  const pick = (key) => {
    for (const a of ALIASES[key]) if (a in raw && clean(raw[a])) return clean(raw[a]);
    return '';
  };
  const has = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, ALIASES[k].some((a) => header.includes(a))]));
  const title = pick('title');
  const sm = pick('shift_manager');
  const out = {
    _has: has,
    first_name: pick('first_name'),
    last_name: pick('last_name'),
    salon_number: salonNumber(pick('salon_number')),
    title: title || null,
    role: roleFrom(pick('role'), title),
    employee_id: pick('employee_id') || null,
    email: pick('email') || null,
    phone: pick('phone') || null,
    hire_date: isoDate(pick('hire_date')),
    pay_plan: (pick('pay_plan').toUpperCase().match(/\b(CA|NV|AZ)\b/) || [])[1] || null,
    username: pick('username').toLowerCase() || null,
  };
  // Shift manager: an explicit yes / no column wins; otherwise a "Shift Manager" / "Shift Lead" / "Assistant Manager" title.
  if (has.shift_manager && sm !== '') out.shift_manager = yes(sm);
  else if (title) out.shift_manager = /shift|assistant manager/i.test(title);
  return out;
}

module.exports = { mapRosterRecord, ROSTER_TEMPLATE, isoDate, salonNumber, roleFrom };
