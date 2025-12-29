const { defineSecret } = require('firebase-functions/params');
const TNZ_AUTH_TOKEN = defineSecret('TNZ_AUTH_TOKEN');

function normalizeNz(to) {
  let s = String(to || '')
    .trim()
    .replace(/\s|-/g, '');
  if (!s) return '';

  if (s.startsWith('+')) return s;

  // 0212769799 -> +64212769799
  if (s.startsWith('0')) return '+64' + s.slice(1);

  // 64212769799 -> +64212769799
  if (s.startsWith('64')) return '+' + s;

  return s;
}

async function tnzSendSms({ to, message }) {
  const cleanedTo = normalizeNz(to);
  const cleanedMsg = String(message || '').trim();

  if (!cleanedTo.startsWith('+')) throw new Error(`Bad phone format: ${to}`);
  if (!cleanedTo) throw new Error('TNZ send blocked. Missing phone number');
  if (!cleanedMsg) throw new Error('TNZ send blocked. Missing message');

  const raw = TNZ_AUTH_TOKEN.value().trim();
  const authHeader = raw.toLowerCase().startsWith('basic ')
    ? raw
    : `Basic ${raw}`;

  const payload = {
    MessageData: {
      Message: cleanedMsg,
      Destinations: [{ Recipient: cleanedTo }],
    },
  };

  const r = await fetch('https://api.tnz.co.nz/api/v2.04/send/sms', {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  if (!r.ok) throw new Error(`TNZ error ${r.status} ${text}`);

  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
  }

  return { to: cleanedTo, response: parsed };
}

module.exports = { TNZ_AUTH_TOKEN, tnzSendSms };
