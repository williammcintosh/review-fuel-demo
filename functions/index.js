const { setGlobalOptions } = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const OpenAI = require('openai');
const { TNZ_AUTH_TOKEN, tnzSendSms } = require('./tnz');

setGlobalOptions({ maxInstances: 10 });
admin.initializeApp();

const DEMO_PASS = defineSecret('DEMO_PASS');
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

// You control these. GPT never sees them.
const REVIEW_LINK = 'https://bit.ly/4jcuCf0';
const SUFFIX = ` ${REVIEW_LINK} Reply STOP to opt out`;

const SMS_MAX = 320;
const PREFIX_MAX = Math.max(1, SMS_MAX - SUFFIX.length);
const PREFIX_TARGET = Math.min(270, PREFIX_MAX);

function stripEmojiAndNonAscii(s) {
  return (s || '').replace(/[^\x00-\x7F]/g, '');
}

function removeLinks(s) {
  return (s || '').replace(/https?:\/\/\S+/gi, '').trim();
}

function cleanupPrefix(s) {
  let out = (s || '').trim();
  out = out.replace(/^["'“”]+|["'“”]+$/g, '');
  out = removeLinks(out);
  out = out.replace(/\b(reply\s+)?stop\b/gi, '').trim();
  out = stripEmojiAndNonAscii(out);
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function truncateToWordBoundary(s, maxLen) {
  if (s.length <= maxLen) return s;
  let cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  cut = cut.trim();
  if (cut && !/[.!?]$/.test(cut)) cut += '.';
  return cut;
}

function buildFinalMessage(prefix) {
  const clean = cleanupPrefix(prefix);
  const safePrefix = truncateToWordBoundary(clean, PREFIX_TARGET);
  let finalMsg = `${safePrefix}${SUFFIX}`.trim();

  if (finalMsg.length > SMS_MAX) {
    const allowed = Math.max(1, SMS_MAX - SUFFIX.length);
    const trimmedPrefix = truncateToWordBoundary(safePrefix, allowed);
    finalMsg = `${trimmedPrefix}${SUFFIX}`.trim();
  }
  return finalMsg;
}

function looksBad(prefix) {
  const p = cleanupPrefix(prefix);
  if (!p) return true;
  if (p.length < 20) return true;
  if (/https?:\/\//i.test(p)) return true;
  if (/\b(stop|opt out)\b/i.test(p)) return true;
  if (/[^\x00-\x7F]/.test(p)) return true;
  if (p.length > 240) return true;
  return false;
}

async function generatePrefixWithGPT(
  { customerName, repName, companyName, items, flavor },
  apiKey
) {
  const client = new OpenAI({ apiKey });

  const toneLine = flavor ? `Tone: ${flavor}` : '';

  const prompt = `
Write a short SMS review request that sounds human, not corporate.

HARD RULES (no exceptions)
- Must ask for a Google review using the words "Google review"
- Must include the customer's first name: ${customerName}
- Must include the business name: ${companyName}
- Must reference the product or service: ${items || 'your recent service'}
- If a staff name exists, it MUST be included: ${repName || ''}
- 1 or 2 sentences max
- No emojis, no links, no opt-out language
- No corporate fluff ("thank you for choosing", "we appreciate", "valued customer")
- Plain ASCII only
- Max ${PREFIX_TARGET} characters

Style
Friendly, confident, specific.
Sound like a real person who actually did the work.

Return ONLY the message text. No quotes.
`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt.trim() }],
  });

  return (completion.choices?.[0]?.message?.content || '').trim();
}

exports.generateDemo = onRequest(
  { secrets: [DEMO_PASS, OPENAI_API_KEY] },
  async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).send('POST only');

      const {
        customerName = '',
        repName = '',
        companyName = '',
        items = '',
        phone = '',
        flavor = '',
        demoPass = '',
      } = req.body || {};

      if (demoPass !== DEMO_PASS.value()) {
        return res.status(401).send('Bad password');
      }

      if (!companyName.trim() || !phone.trim()) {
        return res.status(400).send('Missing fields');
      }

      const apiKey = OPENAI_API_KEY.value();

      let rawPrefix = await generatePrefixWithGPT(
        { customerName, repName, companyName, items, flavor },
        apiKey
      );

      if (looksBad(rawPrefix)) {
        rawPrefix = await generatePrefixWithGPT(
          {
            customerName,
            repName,
            companyName,
            items: `${items} (be concise)`,
            flavor,
          },
          apiKey
        );
      }

      const msg = buildFinalMessage(rawPrefix);

      return res.status(200).json({
        msg,
        chars: msg.length,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).send('Server error');
    }
  }
);

exports.sendDemoSms = onRequest(
  { secrets: [DEMO_PASS, TNZ_AUTH_TOKEN] },
  async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).send('POST only');

      const { phone = '', msg = '', demoPass = '' } = req.body || {};

      if (demoPass !== DEMO_PASS.value()) {
        return res.status(401).send('Bad password');
      }

      if (!phone.trim() || !msg.trim()) {
        return res.status(400).send('Missing fields');
      }

      const tnzResp = await tnzSendSms({ to: phone, message: msg });

      return res.status(200).json({
        ok: true,
        to: tnzResp?.to || phone,
        tnz: tnzResp?.response ?? tnzResp,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).send('Server error');
    }
  }
);

exports.sendDemo = onRequest(
  { secrets: [DEMO_PASS, OPENAI_API_KEY, TNZ_AUTH_TOKEN] },
  async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).send('POST only');

      const {
        customerName = '',
        repName = '',
        companyName = '',
        items = '',
        phone = '',
        flavor = '',
        demoPass = '',
      } = req.body || {};

      if (demoPass !== DEMO_PASS.value()) {
        return res.status(401).send('Bad password');
      }

      if (!companyName.trim() || !phone.trim()) {
        return res.status(400).send('Missing fields');
      }

      const apiKey = OPENAI_API_KEY.value();

      let rawPrefix = await generatePrefixWithGPT(
        { customerName, repName, companyName, items, flavor },
        apiKey
      );

      if (looksBad(rawPrefix)) {
        rawPrefix = await generatePrefixWithGPT(
          {
            customerName,
            repName,
            companyName,
            items: `${items} (be concise)`,
            flavor,
          },
          apiKey
        );
      }

      const msg = buildFinalMessage(rawPrefix);

      console.log('phone incoming', phone);
      await tnzSendSms({ to: phone, message: msg });

      await admin.firestore().collection('demoSends').add({
        customerName,
        repName,
        companyName,
        items,
        phone,
        flavor,
        msg,
        prefixRaw: rawPrefix,
        status: 'AI_GENERATED',
        createdAt: new Date(),
      });

      return res.status(200).json({
        msg,
        chars: msg.length,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).send('Server error');
    }
  }
);
