import crypto from 'crypto';
import { decryptSecret, maskSecret } from './crypto.ts';
import { db } from './db.ts';

export interface ProviderMeta {
  id: string;
  code: string;
  name: string;
  api_base_url: string;
  is_active: number;
  is_demo: number;
  supported_durations: string;
  description: string;
  updated_at: number;
}

export interface CredentialStatus {
  keyName: string;
  configured: boolean;
  source: 'env' | 'vault' | 'none';
  maskedPreview: string;
}

export const COUNTRY_METADATA = [
  { code: 'ID', name: 'Indonesia', dialCode: '+62', carriers: ['Telkomsel', 'Indosat Ooredoo', 'XL Axiata'] },
  { code: 'US', name: 'United States', dialCode: '+1', carriers: ['AT&T Mobility', 'T-Mobile US', 'Verizon'] },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', carriers: ['Vodafone UK', 'EE Mobile', 'O2 UK'] },
  { code: 'SG', name: 'Singapore', dialCode: '+65', carriers: ['Singtel', 'StarHub', 'M1'] },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', carriers: ['Maxis', 'CelcomDigi', 'U Mobile'] },
  { code: 'JP', name: 'Japan', dialCode: '+81', carriers: ['NTT Docomo', 'SoftBank', 'au KDDI'] },
];

export const PATTERN_CATEGORIES = [
  'Semua Kategori',
  '6 Digit Kembar',
  'Quad Repeat',
  'Lucky 8888',
  'Sequential',
  'Double Pair',
  'Alternating',
  'Mirror',
  'Custom Pattern',
];

export const PRESET_PATTERNS = [
  '999999',
  '888888',
  '777777',
  '666666',
  '555555',
  '444444',
  '333333',
  '222222',
  '111111',
  '000000',
  '7777',
  '8888',
  '9999',
  '1234',
  '1122',
  '1212',
];

export const PROVIDER_KEY_SPEC: Record<string, string[]> = {
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
  vonage: ['VONAGE_API_KEY', 'VONAGE_API_SECRET'],
  telnyx: ['TELNYX_API_KEY'],
  demo_sandbox: [],
};

export function getResolvedCredentials(providerId: string, providerCode: string): Record<string, string> {
  const keys = PROVIDER_KEY_SPEC[providerCode] || [];
  const result: Record<string, string> = {};

  for (const keyName of keys) {
    const envVal = process.env[keyName]?.trim();
    if (envVal) {
      result[keyName] = envVal;
      continue;
    }
    const row = db
      .prepare('SELECT encrypted_value FROM provider_credentials WHERE provider_id = ? AND key_name = ?')
      .get(providerId, keyName) as { encrypted_value: string } | undefined;
    if (row) {
      try {
        result[keyName] = decryptSecret(row.encrypted_value);
      } catch {
        // Ignore corrupted entry
      }
    }
  }
  return result;
}

export function getCredentialStatuses(providerId: string, providerCode: string): CredentialStatus[] {
  const keys = PROVIDER_KEY_SPEC[providerCode] || [];
  return keys.map((keyName) => {
    const envVal = process.env[keyName]?.trim();
    if (envVal) {
      return {
        keyName,
        configured: true,
        source: 'env',
        maskedPreview: maskSecret(envVal),
      };
    }
    const row = db
      .prepare('SELECT masked_preview FROM provider_credentials WHERE provider_id = ? AND key_name = ?')
      .get(providerId, keyName) as { masked_preview: string } | undefined;
    if (row) {
      return {
        keyName,
        configured: true,
        source: 'vault',
        maskedPreview: row.masked_preview,
      };
    }
    return {
      keyName,
      configured: false,
      source: 'none',
      maskedPreview: '',
    };
  });
}

export function hasConfiguredLiveProvider(): boolean {
  const providers = db
    .prepare('SELECT id, code FROM providers WHERE is_active = 1 AND is_demo = 0')
    .all() as Array<{ id: string; code: string }>;

  return providers.some((p) => {
    const required = PROVIDER_KEY_SPEC[p.code] || [];
    if (required.length === 0) return false;
    const creds = getResolvedCredentials(p.id, p.code);
    return required.every((k) => Boolean(creds[k]));
  });
}

export function classifyPatternCategory(digits: string): string {
  if (/(\d)\1{5}$/.test(digits)) {
    return '6 Digit Kembar';
  }
  if (/(\d)\1{3}$/.test(digits)) {
    return digits.endsWith('8888') ? 'Lucky 8888' : 'Quad Repeat';
  }
  if (/(0123|1234|2345|3456|4567|5678|6789)$/.test(digits)) {
    return 'Sequential';
  }
  if (/(\d)\1(\d)\2$/.test(digits)) {
    return 'Double Pair';
  }
  if (/(\d)(\d)\1\2$/.test(digits)) {
    return 'Alternating';
  }
  if (/(\d)(\d)\2\1$/.test(digits)) {
    return 'Mirror';
  }
  return 'Custom Pattern';
}

