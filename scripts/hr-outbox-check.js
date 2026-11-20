#!/usr/bin/env node
'use strict';
// Ask HR delivery check: exits non-zero when the sending relay is configured but a message has been
// waiting longer than half an hour - the five-minute retry is failing (usually an expired token).
// Append it to a scheduled job's log and watch for the WARNING line; the full alarm arrives with
// phase 1h. In manual mode (no relay configured) waiting is by design and this stays quiet.
const { openDb } = require('../server/db');

const STUCK_AFTER_MINUTES = 30;
const env = process.env;
const configured = !!(env.SCP_MAIL_CLIENT_ID && env.SCP_MAIL_CLIENT_SECRET && env.SCP_MAIL_REFRESH_TOKEN && env.SCP_MAIL_FROM);
const db = openDb();
const oldest = db.prepare('SELECT MIN(created_at) AS t, COUNT(*) AS n FROM hr_outbox').get();
db.close();

if (!configured) {
  console.log(`Ask HR: delivery is manual; ${oldest.n} message(s) waiting is by design.`);
  process.exit(0);
}
const min = oldest.t ? Math.round((Date.now() - Date.parse(oldest.t)) / 60000) : null;
if (min === null || min < STUCK_AFTER_MINUTES) {
  console.log(`Ask HR delivery OK${min === null ? '' : `: oldest waiting ${min} minute(s).`}`);
} else {
  console.log(`WARNING: Ask HR delivery is stuck - ${oldest.n} message(s) waiting, oldest ${min} minutes. Check the relay credentials; the portal log has the send error.`);
  process.exit(1);
}
