// WhatsApp Business Cloud API (Meta). Messages to customers must use templates approved in WhatsApp Manager.
const { getSettings } = require('./db');

const BASE = process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0';

async function configured(s) {
  s = s || await getSettings();
  return s.whatsapp_enabled === '1' && !!s.whatsapp_phone_id && !!s.whatsapp_token;
}

// "98450 12345" / "+91 9845012345" → "919845012345"
function toE164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return '91' + d;
  if (d.length === 12 && d.startsWith('91')) return d;
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1);
  return d.length >= 11 ? d : null;
}

async function sendTemplate(to, template, params) {
  const s = await getSettings();
  const number = toE164(to);
  if (!number) throw new Error(`Invalid phone number: ${to}`);
  const res = await fetch(`${BASE}/${encodeURIComponent(s.whatsapp_phone_id)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.whatsapp_token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: number,
      type: 'template',
      template: {
        name: template,
        language: { code: s.whatsapp_lang || 'en' },
        components: params.length ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p ?? '-').slice(0, 1000) || '-' })) }] : [],
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `WhatsApp API error ${res.status}`);
  return data.messages?.[0]?.id || 'sent';
}

module.exports = { configured, sendTemplate, toE164 };
