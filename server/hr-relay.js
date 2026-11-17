'use strict';
// Ask HR delivery (v1.1). The portal does not keep HR messages. A submission's subject and body wait in
// hr_outbox only until they reach the HR inbox; then the outbox row is deleted and only who / when remain.
//
// Delivery is by email to settings.hr_inbox_email (default HR@scsalons.com) through the Gmail API, when these
// environment variables are set (no extra dependencies, plain HTTPS):
//   SCP_MAIL_CLIENT_ID, SCP_MAIL_CLIENT_SECRET, SCP_MAIL_REFRESH_TOKEN   OAuth client + refresh token of the sending mailbox
//   SCP_MAIL_FROM                                                        the sending address: HR@scsalons.com itself (decided 2026-11-17, no new mailbox)
// Until they are set, HR and admins see waiting messages in the portal's HR inbox and clear each one by
// hand after copying it into the HR inbox ("Moved to HR inbox"), which deletes it from the portal.
const { json, nowIso } = require('./util');

const DEFAULT_TO = 'HR@scsalons.com';
const RETENTION_DAYS_DEFAULT = 730; // the who / when log; never any message content

function makeHrRelay(db, { env = process.env, log = console, fetchImpl = globalThis.fetch } = {}) {
  const setting = (k, d) => json(db.prepare('SELECT value_json FROM settings WHERE key = ?').get(k)?.value_json, d);
  const to = () => setting('hr_inbox_email', DEFAULT_TO) || DEFAULT_TO;
  const configured = () => !!(env.SCP_MAIL_CLIENT_ID && env.SCP_MAIL_CLIENT_SECRET && env.SCP_MAIL_REFRESH_TOKEN && env.SCP_MAIL_FROM);

  let token = null;
  let tokenExp = 0;
  async function accessToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.SCP_MAIL_CLIENT_ID, client_secret: env.SCP_MAIL_CLIENT_SECRET, refresh_token: env.SCP_MAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }),
    });
    if (!res.ok) throw new Error(`token ${res.status}`);
    const j = await res.json();
    token = j.access_token;
    tokenExp = Date.now() + (j.expires_in || 3000) * 1000;
    return token;
  }

  const header = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();
  const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const encWord = (s) => `=?UTF-8?B?${Buffer.from(header(s)).toString('base64')}?=`;

  function compose(row) {
    const who = db.prepare(`SELECT u.first_name, u.last_name, u.username, u.email, u.phone, u.title, s.name AS salon, s.salon_number
      FROM hr_submissions h JOIN users u ON u.id = h.author_id LEFT JOIN salons s ON s.id = u.salon_id WHERE h.id = ?`).get(row.submission_id) || {};
    const name = `${who.first_name || ''} ${who.last_name || ''}`.trim() || 'A team member';
    const lines = [
      `Private inquiry from ${name}${who.title ? `, ${who.title}` : ''}${who.salon ? `, ${who.salon} #${who.salon_number}` : ''}.`,
      `Portal username: ${who.username || 'unknown'}${who.email ? ` · Email: ${who.email}` : ''}${who.phone ? ` · Phone: ${who.phone}` : ''}`,
      `Sent ${row.created_at} (UTC).`,
      '',
      `Subject: ${row.subject}`,
      '',
      row.body,
      '',
      '--',
      'Sent from SC Portal. Reply to the employee directly through their main contact method. The portal does not keep a copy of this message and sends nothing to the employee.',
    ];
    const mime = [
      `From: SC Portal <${header(env.SCP_MAIL_FROM)}>`,
      `To: ${header(to())}`,
      `Subject: ${encWord(`Private HR inquiry: ${name}`)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(lines.join('\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n'),
    ].join('\r\n');
    return b64url(mime);
  }

  async function sendOne(row) {
    const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: compose(row) }),
    });
    if (!res.ok) throw new Error(`send ${res.status}`);
  }

  /** Marks a submission delivered and deletes its content. `how` is 'email' or 'manual'. */
  function markDelivered(submissionId, how, actorId = null) {
    db.transaction(() => {
      db.prepare('UPDATE hr_submissions SET delivered_at = ?, delivery = ? WHERE id = ?').run(nowIso(), how, submissionId);
      db.prepare('DELETE FROM hr_outbox WHERE submission_id = ?').run(submissionId);
      db.prepare("INSERT INTO audit_log (actor_id, action, target_type, target_id, meta_json, ip, created_at) VALUES (?, 'hr.delivered', 'hr_submission', ?, ?, NULL, ?)")
        .run(actorId, submissionId, JSON.stringify({ how }), nowIso());
    })();
  }

  let running = false;
  async function flush() {
    if (!configured() || running) return { sent: 0 };
    running = true;
    let sent = 0;
    try {
      for (const row of db.prepare('SELECT * FROM hr_outbox ORDER BY submission_id LIMIT 25').all()) {
        try {
          await sendOne(row);
          markDelivered(row.submission_id, 'email');
          sent += 1;
        } catch (e) {
          db.prepare('UPDATE hr_outbox SET attempts = attempts + 1, last_error = ? WHERE submission_id = ?').run(String(e.message).slice(0, 200), row.submission_id);
          log.error?.(`hr relay: submission ${row.submission_id} not delivered (${e.message})`);
        }
      }
    } finally {
      running = false;
    }
    return { sent };
  }

  /** Drops who / when log rows past the retention window. Content is never kept, so there is nothing else to purge. */
  function purge() {
    const days = Number(setting('hr_log_retention_days', RETENTION_DAYS_DEFAULT)) || RETENTION_DAYS_DEFAULT;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return db.prepare(`DELETE FROM hr_submissions WHERE created_at < ?
      AND NOT EXISTS (SELECT 1 FROM hr_outbox o WHERE o.submission_id = hr_submissions.id)`).run(cutoff).changes;
  }

  return { flush, purge, markDelivered, configured, to };
}

module.exports = { makeHrRelay, DEFAULT_TO };
