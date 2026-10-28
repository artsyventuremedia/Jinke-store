// SMS through MSG91 "Flows". In India every SMS template must be DLT-registered; create the flow in MSG91
// with variables var1, var2, … and paste its template ID into Admin → Integrations.
const { getSettings } = require('./db');
const { toE164 } = require('./whatsapp');

const BASE = process.env.MSG91_API_BASE || 'https://control.msg91.com/api/v5';

async function configured(s) {
  s = s || await getSettings();
  return s.sms_enabled === '1' && !!s.msg91_authkey;
}

async function sendFlow(to, templateId, vars) {
  const s = await getSettings();
  const number = toE164(to);
  if (!number) throw new Error(`Invalid phone number: ${to}`);
  const recipient = { mobiles: number };
  const isUrl = (v) => /^https?:\/\//.test(String(v));
  // DLT variables are usually limited to 30 characters. Links are left whole and shortened by MSG91 instead.
  vars.forEach((v, i) => { recipient[`var${i + 1}`] = isUrl(v) ? String(v) : String(v ?? '-').slice(0, 30) || '-'; });
  const res = await fetch(`${BASE}/flow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json', authkey: s.msg91_authkey },
    body: JSON.stringify({ template_id: templateId, short_url: vars.some(isUrl) ? '1' : '0', recipients: [recipient] }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.type === 'error') throw new Error(data.message || `MSG91 error ${res.status}`);
  return data.message || 'sent';
}

module.exports = { configured, sendFlow };
