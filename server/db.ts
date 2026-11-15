import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'beauty_number.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      balance INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      api_base_url TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_demo INTEGER NOT NULL DEFAULT 0,
      supported_durations TEXT NOT NULL DEFAULT '[10,30,60,1440]',
      description TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_credentials (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      key_name TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      masked_preview TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(provider_id, key_name)
    );

    CREATE TABLE IF NOT EXISTS virtual_numbers (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      phone_number TEXT NOT NULL UNIQUE,
      country_code TEXT NOT NULL,
      country_name TEXT NOT NULL,
      dial_code TEXT NOT NULL,
      carrier TEXT NOT NULL,
      pattern_category TEXT NOT NULL,
      matched_pattern TEXT NOT NULL,
      price_10m INTEGER NOT NULL,
      price_30m INTEGER NOT NULL,
      price_1h INTEGER NOT NULL,
      price_24h INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Active', 'Expired')),
      is_demo INTEGER NOT NULL DEFAULT 1,
      rented_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      rented_at INTEGER,
      expires_at INTEGER,
      provider_sid TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rentals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number_id TEXT REFERENCES virtual_numbers(id) ON DELETE SET NULL,
      phone_number TEXT NOT NULL,
      country_code TEXT NOT NULL,
      country_name TEXT NOT NULL,
      carrier TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      provider_code TEXT NOT NULL DEFAULT 'demo_sandbox',
      provider_sid TEXT,
      pattern_category TEXT NOT NULL,
      matched_pattern TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 1,
      duration_minutes INTEGER NOT NULL,
      price_paid INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expired', 'Released')),
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sms_messages (
      id TEXT PRIMARY KEY,
      rental_id TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
      number_id TEXT REFERENCES virtual_numbers(id) ON DELETE SET NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL,
      otp_code TEXT,
      received_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('topup', 'rental', 'refund')),
      amount INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      gateway_provider TEXT NOT NULL DEFAULT 'sandbox',
      gateway_ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Completed' CHECK (status IN ('Pending', 'Completed', 'Failed')),
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_numbers_status ON virtual_numbers(status);
    CREATE INDEX IF NOT EXISTS idx_numbers_country ON virtual_numbers(country_code);
    CREATE INDEX IF NOT EXISTS idx_rentals_user ON rentals(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rentals_status_exp ON rentals(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_sms_rental ON sms_messages(rental_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);
  `);

  seedInitialData();
}

function seedInitialData() {
  const now = Date.now();
  const providerCount = (db.prepare('SELECT COUNT(*) as cnt FROM providers').get() as { cnt: number }).cnt;

  if (providerCount === 0) {
    const insertProvider = db.prepare(`
      INSERT INTO providers (id, code, name, api_base_url, is_active, is_demo, supported_durations, description, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertProvider.run(
      'prov-twilio',
      'twilio',
      'Twilio Programmable SMS',
      'https://api.twilio.com/2010-04-01',
      1,
      0,
      JSON.stringify([10, 30, 60, 1440]),
      'Provider resmi global untuk nomor virtual lokal & SMS real-time melalui REST API dan webhook.',
      now
    );
    insertProvider.run(
      'prov-vonage',
      'vonage',
      'Vonage Number Insight & SMS',
      'https://rest.nexmo.com',
      1,
      0,
      JSON.stringify([10, 30, 60, 1440]),
      'API nomor virtual resmi Vonage (Nexmo) dengan dukungan pencarian pola angka internasional.',
      now
    );
    insertProvider.run(
      'prov-telnyx',
      'telnyx',
      'Telnyx Programmable Numbers',
      'https://api.telnyx.com/v2',
      1,
      0,
      JSON.stringify([10, 30, 60, 1440]),
      'Carrier-grade programmable number API dengan filter pola nomor khusus.',
      now
    );
    insertProvider.run(
      'prov-demo',
      'demo_sandbox',
      'BEAUTY NUMBER Demo Sandbox',
      'internal://demo-sandbox',
      1,
      1,
      JSON.stringify([10, 30, 60, 1440]),
      'Mode sandbox DEMO dengan nomor dummy berlabel DEMO ketika kredensial provider resmi belum dikonfigurasi.',
      now
    );
  }

  const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
  if (userCount === 0) {
    const adminId = 'usr-admin-01';
    const userId = 'usr-rina-01';
    const insertUser = db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, balance, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertUser.run(
      adminId,
      'Arif Pratama (Admin)',
      'admin@beautynumber.id',
      bcrypt.hashSync('AdminBeauty123!', 10),
      'admin',
      2500000,
      now - 86400000 * 14
    );
    insertUser.run(
      userId,
      'Rina Kusuma',
      'rina@beautynumber.id',
      bcrypt.hashSync('UserDemo123!', 10),
      'user',
      250000,
      now - 86400000 * 7
    );

    const insertTx = db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, payment_method, gateway_provider, gateway_ref, status, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertTx.run(
      crypto.randomUUID(),
      userId,
      'topup',
      300000,
      'QRIS',
      'sandbox',
      'BN-QRIS-90412',
      'Completed',
      'Top up saldo via QRIS (Sandbox)',
      now - 86400000 * 5
    );
    insertTx.run(
      crypto.randomUUID(),
      userId,
      'rental',
      50000,
      'Balance',
      'internal',
      'BN-RENT-31008',
      'Completed',
      'Sewa nomor DEMO +62 811-9000-8888 (24 jam)',
      now - 86400000 * 2
    );

    const expiredAt = now - 86400000;
    db.prepare(`
      INSERT INTO rentals (id, user_id, number_id, phone_number, country_code, country_name, carrier, provider_name, provider_code, pattern_category, matched_pattern, is_demo, duration_minutes, price_paid, status, started_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'rnt-hist-01',
      userId,
      null,
      '+62 811-9000-8888',
      'ID',
      'Indonesia',
      'Telkomsel',
      'BEAUTY NUMBER Demo Sandbox',
      'demo_sandbox',
      'Lucky 8888',
      '8888',
      1,
      1440,
      50000,
      'Expired',
      expiredAt - 86400000,
      expiredAt
    );
  }

  const numberCount = (db.prepare('SELECT COUNT(*) as cnt FROM virtual_numbers').get() as { cnt: number }).cnt;
  if (numberCount === 0) {
    const insertNum = db.prepare(`
      INSERT INTO virtual_numbers (
        id, provider_id, phone_number, country_code, country_name, dial_code, carrier,
        pattern_category, matched_pattern, price_10m, price_30m, price_1h, price_24h,
        status, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Available', 1, ?)
    `);

    const demoCatalog: Array<[string, string, string, string, string, string, string, number, number, number, number]> = [
      ['+62 811-0090-7777', 'ID', 'Indonesia', '+62', 'Telkomsel', 'Quad Repeat', '7777', 12000, 22000, 35000, 75000],
      ['+62 812-8800-8888', 'ID', 'Indonesia', '+62', 'Telkomsel', 'Lucky 8888', '8888', 15000, 28000, 45000, 95000],
      ['+62 815-4400-9999', 'ID', 'Indonesia', '+62', 'Indosat Ooredoo', 'Quad Repeat', '9999', 14000, 25000, 42000, 88000],
      ['+62 817-7000-1234', 'ID', 'Indonesia', '+62', 'XL Axiata', 'Sequential', '1234', 11000, 20000, 32000, 68000],
      ['+62 813-5500-1122', 'ID', 'Indonesia', '+62', 'Telkomsel', 'Double Pair', '1122', 9000, 17000, 28000, 58000],
      ['+62 856-9100-1212', 'ID', 'Indonesia', '+62', 'Indosat Ooredoo', 'Alternating', '1212', 9000, 17000, 28000, 58000],
      ['+1 (415) 890-7777', 'US', 'United States', '+1', 'AT&T Mobility', 'Quad Repeat', '7777', 16000, 29000, 48000, 98000],
      ['+1 (212) 770-8888', 'US', 'United States', '+1', 'T-Mobile US', 'Lucky 8888', '8888', 18000, 34000, 54000, 110000],
      ['+1 (646) 500-1234', 'US', 'United States', '+1', 'Verizon', 'Sequential', '1234', 15000, 27000, 44000, 90000],
      ['+1 (310) 400-1212', 'US', 'United States', '+1', 'T-Mobile US', 'Alternating', '1212', 13000, 24000, 39000, 79000],
      ['+44 7700 90-9999', 'GB', 'United Kingdom', '+44', 'Vodafone UK', 'Quad Repeat', '9999', 16000, 30000, 49000, 99000],
      ['+44 7700 90-1122', 'GB', 'United Kingdom', '+44', 'EE Mobile', 'Double Pair', '1122', 13000, 24000, 38000, 78000],
      ['+65 8100-8888', 'SG', 'Singapore', '+65', 'Singtel', 'Lucky 8888', '8888', 17000, 32000, 52000, 105000],
      ['+65 8200-7777', 'SG', 'Singapore', '+65', 'StarHub', 'Quad Repeat', '7777', 15000, 28000, 46000, 94000],
      ['+60 12-300-1234', 'MY', 'Malaysia', '+60', 'Maxis', 'Sequential', '1234', 10000, 19000, 31000, 64000],
      ['+60 19-800-9999', 'MY', 'Malaysia', '+60', 'CelcomDigi', 'Quad Repeat', '9999', 12000, 23000, 37000, 76000],
      ['+81 90-4000-7777', 'JP', 'Japan', '+81', 'NTT Docomo', 'Quad Repeat', '7777', 19000, 36000, 58000, 118000],
      ['+81 80-7000-1122', 'JP', 'Japan', '+81', 'SoftBank', 'Double Pair', '1122', 16000, 30000, 48000, 96000],
    ];

    for (const item of demoCatalog) {
      insertNum.run(
        crypto.randomUUID(),
        'prov-demo',
        item[0],
        item[1],
        item[2],
        item[3],
        item[4],
        item[5],
        item[6],
        item[7],
        item[8],
        item[9],
        item[10],
        now
      );
    }
  }

  const sixDigitCount = (
    db.prepare(`SELECT COUNT(*) as cnt FROM virtual_numbers WHERE pattern_category = '6 Digit Kembar'`).get() as {
      cnt: number;
    }
  ).cnt;

  if (sixDigitCount === 0) {
    const insertSixDigit = db.prepare(`
      INSERT OR IGNORE INTO virtual_numbers (
        id, provider_id, phone_number, country_code, country_name, dial_code, carrier,
        pattern_category, matched_pattern, price_10m, price_30m, price_1h, price_24h,
        status, is_demo, created_at
      ) VALUES (?, 'prov-demo', ?, ?, ?, ?, ?, '6 Digit Kembar', ?, ?, ?, ?, ?, 'Available', 1, ?)
    `);

    const sixDigitCatalog: Array<[string, string, string, string, string, string, number, number, number, number]> = [
      ['+62 811-88-888888', 'ID', 'Indonesia', '+62', 'Telkomsel', '888888', 25000, 45000, 75000, 160000],
      ['+62 812-77-777777', 'ID', 'Indonesia', '+62', 'Telkomsel', '777777', 24000, 42000, 70000, 150000],
      ['+62 815-99-999999', 'ID', 'Indonesia', '+62', 'Indosat Ooredoo', '999999', 23000, 40000, 68000, 145000],
      ['+62 817-66-666666', 'ID', 'Indonesia', '+62', 'XL Axiata', '666666', 21000, 38000, 64000, 135000],
      ['+62 813-11-111111', 'ID', 'Indonesia', '+62', 'Telkomsel', '111111', 22000, 39000, 65000, 140000],
      ['+62 856-00-000000', 'ID', 'Indonesia', '+62', 'Indosat Ooredoo', '000000', 22000, 39000, 65000, 140000],
      ['+1 (415) 77-777777', 'US', 'United States', '+1', 'AT&T Mobility', '777777', 28000, 52000, 86000, 180000],
      ['+1 (212) 88-888888', 'US', 'United States', '+1', 'T-Mobile US', '888888', 30000, 55000, 92000, 195000],
      ['+65 88-888888', 'SG', 'Singapore', '+65', 'Singtel', '888888', 29000, 54000, 88000, 185000],
      ['+60 12-999999', 'MY', 'Malaysia', '+60', 'Maxis', '999999', 22000, 40000, 66000, 138000],
      ['+44 77-777777', 'GB', 'United Kingdom', '+44', 'Vodafone UK', '777777', 27000, 49000, 82000, 172000],
      ['+81 90-888888', 'JP', 'Japan', '+81', 'NTT Docomo', '888888', 31000, 58000, 95000, 200000],
    ];

    for (const item of sixDigitCatalog) {
      insertSixDigit.run(
        crypto.randomUUID(),
        item[0],
        item[1],
        item[2],
        item[3],
        item[4],
        item[5],
        item[6],
        item[7],
        item[8],
        item[9],
        now
      );
    }
  }
}
