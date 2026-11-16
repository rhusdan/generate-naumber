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
  telnyx: ['TELNYX_API_KEY', 'TELNYX_MESSAGING_PROFILE_ID'],
  demo_sandbox: [],
};

export const PROVIDER_REQUIRED_KEYS: Record<string, string[]> = {
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
  vonage: ['VONAGE_API_KEY', 'VONAGE_API_SECRET'],
  telnyx: ['TELNYX_API_KEY'],
  demo_sandbox: [],
};

export function sanitizeCredentialValue(keyName: string, rawValue: string): string {
  let val = rawValue.trim();
  // Strip accidental surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1).trim();
  }
  if (keyName === 'TELNYX_API_KEY') {
    val = val.replace(/^authorization:\s*/i, '').replace(/^bearer\s+/i, '').trim();
  }
  if (keyName === 'TELNYX_MESSAGING_PROFILE_ID') {
    const uuidMatch = val.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) {
      val = uuidMatch[0];
    }
  }
  return val;
}

export function getResolvedCredentials(providerId: string, providerCode: string): Record<string, string> {
  const keys = PROVIDER_KEY_SPEC[providerCode] || [];
  const result: Record<string, string> = {};

  for (const keyName of keys) {
    const envVal = process.env[keyName]?.trim();
    if (envVal) {
      result[keyName] = sanitizeCredentialValue(keyName, envVal);
      continue;
    }
    const row = db
      .prepare('SELECT encrypted_value FROM provider_credentials WHERE provider_id = ? AND key_name = ?')
      .get(providerId, keyName) as { encrypted_value: string } | undefined;
    if (row) {
      try {
        result[keyName] = sanitizeCredentialValue(keyName, decryptSecret(row.encrypted_value));
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

export function isProviderReady(providerId: string, providerCode: string): boolean {
  const required = PROVIDER_REQUIRED_KEYS[providerCode] || [];
  if (required.length === 0) return false;
  const creds = getResolvedCredentials(providerId, providerCode);
  return required.every((k) => Boolean(creds[k]));
}

export function hasConfiguredLiveProvider(): boolean {
  const providers = db
    .prepare('SELECT id, code FROM providers WHERE is_active = 1 AND is_demo = 0')
    .all() as Array<{ id: string; code: string }>;

  return providers.some((p) => isProviderReady(p.id, p.code));
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

export async function testLiveProviderConnection(provider: ProviderMeta): Promise<{
  ok: boolean;
  details: string;
  error?: string;
}> {
  const creds = getResolvedCredentials(provider.id, provider.code);

  if (provider.code === 'twilio') {
    if (!creds.TWILIO_ACCOUNT_SID || !creds.TWILIO_AUTH_TOKEN) {
      return { ok: false, details: '', error: 'TWILIO_ACCOUNT_SID atau TWILIO_AUTH_TOKEN belum diisi.' };
    }
    const sid = creds.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${creds.TWILIO_AUTH_TOKEN}`).toString('base64');
    const resp = await fetch(`${provider.api_base_url}/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${auth}` },
    }).catch((e) => e);
    if (resp instanceof Error) {
      return { ok: false, details: '', error: `Koneksi gagal: ${resp.message}` };
    }
    const data = (await resp.json().catch(() => ({}))) as {
      status?: string;
      type?: string;
      friendly_name?: string;
      message?: string;
    };
    if (!resp.ok) {
      return {
        ok: false,
        details: '',
        error: `Twilio menolak autentikasi (${resp.status}): ${data.message || 'Periksa Account SID & Auth Token.'}`,
      };
    }
    return {
      ok: true,
      details: `Terhubung ke Twilio (${data.friendly_name || sid}) · Tipe: ${data.type || 'Standard'} · Status: ${data.status || 'active'}`,
    };
  }

  if (provider.code === 'vonage') {
    if (!creds.VONAGE_API_KEY || !creds.VONAGE_API_SECRET) {
      return { ok: false, details: '', error: 'VONAGE_API_KEY atau VONAGE_API_SECRET belum diisi.' };
    }
    const url = new URL(`${provider.api_base_url}/account/get-balance`);
    url.searchParams.set('api_key', creds.VONAGE_API_KEY);
    url.searchParams.set('api_secret', creds.VONAGE_API_SECRET);
    const resp = await fetch(url.toString()).catch((e) => e);
    if (resp instanceof Error) {
      return { ok: false, details: '', error: `Koneksi gagal: ${resp.message}` };
    }
    const data = (await resp.json().catch(() => ({}))) as { value?: number; 'error-code-label'?: string };
    if (!resp.ok || data['error-code-label']) {
      return {
        ok: false,
        details: '',
        error: `Vonage menolak autentikasi (${resp.status}): ${data['error-code-label'] || 'Periksa API Key & Secret.'}`,
      };
    }
    return {
      ok: true,
      details: `Terhubung ke Vonage · Saldo akun: €${Number(data.value || 0).toFixed(2)}`,
    };
  }

  if (provider.code === 'telnyx') {
    if (!creds.TELNYX_API_KEY) {
      return {
        ok: false,
        details: '',
        error:
          'TELNYX_API_KEY belum diisi. Buat API Key (diawali "KEY...") di Telnyx Portal → Account Settings → Keys & Credentials → API Keys.',
      };
    }

    const apiKey = creds.TELNYX_API_KEY;
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(apiKey);
    if (looksLikeUuid) {
      return {
        ok: false,
        details: '',
        error:
          'Nilai di TELNYX_API_KEY berformat UUID (Messaging Profile ID), bukan API Key. Pindahkan UUID tersebut ke TELNYX_MESSAGING_PROFILE_ID, dan isi TELNYX_API_KEY dengan API Key yang diawali "KEY..." dari Telnyx Portal → API Keys.',
      };
    }

    let resp = await fetch(`${provider.api_base_url}/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch((e) => e);

    if (!(resp instanceof Error) && resp.status === 403) {
      resp = await fetch(`${provider.api_base_url}/phone_numbers?page[size]=1`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }).catch((e) => e);
    }

    if (resp instanceof Error) {
      return { ok: false, details: '', error: `Koneksi gagal: ${resp.message}` };
    }

    const bodyJson = (await resp.json().catch(() => ({}))) as {
      data?: { balance?: string; currency?: string };
      errors?: Array<{ detail?: string; title?: string; code?: string }>;
    };

    if (!resp.ok) {
      const apiDetail = bodyJson.errors?.[0]?.detail || bodyJson.errors?.[0]?.title || '';
      const keyPrefixHint = !apiKey.startsWith('KEY')
        ? ' Pastikan menggunakan API Key v2 yang diawali "KEY..." (bukan Public Key atau API v1 Secret).'
        : ' Pastikan API Key masih aktif/belum dicabut di Telnyx Portal → API Keys.';
      return {
        ok: false,
        details: '',
        error: `Telnyx menolak autentikasi (${resp.status})${apiDetail ? `: ${apiDetail}.` : '.'}${keyPrefixHint}`,
      };
    }

    const balanceInfo =
      bodyJson.data?.balance !== undefined
        ? `Saldo: ${bodyJson.data.balance} ${bodyJson.data.currency || 'USD'}`
        : 'API Key v2 aktif';

    if (creds.TELNYX_MESSAGING_PROFILE_ID) {
      const profileResp = await fetch(
        `${provider.api_base_url}/messaging_profiles/${encodeURIComponent(creds.TELNYX_MESSAGING_PROFILE_ID)}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      ).catch((e) => e);

      if (profileResp instanceof Error) {
        return {
          ok: false,
          details: '',
          error: `API Key valid, tetapi gagal memeriksa Messaging Profile: ${profileResp.message}`,
        };
      }
      if (!profileResp.ok) {
        return {
          ok: false,
          details: '',
          error: `API Key valid, tetapi TELNYX_MESSAGING_PROFILE_ID (${creds.TELNYX_MESSAGING_PROFILE_ID}) tidak ditemukan (${profileResp.status}).`,
        };
      }
      const profileJson = (await profileResp.json().catch(() => ({}))) as {
        data?: { name?: string; webhook_url?: string | null };
      };
      const profileName = profileJson.data?.name || creds.TELNYX_MESSAGING_PROFILE_ID;
      const webhookStatus = profileJson.data?.webhook_url
        ? `Webhook: ${profileJson.data.webhook_url}`
        : 'Webhook URL belum diatur di Telnyx Portal';
      return {
        ok: true,
        details: `Terhubung ke Telnyx (${balanceInfo}) · Profile: ${profileName} · ${webhookStatus}`,
      };
    }

    return {
      ok: true,
      details: `Terhubung ke Telnyx (${balanceInfo}). Disarankan mengisi TELNYX_MESSAGING_PROFILE_ID agar nomor otomatis terhubung ke webhook SMS masuk.`,
    };
  }

  return { ok: true, details: 'Mode Demo Sandbox aktif.' };
}

export async function fetchOwnedProviderNumbers(provider: ProviderMeta): Promise<
  Array<{ phoneNumber: string; countryCode: string; carrier: string; providerSid: string }>
> {
  const creds = getResolvedCredentials(provider.id, provider.code);

  if (provider.code === 'twilio' && creds.TWILIO_ACCOUNT_SID && creds.TWILIO_AUTH_TOKEN) {
    const sid = creds.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${creds.TWILIO_AUTH_TOKEN}`).toString('base64');
    const resp = await fetch(`${provider.api_base_url}/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=20`, {
      headers: { Authorization: `Basic ${auth}` },
    }).catch(() => null);
    if (!resp || !resp.ok) return [];
    const data = (await resp.json().catch(() => ({}))) as {
      incoming_phone_numbers?: Array<{ sid: string; phone_number: string }>;
    };
    return (data.incoming_phone_numbers || []).map((item) => ({
      phoneNumber: item.phone_number,
      countryCode: item.phone_number.startsWith('+62')
        ? 'ID'
        : item.phone_number.startsWith('+44')
          ? 'GB'
          : item.phone_number.startsWith('+65')
            ? 'SG'
            : item.phone_number.startsWith('+60')
              ? 'MY'
              : item.phone_number.startsWith('+81')
                ? 'JP'
                : 'US',
      carrier: 'Twilio Owned Number',
      providerSid: item.sid,
    }));
  }

  if (provider.code === 'vonage' && creds.VONAGE_API_KEY && creds.VONAGE_API_SECRET) {
    const url = new URL(`${provider.api_base_url}/account/numbers`);
    url.searchParams.set('api_key', creds.VONAGE_API_KEY);
    url.searchParams.set('api_secret', creds.VONAGE_API_SECRET);
    const resp = await fetch(url.toString()).catch(() => null);
    if (!resp || !resp.ok) return [];
    const data = (await resp.json().catch(() => ({}))) as {
      numbers?: Array<{ country: string; msisdn: string }>;
    };
    return (data.numbers || []).map((item) => ({
      phoneNumber: item.msisdn.startsWith('+') ? item.msisdn : `+${item.msisdn}`,
      countryCode: item.country || 'US',
      carrier: 'Vonage Owned Number',
      providerSid: `vonage-${item.msisdn}`,
    }));
  }

  if (provider.code === 'telnyx' && creds.TELNYX_API_KEY) {
    const resp = await fetch(`${provider.api_base_url}/phone_numbers?page[size]=20`, {
      headers: { Authorization: `Bearer ${creds.TELNYX_API_KEY}` },
    }).catch(() => null);
    if (!resp || !resp.ok) return [];
    const data = (await resp.json().catch(() => ({}))) as {
      data?: Array<{ id: string; phone_number: string; country_iso_alpha2?: string }>;
    };
    return (data.data || []).map((item) => ({
      phoneNumber: item.phone_number,
      countryCode:
        item.country_iso_alpha2 ||
        (item.phone_number.startsWith('+62')
          ? 'ID'
          : item.phone_number.startsWith('+44')
            ? 'GB'
            : item.phone_number.startsWith('+65')
              ? 'SG'
              : item.phone_number.startsWith('+60')
                ? 'MY'
                : item.phone_number.startsWith('+81')
                  ? 'JP'
                  : 'US'),
      carrier: 'Telnyx Owned Number',
      providerSid: item.id,
    }));
  }

  return [];
}

export async function searchLiveProviderNumbers(params: {
  provider: ProviderMeta;
  countryCode: string;
  pattern: string;
}): Promise<Array<{ phoneNumber: string; carrier: string; region: string }>> {
  const creds = getResolvedCredentials(params.provider.id, params.provider.code);
  const cleanPattern = params.pattern.replace(/\D/g, '');
  const safeCountry =
    !params.countryCode || params.countryCode === 'ALL' ? 'US' : params.countryCode.toUpperCase();

  if (params.provider.code === 'twilio' && creds.TWILIO_ACCOUNT_SID && creds.TWILIO_AUTH_TOKEN) {
    const sid = creds.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${creds.TWILIO_AUTH_TOKEN}`).toString('base64');

    const tryEndpoint = async (type: 'Local' | 'Mobile') => {
      const url = new URL(
        `${params.provider.api_base_url}/Accounts/${sid}/AvailablePhoneNumbers/${safeCountry}/${type}.json`
      );
      if (cleanPattern) {
        url.searchParams.set('Contains', `*${cleanPattern}*`);
      }
      url.searchParams.set('PageSize', '12');

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!response.ok) {
        const errJson = (await response.json().catch(() => ({}))) as { message?: string };
        return { ok: false as const, status: response.status, message: errJson.message, items: [] };
      }
      const data = (await response.json()) as {
        available_phone_numbers?: Array<{ phone_number: string; region?: string; locality?: string }>;
      };
      return {
        ok: true as const,
        status: response.status,
        items: (data.available_phone_numbers || []).map((item) => ({
          phoneNumber: item.phone_number,
          carrier: `Twilio ${type} Network`,
          region: item.locality || item.region || safeCountry,
        })),
      };
    };

    const localRes = await tryEndpoint('Local');
    if (localRes.ok && localRes.items.length > 0) {
      return localRes.items;
    }
    const mobileRes = await tryEndpoint('Mobile');
    if (mobileRes.ok && mobileRes.items.length > 0) {
      return mobileRes.items;
    }
    if (!localRes.ok && !mobileRes.ok) {
      throw new Error(
        `Twilio API (${localRes.status}): ${localRes.message || 'Gagal mengambil daftar nomor tersedia.'}`
      );
    }
    return [];
  }

  if (params.provider.code === 'vonage' && creds.VONAGE_API_KEY && creds.VONAGE_API_SECRET) {
    const url = new URL(`${params.provider.api_base_url}/number/search`);
    url.searchParams.set('api_key', creds.VONAGE_API_KEY);
    url.searchParams.set('api_secret', creds.VONAGE_API_SECRET);
    url.searchParams.set('country', safeCountry);
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
      region: safeCountry,
    }));
  }

  if (params.provider.code === 'telnyx' && creds.TELNYX_API_KEY) {
    const url = new URL(`${params.provider.api_base_url}/available_phone_numbers`);
    url.searchParams.set('filter[country_code]', safeCountry);
    url.searchParams.set('filter[features][]', 'sms');
    if (cleanPattern) {
      url.searchParams.set('filter[phone_number][contains]', cleanPattern);
    }
    url.searchParams.set('filter[limit]', '12');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${creds.TELNYX_API_KEY}` },
    });
    if (!response.ok) {
      const errJson = (await response.json().catch(() => ({}))) as {
        errors?: Array<{ detail?: string; title?: string }>;
      };
      const detail = errJson.errors?.[0]?.detail || errJson.errors?.[0]?.title;
      throw new Error(
        `Telnyx API mengembalikan status ${response.status}${detail ? `: ${detail}` : '. Periksa TELNYX_API_KEY (harus API v2 KEY...) di Admin Console.'}`
      );
    }
    const data = (await response.json()) as {
      data?: Array<{ phone_number: string }>;
    };
    return (data.data || []).map((item) => ({
      phoneNumber: item.phone_number,
      carrier: 'Telnyx Network',
      region: safeCountry,
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

    // Check if the number is already owned on this Twilio account (e.g. Twilio Trial number)
    const ownedResp = await fetch(
      `${params.provider.api_base_url}/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(params.phoneNumber)}`,
      { headers: { Authorization: `Basic ${auth}` } }
    ).catch(() => null);

    if (ownedResp && ownedResp.ok) {
      const ownedData = (await ownedResp.json().catch(() => ({}))) as {
        incoming_phone_numbers?: Array<{ sid: string; phone_number: string }>;
      };
      const existing = ownedData.incoming_phone_numbers?.[0];
      if (existing) {
        if (webhookBase) {
          await fetch(`${params.provider.api_base_url}/Accounts/${sid}/IncomingPhoneNumbers/${existing.sid}.json`, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ SmsUrl: `${webhookBase}/twilio` }).toString(),
          }).catch(() => undefined);
        }
        return { providerSid: existing.sid };
      }
    }

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
      const errJson = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(`Gagal menyewa nomor via Twilio API: ${errJson.message || `Status ${response.status}`}`);
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
    // 1. Check if the number is already owned on this Telnyx account
    const ownedResp = await fetch(
      `${params.provider.api_base_url}/phone_numbers?filter[phone_number]=${encodeURIComponent(params.phoneNumber)}`,
      { headers: { Authorization: `Bearer ${creds.TELNYX_API_KEY}` } }
    ).catch(() => null);

    if (ownedResp && ownedResp.ok) {
      const ownedData = (await ownedResp.json().catch(() => ({}))) as {
        data?: Array<{ id: string; phone_number: string }>;
      };
      const existing = ownedData.data?.[0];
      if (existing) {
        if (creds.TELNYX_MESSAGING_PROFILE_ID) {
          await fetch(`${params.provider.api_base_url}/phone_numbers/${existing.id}/messaging`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${creds.TELNYX_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messaging_profile_id: creds.TELNYX_MESSAGING_PROFILE_ID }),
          }).catch(() => undefined);
        }
        return { providerSid: existing.id };
      }
    }

    // 2. Otherwise order the number and attach the Messaging Profile if configured
    const orderBody: {
      phone_numbers: Array<{ phone_number: string }>;
      messaging_profile_id?: string;
    } = {
      phone_numbers: [{ phone_number: params.phoneNumber }],
    };
    if (creds.TELNYX_MESSAGING_PROFILE_ID) {
      orderBody.messaging_profile_id = creds.TELNYX_MESSAGING_PROFILE_ID;
    }

    const response = await fetch(`${params.provider.api_base_url}/number_orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderBody),
    });
    if (!response.ok) {
      const errJson = (await response.json().catch(() => ({}))) as {
        errors?: Array<{ detail?: string; title?: string }>;
      };
      const detail = errJson.errors?.[0]?.detail || errJson.errors?.[0]?.title;
      throw new Error(`Gagal menyewa nomor via Telnyx API (${response.status})${detail ? `: ${detail}` : ''}`);
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
