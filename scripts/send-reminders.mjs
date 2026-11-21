// Sends each reader's daily reminder and evening nudge.
// Runs every 15 minutes on GitHub Actions. Needs two repository secrets:
//   VAPID_PRIVATE_KEY  the private half of the notification key
//   GROUP_CODES        your private group code(s), the part after #g= in your link
import webpush from 'web-push';

const PROJECT = 'daily-reading-78709';
const API_KEY = 'AIzaSyA981SFTWGOI3Ie67t3WtC_whJI2DPs30M';
const VAPID_PUBLIC = 'BD39y9e5WtcZr-02tVBLuyBaQQ3RRMuFota8WSMNU0zGpMwNgfODb8348K4rBHekxBVm98VyDBMp458_UWptEZw';
const APP_URL = 'https://elu391.github.io/daily-reading/';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const BOOKS = [['Mark',16],['James',5],['Luke',24],['Acts',28],['Galatians',6],['1 Thessalonians',5],['2 Thessalonians',3],['1 Corinthians',16],['2 Corinthians',13],['Romans',16],['John',21],['Ephesians',6],['Philippians',4],['Colossians',4],['Philemon',1],['Matthew',28],['1 Timothy',6],['2 Timothy',4],['Titus',3],['Hebrews',13],['1 Peter',5],['2 Peter',3],['Jude',1],['1 John',5],['2 John',1],['3 John',1],['Revelation',22]];
const CH = BOOKS.flatMap(([b, n]) => Array.from({ length: n }, (_, i) => `${b} ${i + 1}`));
const START = Date.UTC(2026, 10, 23); // Monday, November 23, 2026

// Firestore REST values -> plain JS
function plain(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  return undefined;
}

// Local date, weekday and time for a time zone
function local(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const days = Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day) - START) / 86400000);
  return { date, hm: `${parts.hour}:${parts.minute}`, days };
}

// Index of the chapter due today, or -1 on weekends and outside the plan
function dueIndex(days) {
  if (days < 0) return -1;
  const week = Math.floor(days / 7), dow = days % 7;
  if (dow > 4 || week >= 52) return -1;
  return week * 5 + dow;
}

async function setSent(path, sent) {
  const body = { fields: { sent: { mapValue: { fields: Object.fromEntries(Object.entries(sent).map(([k, v]) => [k, { stringValue: v }])) } } } };
  const r = await fetch(`${BASE}/${path}?key=${API_KEY}&updateMask.fieldPaths=sent`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) console.log('Could not record sent state:', r.status, await r.text());
}
async function dropPush(path) {
  await fetch(`${BASE}/${path}?key=${API_KEY}&updateMask.fieldPaths=push`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: {} }) });
}

async function send(person, payload) {
  try {
    await webpush.sendNotification(person.push, JSON.stringify(payload), { TTL: 3600 });
    return true;
  } catch (e) {
    console.log(`Push to ${person.name} failed: ${e.statusCode || e.message}`);
    if (e.statusCode === 404 || e.statusCode === 410) await dropPush(person.path);
    return false;
  }
}

async function main() {
  const priv = process.env.VAPID_PRIVATE_KEY, codes = (process.env.GROUP_CODES || '').split(/[\s,]+/).map(c => c.replace(/^.*#g=/, '')).filter(Boolean);
  if (!priv || !codes.length) { console.log('Reminders are not set up yet: add the VAPID_PRIVATE_KEY and GROUP_CODES secrets.'); return; }
  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC, priv);

  for (const code of codes) {
    const r = await fetch(`${BASE}/groups/${code}/people?key=${API_KEY}&pageSize=50`);
    if (!r.ok) { console.log(`Could not read a group: ${r.status}`); continue; }
    const people = ((await r.json()).documents || []).map(d => ({
      path: d.name.split('/documents/')[1],
      ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, plain(v)]))
    }));
    const url = `${APP_URL}#g=${code}`;
    console.log(`Group found: ${people.length} reader(s), ${people.filter(p => p.push && p.push.endpoint).length} with reminders on.`);
    if (process.env.TEST === 'true') {
      for (const p of people.filter(p => p.push && p.push.endpoint)) {
        const ok = await send(p, { title: 'Daily Reading', body: 'Test reminder: notifications are working.', url, tag: 'test' });
        console.log(ok ? 'Test notification sent.' : 'Test notification failed.');
      }
      continue;
    }

    for (const p of people) {
      if (!p.push || !p.push.endpoint || (!p.remind && !p.nudge)) continue;
      const t = local(p.tz || 'UTC');
      const idx = dueIndex(t.days);
      if (idx < 0) continue;
      const done = p.done || {}, read = Object.prototype.hasOwnProperty.call(done, String(idx));
      const sent = { ...(p.sent || {}) };
      let changed = false;

      if (p.remind && t.hm >= p.remind && sent.remind !== t.date) {
        if (!read) await send(p, { title: `Today's reading: ${CH[idx]}`, body: 'About 5 minutes. Tap to open.', url, tag: 'remind' });
        sent.remind = t.date; changed = true;
      }
      if (p.nudge && t.hm >= p.nudge && sent.nudge !== t.date) {
        const partner = people.find(o => o.path !== p.path && o.done && Object.prototype.hasOwnProperty.call(o.done, String(idx)));
        if (!read && partner) await send(p, { title: `${partner.name || 'Your husband'} has read ${CH[idx]}`, body: 'Your turn when you have a few minutes.', url, tag: 'nudge' });
        sent.nudge = t.date; changed = true;
      }
      if (changed) await setSent(p.path, sent);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