export async function searchLiveProviderNumbers(params: {
  provider: ProviderMeta;
  countryCode: string;
  pattern: string;
}): Promise<Array<{ phoneNumber: string; carrier: string; region: string }>> {
  const creds = getResolvedCredentials(params.provider.id, params.provider.code);
  const cleanPattern = params.pattern.replace(/\D/g, '');

  if (params.provider.code === 'twilio' && creds.TWILIO_ACCOUNT_SID && creds.TWILIO_AUTH_TOKEN) {
    const sid = creds.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${creds.TWILIO_AUTH_TOKEN}`).toString('base64');
    const url = new URL(`${params.provider.api_base_url}/Accounts/${sid}/AvailablePhoneNumbers/${params.countryCode}/Local.json`);
    if (cleanPattern) {
      url.searchParams.set('Contains', `*${cleanPattern}*`);
    }
    url.searchParams.set('PageSize', '12');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!response.ok) {
      throw new Error(`Twilio API mengembalikan status ${response.status}`);
    }
    const data = (await response.json()) as {
      available_phone_numbers?: Array<{ phone_number: string; region?: string; locality?: string }>;
    };
    return (data.available_phone_numbers || []).map((item) => ({
      phoneNumber: item.phone_number,
      carrier: 'Twilio Carrier Network',
      region: item.locality || item.region || params.countryCode,
    }));
  }

  if (params.provider.code === 'vonage' && creds.VONAGE_API_KEY && creds.VONAGE_API_SECRET) {
    const url = new URL(`${params.provider.api_base_url}/number/search`);
    url.searchParams.set('api_key', creds.VONAGE_API_KEY);
    url.searchParams.set('api_secret', creds.VONAGE_API_SECRET);
    url.searchParams.set('country', params.countryCode);
    url.searchParams.set('features', 'SMS');
    if (cleanPattern) {
      url.searchParams.set('pattern', cleanPattern);
      url.searchParams.set('search_pattern', '1');
    }
    url.searchParams.set('size', '12');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Vonage API mengembalikan status ${response.status}`);
    }
    const data = (await response.json()) as {
      numbers?: Array<{ msisdn: string }>;
    };
    return (data.numbers || []).map((item) => ({
      phoneNumber: item.msisdn.startsWith('+') ? item.msisdn : `+${item.msisdn}`,
      carrier: 'Vonage Carrier Network',
      region: params.countryCode,
    }));
  }

  if (params.provider.code === 'telnyx' && creds.TELNYX_API_KEY) {
    const url = new URL(`${params.provider.api_base_url}/available_phone_numbers`);
    url.searchParams.set('filter[country_code]', params.countryCode);
    url.searchParams.set('filter[features][]', 'sms');
    if (cleanPattern) {
      url.searchParams.set('filter[phone_number][contains]', cleanPattern);
    }
    url.searchParams.set('filter[limit]', '12');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${creds.TELNYX_API_KEY}` },
    });
    if (!response.ok) {
      throw new Error(`Telnyx API mengembalikan status ${response.status}`);
    }
    const data = (await response.json()) as {
      data?: Array<{ phone_number: string }>;
    };
    return (data.data || []).map((item) => ({
      phoneNumber: item.phone_number,
      carrier: 'Telnyx Network',
      region: params.countryCode,
    }));
  }

  return [];
}

export async function provisionLiveNumber(params: {
  provider: ProviderMeta;
  phoneNumber: string;
}): Promise<{ providerSid: string }> {
  const creds = getResolvedCredentials(params.provider.id, params.provider.code);
  const webhookBase = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/api/webhooks/sms` : '';

  if (params.provider.code === 'twilio' && creds.TWILIO_ACCOUNT_SID && creds.TWILIO_AUTH_TOKEN) {
    const sid = creds.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${creds.TWILIO_AUTH_TOKEN}`).toString('base64');
    const body = new URLSearchParams({ PhoneNumber: params.phoneNumber });
    if (webhookBase) {
      body.set('SmsUrl', `${webhookBase}/twilio`);
    }
    const response = await fetch(`${params.provider.api_base_url}/Accounts/${sid}/IncomingPhoneNumbers.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gagal menyewa nomor via Twilio API: ${errText.slice(0, 140)}`);
    }
    const data = (await response.json()) as { sid: string };
    return { providerSid: data.sid };
  }

  if (params.provider.code === 'vonage' && creds.VONAGE_API_KEY && creds.VONAGE_API_SECRET) {
    const cleanMsisdn = params.phoneNumber.replace(/\D/g, '');
    const body = new URLSearchParams({
      api_key: creds.VONAGE_API_KEY,
      api_secret: creds.VONAGE_API_SECRET,
      country: params.phoneNumber.startsWith('+62') ? 'ID' : 'US',
      msisdn: cleanMsisdn,
    });
    const response = await fetch(`${params.provider.api_base_url}/number/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(`Gagal menyewa nomor via Vonage API (${response.status})`);
    }
    return { providerSid: `vonage-${cleanMsisdn}` };
  }

  if (params.provider.code === 'telnyx' && creds.TELNYX_API_KEY) {
    const response = await fetch(`${params.provider.api_base_url}/number_orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone_numbers: [{ phone_number: params.phoneNumber }] }),
    });
    if (!response.ok) {
      throw new Error(`Gagal menyewa nomor via Telnyx API (${response.status})`);
    }
    const data = (await response.json()) as { data?: { id?: string } };
    return { providerSid: data.data?.id || `telnyx-${crypto.randomUUID()}` };
  }

  throw new Error('Kredensial provider resmi belum dikonfigurasi.');
}

export async function releaseLiveNumber(params: {
  provider: ProviderMeta;
  providerSid: string;
}): Promise<void> {
  const creds = getResolvedCredentials(params.provider.id, params.provider.code);
  if (params.provider.code === 'twilio' && creds.TWILIO_ACCOUNT_SID && creds.TWILIO_AUTH_TOKEN && params.providerSid) {
    const sid = creds.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${creds.TWILIO_AUTH_TOKEN}`).toString('base64');
    await fetch(`${params.provider.api_base_url}/Accounts/${sid}/IncomingPhoneNumbers/${params.providerSid}.json`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${auth}` },
    }).catch(() => undefined);
  }
}

export async function fetchLiveInboundSms(params: {
  provider: ProviderMeta;
  phoneNumber: string;
  sinceMs: number;
}): Promise<Array<{ sender: string; body: string; receivedAt: number }>> {
  const creds = getResolvedCredentials(params.provider.id, params.provider.code);
  if (params.provider.code === 'twilio' && creds.TWILIO_ACCOUNT_SID && creds.TWILIO_AUTH_TOKEN) {
    const sid = creds.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${creds.TWILIO_AUTH_TOKEN}`).toString('base64');
    const url = new URL(`${params.provider.api_base_url}/Accounts/${sid}/Messages.json`);
    url.searchParams.set('To', params.phoneNumber);
    url.searchParams.set('PageSize', '20');
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}` },
    }).catch(() => null);
    if (!resp || !resp.ok) return [];
    const data = (await resp.json()) as {
      messages?: Array<{ from?: string; body?: string; date_sent?: string; direction?: string }>;
    };
    return (data.messages || [])
      .filter((m) => m.direction === 'inbound' && m.body)
      .map((m) => ({
        sender: m.from || 'CarrierSMS',
        body: m.body || '',
        receivedAt: m.date_sent ? Date.parse(m.date_sent) : Date.now(),
      }))
      .filter((m) => m.receivedAt >= params.sinceMs);
  }
  return [];
}

export function ensureDemoSandboxCustomMatch(params: {
  countryCode: string;
  carrier?: string;
  customPattern: string;
}): void {
  const cleanDigits = params.customPattern.replace(/\D/g, '').slice(0, 8);
  if (cleanDigits.length < 2) return;

  const country = COUNTRY_METADATA.find((c) => c.code === params.countryCode) || COUNTRY_METADATA[0];
  const existing = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM virtual_numbers
       WHERE status = 'Available' AND is_demo = 1 AND country_code = ? AND replace(replace(replace(phone_number, '-', ''), ' ', ''), '+', '') LIKE ?`
    )
    .get(country.code, `%${cleanDigits}%`) as { cnt: number };

  if (existing.cnt > 0) return;

  const chosenCarrier =
    params.carrier && params.carrier !== 'Semua Operator' ? params.carrier : country.carriers[0];
  const isLongPattern = cleanDigits.length >= 6;
  const prefixDigits =
    country.code === 'ID'
      ? isLongPattern
        ? `812-${Math.floor(10 + Math.random() * 89)}`
        : `812-${Math.floor(1000 + Math.random() * 8999)}`
      : country.code === 'US'
        ? isLongPattern
          ? `(415) ${Math.floor(10 + Math.random() * 89)}`
          : `(415) ${Math.floor(200 + Math.random() * 799)}`
        : isLongPattern
          ? `${Math.floor(71 + Math.random() * 28)}`
          : `${Math.floor(7100 + Math.random() * 1999)}`;

  const formattedNumber = `${country.dialCode} ${prefixDigits}-${cleanDigits}`;
  const category = classifyPatternCategory(cleanDigits);

  db.prepare(`
    INSERT OR IGNORE INTO virtual_numbers (
      id, provider_id, phone_number, country_code, country_name, dial_code, carrier,
      pattern_category, matched_pattern, price_10m, price_30m, price_1h, price_24h,
      status, is_demo, created_at
    ) VALUES (?, 'prov-demo', ?, ?, ?, ?, ?, ?, ?, 11000, 20000, 34000, 72000, 'Available', 1, ?)
  `).run(
    crypto.randomUUID(),
    formattedNumber,
    country.code,
    country.name,
    country.dialCode,
    chosenCarrier,
    category,
    cleanDigits,
    Date.now()
  );
}

export function extractOtpCode(messageBody: string): string | null {
  const match = messageBody.match(/\b(\d{4,8})\b/);
  return match ? match[1] : null;
}
