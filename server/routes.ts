import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { type AuthenticatedRequest, requireAdmin, requireAuth, signAuthToken } from './auth.ts';
import { encryptSecret, maskSecret } from './crypto.ts';
import { db } from './db.ts';
import {
  COUNTRY_METADATA,
  PATTERN_CATEGORIES,
  PRESET_PATTERNS,
  PROVIDER_KEY_SPEC,
  classifyPatternCategory,
  ensureDemoSandboxCustomMatch,
  extractOtpCode,
  fetchLiveInboundSms,
  getCredentialStatuses,
  hasConfiguredLiveProvider,
  provisionLiveNumber,
  releaseLiveNumber,
  searchLiveProviderNumbers,
  type ProviderMeta,
} from './providers.ts';
import { emitToAll, emitToUser } from './realtime.ts';

function getPriceForDuration(
  num: { price_10m: number; price_30m: number; price_1h: number; price_24h: number },
  durationMinutes: number
): number | null {
  switch (durationMinutes) {
    case 10:
      return num.price_10m;
    case 30:
      return num.price_30m;
    case 60:
      return num.price_1h;
    case 1440:
      return num.price_24h;
    default:
      return null;
  }
}

export function runExpirySweep() {
  const now = Date.now();
  const expiredRentals = db
    .prepare(`SELECT id, user_id, number_id, phone_number, provider_code, provider_sid, is_demo FROM rentals WHERE status = 'Active' AND expires_at <= ?`)
    .all(now) as Array<{
      id: string;
      user_id: string;
      number_id: string | null;
      phone_number: string;
      provider_code: string;
      provider_sid: string | null;
      is_demo: number;
    }>;

  if (expiredRentals.length > 0) {
    const updateRental = db.prepare(`UPDATE rentals SET status = 'Expired' WHERE id = ?`);
    const updateNum = db.prepare(
      `UPDATE virtual_numbers SET status = 'Expired', rented_by_user_id = NULL WHERE id = ?`
    );
    const purgeRentalSms = db.prepare(`DELETE FROM sms_messages WHERE rental_id = ?`);

    const tx = db.transaction(() => {
      for (const r of expiredRentals) {
        updateRental.run(r.id);
        if (r.number_id) {
          updateNum.run(r.number_id);
        }
        // Security & Privacy: Automatically purge OTPs once rental expires
        purgeRentalSms.run(r.id);
      }
    });
    tx();

    for (const r of expiredRentals) {
      if (r.is_demo === 0 && r.provider_sid) {
        const prov = db.prepare('SELECT * FROM providers WHERE code = ?').get(r.provider_code) as ProviderMeta | undefined;
        if (prov) {
          releaseLiveNumber({ provider: prov, providerSid: r.provider_sid }).catch(() => undefined);
        }
      }
      emitToUser(r.user_id, 'rental:expired', { rentalId: r.id, phoneNumber: r.phone_number });
    }
    emitToAll('stats:updated', { timestamp: now });
  }

  // Also purge any standalone expired OTP records whose TTL elapsed
  db.prepare(`DELETE FROM sms_messages WHERE expires_at <= ?`).run(now);
}

export function registerApiRoutes(app: Express) {
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'beauty-number-api', timestamp: Date.now() });
  });

  // ==========================================
  // AUTHENTICATION & ACCOUNT ROUTES
  // ==========================================
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (name.length < 2) {
      res.status(400).json({ error: 'Nama lengkap minimal 2 karakter.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Format email tidak valid.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      res.status(409).json({ error: 'Email sudah terdaftar. Silakan login.' });
      return;
    }

    const userId = crypto.randomUUID();
    const now = Date.now();
    const starterBonus = 50000; // Saldo awal uji coba sandbox Rp 50.000
    const hash = bcrypt.hashSync(password, 10);

    db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, name, email, password_hash, role, balance, created_at) VALUES (?, ?, ?, ?, 'user', ?, ?)`
      ).run(userId, name, email, hash, starterBonus, now);

      db.prepare(
        `INSERT INTO transactions (id, user_id, type, amount, payment_method, gateway_provider, gateway_ref, status, description, created_at)
         VALUES (?, ?, 'topup', ?, 'Sandbox Bonus', 'sandbox', ?, 'Completed', ?, ?)`
      ).run(
        crypto.randomUUID(),
        userId,
        starterBonus,
        `BN-WELCOME-${now.toString().slice(-6)}`,
        'Saldo sambutan akun baru (Sandbox)',
        now
      );
    })();

    const token = signAuthToken({ userId, email, role: 'user' });
    res.status(201).json({
      token,
      user: {
        id: userId,
        name,
        email,
        role: 'user',
        balance: starterBonus,
        createdAt: now,
      },
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const user = db
      .prepare('SELECT id, name, email, password_hash, role, balance, created_at FROM users WHERE email = ?')
      .get(email) as
      | {
          id: string;
          name: string;
          email: string;
          password_hash: string;
          role: 'user' | 'admin';
          balance: number;
          created_at: number;
        }
      | undefined;

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Email atau kata sandi salah.' });
      return;
    }

    const token = signAuthToken({ userId: user.id, email: user.email, role: user.role });
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        balance: user.balance,
        createdAt: user.created_at,
      },
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = db
      .prepare('SELECT id, name, email, role, balance, created_at FROM users WHERE id = ?')
      .get(req.user!.userId) as
      | { id: string; name: string; email: string; role: 'user' | 'admin'; balance: number; created_at: number }
      | undefined;

    if (!user) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        balance: user.balance,
        createdAt: user.created_at,
      },
    });
  });

  app.patch('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const name = String(req.body?.name || '').trim();
    if (name.length < 2) {
      res.status(400).json({ error: 'Nama minimal 2 karakter.' });
      return;
    }
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user!.userId);
    const updated = db
      .prepare('SELECT id, name, email, role, balance, created_at FROM users WHERE id = ?')
      .get(req.user!.userId) as { id: string; name: string; email: string; role: 'user' | 'admin'; balance: number; created_at: number };

    res.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        balance: updated.balance,
        createdAt: updated.created_at,
      },
    });
  });

  // ==========================================
  // DASHBOARD STATS & METADATA
  // ==========================================
  app.get('/api/dashboard/stats', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    runExpirySweep();
    const totalAvailable = (
      db.prepare(`SELECT COUNT(*) as cnt FROM virtual_numbers WHERE status = 'Available'`).get() as { cnt: number }
    ).cnt;
    const activeCount = (
      db.prepare(`SELECT COUNT(*) as cnt FROM rentals WHERE status = 'Active' AND user_id = ?`).get(req.user!.userId) as {
        cnt: number;
      }
    ).cnt;
    const expiredCount = (
      db
        .prepare(`SELECT COUNT(*) as cnt FROM rentals WHERE status IN ('Expired', 'Released') AND user_id = ?`)
        .get(req.user!.userId) as { cnt: number }
    ).cnt;
    const userHistoryCount = (
      db.prepare(`SELECT COUNT(*) as cnt FROM rentals WHERE user_id = ?`).get(req.user!.userId) as { cnt: number }
    ).cnt;

    const liveProvidersConfigured = hasConfiguredLiveProvider();

    res.json({
      totalAvailable,
      activeCount,
      expiredCount,
      userHistoryCount,
      hasLiveProviders: liveProvidersConfigured,
      modeLabel: liveProvidersConfigured ? 'LIVE API + DEMO' : 'DEMO SANDBOX',
    });
  });

  app.get('/api/numbers/meta', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    const providers = db
      .prepare('SELECT id, code, name, is_active, is_demo, supported_durations, description FROM providers WHERE is_active = 1')
      .all() as Array<{
      id: string;
      code: string;
      name: string;
      is_active: number;
      is_demo: number;
      supported_durations: string;
      description: string;
    }>;

    const formattedProviders = providers.map((p) => {
      const creds = getCredentialStatuses(p.id, p.code);
      const isConfigured = p.is_demo === 1 || (creds.length > 0 && creds.every((c) => c.configured));
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        isDemo: p.is_demo === 1,
        isConfigured,
        supportedDurations: JSON.parse(p.supported_durations) as number[],
        description: p.description,
      };
    });

    res.json({
      countries: COUNTRY_METADATA,
      categories: PATTERN_CATEGORIES,
      presetPatterns: PRESET_PATTERNS,
      durations: [
        { minutes: 10, label: '10 Menit', key: 'price_10m' },
        { minutes: 30, label: '30 Menit', key: 'price_30m' },
        { minutes: 60, label: '1 Jam', key: 'price_1h' },
        { minutes: 1440, label: '24 Jam', key: 'price_24h' },
      ],
      providers: formattedProviders,
    });
  });

  // ==========================================
  // NUMBER GENERATOR & RENTAL
  // ==========================================
  app.get('/api/numbers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    runExpirySweep();

    const countryCode = String(req.query.countryCode || '').trim().toUpperCase();
    const carrier = String(req.query.carrier || '').trim();
    const category = String(req.query.category || '').trim();
    const pattern = String(req.query.pattern || '').trim();
    const customPattern = String(req.query.customPattern || '').trim().replace(/\D/g, '');
    const providerCode = String(req.query.providerCode || '').trim();
    const statusFilter = String(req.query.status || 'Available').trim();

    const activePattern = customPattern || pattern;
    let liveApiWarning: string | null = null;

    // If user explicitly requests an official live provider (and credentials are configured), fetch real inventory
    if (providerCode && providerCode !== 'demo_sandbox' && providerCode !== 'all') {
      const provider = db
        .prepare('SELECT * FROM providers WHERE code = ? AND is_active = 1')
        .get(providerCode) as ProviderMeta | undefined;

      if (provider && provider.is_demo === 0) {
        const statuses = getCredentialStatuses(provider.id, provider.code);
        const ready = statuses.length > 0 && statuses.every((c) => c.configured);

        if (ready) {
          try {
            const liveNumbers = await searchLiveProviderNumbers({
              provider,
              countryCode: countryCode || 'US',
              pattern: activePattern,
            });
            const countryInfo = COUNTRY_METADATA.find((c) => c.code === (countryCode || 'US')) || COUNTRY_METADATA[1];
            const upsert = db.prepare(`
              INSERT INTO virtual_numbers (
                id, provider_id, phone_number, country_code, country_name, dial_code, carrier,
                pattern_category, matched_pattern, price_10m, price_30m, price_1h, price_24h,
                status, is_demo, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 20000, 35000, 55000, 120000, 'Available', 0, ?)
              ON CONFLICT(phone_number) DO UPDATE SET
                provider_id = excluded.provider_id,
                is_demo = 0
            `);
            for (const item of liveNumbers) {
              const tail = item.phoneNumber.replace(/\D/g, '').slice(-4);
              upsert.run(
                crypto.randomUUID(),
                provider.id,
                item.phoneNumber,
                countryInfo.code,
                countryInfo.name,
                countryInfo.dialCode,
                item.carrier,
                classifyPatternCategory(tail),
                activePattern || tail,
                Date.now()
              );
            }
          } catch (err) {
            liveApiWarning =
              err instanceof Error ? err.message : 'Gagal terhubung ke API provider resmi.';
          }
        } else {
          liveApiWarning = `Kredensial API untuk ${provider.name} belum dikonfigurasi. Menampilkan katalog mode DEMO.`;
        }
      }
    }

    // In Demo Sandbox mode, ensure Custom Pattern returns matching DEMO-labeled candidate
    if (customPattern.length >= 2 && statusFilter === 'Available') {
      ensureDemoSandboxCustomMatch({
        countryCode: !countryCode || countryCode === 'ALL' ? 'ID' : countryCode,
        carrier,
        customPattern,
      });
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (statusFilter && statusFilter !== 'All') {
      conditions.push('vn.status = ?');
      params.push(statusFilter);
    }
    if (countryCode && countryCode !== 'ALL') {
      conditions.push('vn.country_code = ?');
      params.push(countryCode);
    }
    if (carrier && carrier !== 'Semua Operator') {
      conditions.push('vn.carrier = ?');
      params.push(carrier);
    }
    if (category && category !== 'Semua Kategori' && category !== 'Custom Pattern') {
      conditions.push('vn.pattern_category = ?');
      params.push(category);
    }
    if (activePattern) {
      conditions.push(`replace(replace(replace(replace(vn.phone_number, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?`);
      params.push(`%${activePattern}%`);
    }
    if (providerCode && providerCode !== 'all') {
      if (providerCode === 'demo_sandbox') {
        conditions.push('vn.is_demo = 1');
      } else if (!liveApiWarning) {
        conditions.push('p.code = ?');
        params.push(providerCode);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT vn.*, p.name as provider_name, p.code as provider_code, p.supported_durations
         FROM virtual_numbers vn
         JOIN providers p ON vn.provider_id = p.id
         ${whereClause}
         ORDER BY vn.is_demo ASC, vn.created_at DESC
         LIMIT 60`
      )
      .all(...params) as Array<Record<string, unknown>>;

    res.json({
      numbers: rows.map((r) => ({
        id: r.id,
        phoneNumber: r.phone_number,
        countryCode: r.country_code,
        countryName: r.country_name,
        dialCode: r.dial_code,
        carrier: r.carrier,
        patternCategory: r.pattern_category,
        matchedPattern: r.matched_pattern,
        price10m: r.price_10m,
        price30m: r.price_30m,
        price1h: r.price_1h,
        price24h: r.price_24h,
        status: r.status,
        isDemo: r.is_demo === 1,
        providerName: r.provider_name,
        providerCode: r.provider_code,
        supportedDurations: JSON.parse(String(r.supported_durations || '[10,30,60,1440]')),
        expiresAt: r.expires_at,
      })),
      warning: liveApiWarning,
    });
  });

  app.post('/api/numbers/generate-six-digit', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const rawCountry = String(req.body?.countryCode || 'ID').trim().toUpperCase();
    const country = COUNTRY_METADATA.find((c) => c.code === rawCountry) || COUNTRY_METADATA[0];
    const requestedCarrier = String(req.body?.carrier || '').trim();
    const chosenCarrier =
      requestedCarrier && requestedCarrier !== 'Semua Operator' ? requestedCarrier : country.carriers[0];

    const rawDigit = String(req.body?.digit ?? '').replace(/\D/g, '');
    const digit = rawDigit.length >= 1 ? rawDigit[0] : String(Math.floor(Math.random() * 10));
    const sixTwinPattern = digit.repeat(6);

    const prefixDigits =
      country.code === 'ID'
        ? `81${Math.floor(1 + Math.random() * 8)}-${Math.floor(10 + Math.random() * 89)}`
        : country.code === 'US'
          ? `(415) ${Math.floor(10 + Math.random() * 89)}`
          : `${Math.floor(71 + Math.random() * 28)}`;

    const phoneNumber = `${country.dialCode} ${prefixDigits}-${sixTwinPattern}`;
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(
      `INSERT OR IGNORE INTO virtual_numbers (
        id, provider_id, phone_number, country_code, country_name, dial_code, carrier,
        pattern_category, matched_pattern, price_10m, price_30m, price_1h, price_24h,
        status, is_demo, created_at
      ) VALUES (?, 'prov-demo', ?, ?, ?, ?, ?, '6 Digit Kembar', ?, 22000, 40000, 68000, 145000, 'Available', 1, ?)`
    ).run(id, phoneNumber, country.code, country.name, country.dialCode, chosenCarrier, sixTwinPattern, now);

    emitToAll('stats:updated', { timestamp: now });
    res.status(201).json({
      pattern: sixTwinPattern,
      phoneNumber,
      isDemo: true,
    });
  });

  app.post('/api/numbers/rent', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    runExpirySweep();

    const numberId = String(req.body?.numberId || '');
    const durationMinutes = Number(req.body?.durationMinutes || 0);
    const acceptedTerms = Boolean(req.body?.acceptedTerms);

    if (!acceptedTerms) {
      res.status(400).json({
        error: 'Anda harus menyetujui Kebijakan Penggunaan Sah sebelum menyewa nomor.',
      });
      return;
    }

    if (![10, 30, 60, 1440].includes(durationMinutes)) {
      res.status(400).json({ error: 'Durasi sewa tidak valid (pilih 10 menit, 30 menit, 1 jam, atau 24 jam).' });
      return;
    }

    const numRow = db
      .prepare(
        `SELECT vn.*, p.code as provider_code, p.name as provider_name, p.api_base_url, p.is_demo as prov_is_demo, p.supported_durations
         FROM virtual_numbers vn
         JOIN providers p ON vn.provider_id = p.id
         WHERE vn.id = ?`
      )
      .get(numberId) as
      | {
          id: string;
          provider_id: string;
          phone_number: string;
          country_code: string;
          country_name: string;
          carrier: string;
          pattern_category: string;
          matched_pattern: string;
          price_10m: number;
          price_30m: number;
          price_1h: number;
          price_24h: number;
          status: string;
          is_demo: number;
          provider_code: string;
          provider_name: string;
          api_base_url: string;
          supported_durations: string;
        }
      | undefined;

    if (!numRow) {
      res.status(404).json({ error: 'Nomor virtual tidak ditemukan.' });
      return;
    }
    if (numRow.status !== 'Available') {
      res.status(409).json({ error: 'Nomor ini sedang digunakan atau sudah kedaluwarsa.' });
      return;
    }

    const supported = JSON.parse(numRow.supported_durations) as number[];
    if (!supported.includes(durationMinutes)) {
      res.status(400).json({ error: 'Durasi yang dipilih tidak didukung oleh provider ini.' });
      return;
    }

    const price = getPriceForDuration(numRow, durationMinutes);
    if (price === null) {
      res.status(400).json({ error: 'Tarif sewa tidak tersedia.' });
      return;
    }

    const userRow = db.prepare('SELECT id, balance FROM users WHERE id = ?').get(req.user!.userId) as
      | { id: string; balance: number }
      | undefined;

    if (!userRow || userRow.balance < price) {
      res.status(402).json({ error: 'Saldo tidak mencukupi. Silakan lakukan top up saldo terlebih dahulu.' });
      return;
    }

    // If live official provider number, provision via official REST API first!
    let providerSid: string | null = null;
    if (numRow.is_demo === 0) {
      const providerMeta = db.prepare('SELECT * FROM providers WHERE id = ?').get(numRow.provider_id) as ProviderMeta;
      try {
        const provisioned = await provisionLiveNumber({
          provider: providerMeta,
          phoneNumber: numRow.phone_number,
        });
        providerSid = provisioned.providerSid;
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : 'Gagal mengaktifkan nomor pada API provider resmi.',
        });
        return;
      }
    } else {
      providerSid = `demo-sid-${crypto.randomUUID().slice(0, 8)}`;
    }

    const now = Date.now();
    const expiresAt = now + durationMinutes * 60 * 1000;
    const rentalId = crypto.randomUUID();
    const txId = crypto.randomUUID();

    try {
      db.transaction(() => {
        const updateRes = db
          .prepare(
            `UPDATE virtual_numbers
             SET status = 'Active', rented_by_user_id = ?, rented_at = ?, expires_at = ?, provider_sid = ?
             WHERE id = ? AND status = 'Available'`
          )
          .run(req.user!.userId, now, expiresAt, providerSid, numRow.id);

        if (updateRes.changes === 0) {
          throw new Error('CONFLICT');
        }

        const balRes = db
          .prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?')
          .run(price, req.user!.userId, price);

        if (balRes.changes === 0) {
          throw new Error('INSUFFICIENT_BALANCE');
        }

        db.prepare(
          `INSERT INTO rentals (
            id, user_id, number_id, phone_number, country_code, country_name, carrier,
            provider_name, provider_code, provider_sid, pattern_category, matched_pattern,
            is_demo, duration_minutes, price_paid, status, started_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`
        ).run(
          rentalId,
          req.user!.userId,
          numRow.id,
          numRow.phone_number,
          numRow.country_code,
          numRow.country_name,
          numRow.carrier,
          numRow.provider_name,
          numRow.provider_code,
          providerSid,
          numRow.pattern_category,
          numRow.matched_pattern,
          numRow.is_demo,
          durationMinutes,
          price,
          now,
          expiresAt
        );

        const durationLabel =
          durationMinutes >= 60 ? `${durationMinutes / 60} jam` : `${durationMinutes} menit`;
        db.prepare(
          `INSERT INTO transactions (id, user_id, type, amount, payment_method, gateway_provider, gateway_ref, status, description, created_at)
           VALUES (?, ?, 'rental', ?, 'Balance', 'internal', ?, 'Completed', ?, ?)`
        ).run(
          txId,
          req.user!.userId,
          price,
          `BN-RENT-${rentalId.slice(0, 8).toUpperCase()}`,
          `Sewa nomor ${numRow.is_demo === 1 ? 'DEMO ' : ''}${numRow.phone_number} (${durationLabel})`,
          now
        );
      })();
    } catch (err) {
      if (err instanceof Error && err.message === 'CONFLICT') {
        res.status(409).json({ error: 'Nomor baru saja disewa pengguna lain.' });
        return;
      }
      if (err instanceof Error && err.message === 'INSUFFICIENT_BALANCE') {
        res.status(402).json({ error: 'Saldo tidak mencukupi.' });
        return;
      }
      throw err;
    }

    const updatedUser = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user!.userId) as { balance: number };
    const rental = db.prepare('SELECT * FROM rentals WHERE id = ?').get(rentalId);

    emitToUser(req.user!.userId, 'balance:updated', { balance: updatedUser.balance });
    emitToAll('stats:updated', { timestamp: now });

    res.status(201).json({
      rental,
      balance: updatedUser.balance,
    });
  });

  app.get('/api/rentals', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    runExpirySweep();
    const rows = db
      .prepare('SELECT * FROM rentals WHERE user_id = ? ORDER BY started_at DESC LIMIT 50')
      .all(req.user!.userId) as Array<Record<string, unknown>>;

    res.json({
      rentals: rows.map((r) => ({
        id: r.id,
        numberId: r.number_id,
        phoneNumber: r.phone_number,
        countryCode: r.country_code,
        countryName: r.country_name,
        carrier: r.carrier,
        providerName: r.provider_name,
        providerCode: r.provider_code,
        patternCategory: r.pattern_category,
        matchedPattern: r.matched_pattern,
        isDemo: r.is_demo === 1,
        durationMinutes: r.duration_minutes,
        pricePaid: r.price_paid,
        status: r.status,
        startedAt: r.started_at,
        expiresAt: r.expires_at,
      })),
    });
  });

  app.post('/api/rentals/:id/release', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const rental = db
      .prepare('SELECT * FROM rentals WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user!.userId) as
      | {
          id: string;
          number_id: string | null;
          provider_code: string;
          provider_sid: string | null;
          is_demo: number;
          status: string;
        }
      | undefined;

    if (!rental) {
      res.status(404).json({ error: 'Data sewa tidak ditemukan.' });
      return;
    }
    if (rental.status !== 'Active') {
      res.status(400).json({ error: 'Masa sewa nomor sudah berakhir.' });
      return;
    }

    if (rental.is_demo === 0 && rental.provider_sid) {
      const prov = db.prepare('SELECT * FROM providers WHERE code = ?').get(rental.provider_code) as ProviderMeta | undefined;
      if (prov) {
        await releaseLiveNumber({ provider: prov, providerSid: rental.provider_sid });
      }
    }

    db.transaction(() => {
      db.prepare(`UPDATE rentals SET status = 'Expired', expires_at = ? WHERE id = ?`).run(Date.now(), rental.id);
      if (rental.number_id) {
        db.prepare(`UPDATE virtual_numbers SET status = 'Expired', rented_by_user_id = NULL WHERE id = ?`).run(
          rental.number_id
        );
      }
      // Immediately purge OTP messages upon release
      db.prepare('DELETE FROM sms_messages WHERE rental_id = ?').run(rental.id);
    })();

    emitToAll('stats:updated', { timestamp: Date.now() });
    res.json({ ok: true, message: 'Nomor dihentikan dan data OTP telah dihapus dari server.' });
  });

  // ==========================================
  // SMS & OTP INBOX (WITH STRICT PRIVACY & TTL)
  // ==========================================
  app.get('/api/rentals/:id/sms', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    runExpirySweep();

    const rental = db
      .prepare('SELECT id, number_id, phone_number, provider_code, started_at, status, expires_at, is_demo FROM rentals WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user!.userId) as
      | {
          id: string;
          number_id: string | null;
          phone_number: string;
          provider_code: string;
          started_at: number;
          status: string;
          expires_at: number;
          is_demo: number;
        }
      | undefined;

    if (!rental) {
      res.status(404).json({ error: 'Sewa nomor tidak ditemukan.' });
      return;
    }

    if (rental.status !== 'Active') {
      res.json({ messages: [], expired: true });
      return;
    }

    if (rental.is_demo === 0) {
      const prov = db.prepare('SELECT * FROM providers WHERE code = ?').get(rental.provider_code) as
        | ProviderMeta
        | undefined;
      if (prov) {
        const liveMsgs = await fetchLiveInboundSms({
          provider: prov,
          phoneNumber: rental.phone_number,
          sinceMs: rental.started_at,
        });
        for (const lm of liveMsgs) {
          const exists = db
            .prepare('SELECT id FROM sms_messages WHERE rental_id = ? AND sender = ? AND body = ? AND received_at = ?')
            .get(rental.id, lm.sender, lm.body, lm.receivedAt);
          if (!exists) {
            const msgExpiresAt = Math.min(rental.expires_at, lm.receivedAt + 5 * 60 * 1000);
            if (msgExpiresAt > Date.now()) {
              db.prepare(
                `INSERT INTO sms_messages (id, rental_id, number_id, sender, body, otp_code, received_at, expires_at, is_demo)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
              ).run(
                crypto.randomUUID(),
                rental.id,
                rental.number_id,
                lm.sender,
                lm.body,
                extractOtpCode(lm.body),
                lm.receivedAt,
                msgExpiresAt
              );
            }
          }
        }
      }
    }

    const messages = db
      .prepare(
        'SELECT id, sender, body, otp_code, received_at, expires_at, is_demo FROM sms_messages WHERE rental_id = ? ORDER BY received_at DESC'
      )
      .all(rental.id) as Array<Record<string, unknown>>;

    res.json({
      messages: messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        body: m.body,
        otpCode: m.otp_code,
        receivedAt: m.received_at,
        expiresAt: m.expires_at,
        isDemo: m.is_demo === 1,
      })),
      expired: false,
    });
  });

  app.delete('/api/rentals/:id/sms/:smsId', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const rental = db
      .prepare('SELECT id FROM rentals WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user!.userId);
    if (!rental) {
      res.status(404).json({ error: 'Sewa tidak ditemukan.' });
      return;
    }
    db.prepare('DELETE FROM sms_messages WHERE id = ? AND rental_id = ?').run(req.params.smsId, req.params.id);
    res.json({ ok: true });
  });

  // Demo Sandbox SMS tester: ONLY works for is_demo = 1 active rentals!
  app.post('/api/rentals/:id/demo-sms', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    runExpirySweep();

    const rental = db
      .prepare('SELECT * FROM rentals WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user!.userId) as
      | {
          id: string;
          user_id: string;
          number_id: string | null;
          phone_number: string;
          status: string;
          expires_at: number;
          is_demo: number;
        }
      | undefined;

    if (!rental) {
      res.status(404).json({ error: 'Sewa nomor tidak ditemukan.' });
      return;
    }
    if (rental.is_demo !== 1) {
      res.status(403).json({
        error: 'Simulasi SMS hanya tersedia untuk nomor mode DEMO. Nomor API resmi menerima SMS melalui webhook operator.',
      });
      return;
    }
    if (rental.status !== 'Active') {
      res.status(400).json({ error: 'Nomor sudah kedaluwarsa. Sewa nomor aktif untuk menerima SMS.' });
      return;
    }

    const sender = String(req.body?.sender || 'BEAUTY-SANDBOX').trim().slice(0, 32) || 'BEAUTY-SANDBOX';
    const rawCustomCode = String(req.body?.customCode || '').replace(/\D/g, '').slice(0, 8);
    const code = rawCustomCode.length >= 4 ? rawCustomCode : String(Math.floor(100000 + Math.random() * 899999));
    const now = Date.now();
    // OTP TTL capped at 5 minutes OR rental expiry, whichever comes first
    const msgExpiresAt = Math.min(rental.expires_at, now + 5 * 60 * 1000);
    const body = `[DEMO] Kode verifikasi uji coba (${sender}) untuk ${rental.phone_number} adalah ${code}. Berlaku 5 menit.`;
    const msgId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO sms_messages (id, rental_id, number_id, sender, body, otp_code, received_at, expires_at, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(msgId, rental.id, rental.number_id, sender, body, code, now, msgExpiresAt);

    const payload = {
      id: msgId,
      rentalId: rental.id,
      sender,
      body,
      otpCode: code,
      receivedAt: now,
      expiresAt: msgExpiresAt,
      isDemo: true,
    };

    emitToUser(rental.user_id, 'sms:received', payload);
    res.status(201).json({ message: payload });
  });

  // Official Provider Webhook for real-time inbound SMS (Twilio / Vonage / Telnyx)
  app.post('/api/webhooks/sms/:providerCode', (req: Request, res: Response) => {
    const providerCode = String(req.params.providerCode || '').toLowerCase();
    const toNumber = String(req.body?.To || req.body?.to || req.body?.msisdn || '').trim();
    const fromSender = String(req.body?.From || req.body?.from || 'CarrierSMS').trim();
    const textBody = String(req.body?.Body || req.body?.text || '').trim();

    if (!toNumber || !textBody) {
      res.status(400).json({ error: 'Payload webhook SMS tidak lengkap.' });
      return;
    }

    const normalizedTo = toNumber.replace(/[^\d+]/g, '');
    const activeRentals = db
      .prepare(`SELECT * FROM rentals WHERE status = 'Active' AND is_demo = 0 AND provider_code = ?`)
      .all(providerCode) as Array<{
      id: string;
      user_id: string;
      number_id: string | null;
      phone_number: string;
      expires_at: number;
    }>;

    const match = activeRentals.find((r) => r.phone_number.replace(/[^\d+]/g, '') === normalizedTo);
    if (!match) {
      res.status(200).json({ ignored: true, reason: 'No active rental matched' });
      return;
    }

    const now = Date.now();
    const msgExpiresAt = Math.min(match.expires_at, now + 5 * 60 * 1000);
    const otpCode = extractOtpCode(textBody);
    const msgId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO sms_messages (id, rental_id, number_id, sender, body, otp_code, received_at, expires_at, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(msgId, match.id, match.number_id, fromSender, textBody, otpCode, now, msgExpiresAt);

    emitToUser(match.user_id, 'sms:received', {
      id: msgId,
      rentalId: match.id,
      sender: fromSender,
      body: textBody,
      otpCode,
      receivedAt: now,
      expiresAt: msgExpiresAt,
      isDemo: false,
    });

    res.status(200).json({ received: true, id: msgId });
  });

  // ==========================================
  // PAYMENTS & TRANSACTIONS
  // ==========================================
  app.get('/api/transactions', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.user!.userId) as Array<Record<string, unknown>>;

    res.json({
      transactions: rows.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        paymentMethod: t.payment_method,
        gatewayProvider: t.gateway_provider,
        gatewayRef: t.gateway_ref,
        status: t.status,
        description: t.description,
        createdAt: t.created_at,
      })),
    });
  });

  app.post('/api/payments/topup', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const amount = Number(req.body?.amount || 0);
    const paymentMethod = String(req.body?.paymentMethod || 'QRIS').trim();

    if (!Number.isFinite(amount) || amount < 10000 || amount > 10000000) {
      res.status(400).json({ error: 'Nominal top up minimal Rp 10.000 dan maksimal Rp 10.000.000.' });
      return;
    }

    const allowedMethods = ['QRIS', 'Virtual Account', 'E-Wallet', 'Card'];
    if (!allowedMethods.includes(paymentMethod)) {
      res.status(400).json({ error: 'Metode pembayaran tidak valid.' });
      return;
    }

    const gatewayProvider = process.env.PAYMENT_GATEWAY_PROVIDER || 'sandbox';
    const now = Date.now();
    const txId = crypto.randomUUID();
    const gatewayRef = `BN-${paymentMethod.replace(/\s+/g, '').toUpperCase().slice(0, 4)}-${now.toString().slice(-6)}`;
    const isSandbox = gatewayProvider === 'sandbox' || !process.env.PAYMENT_GATEWAY_SERVER_KEY;

    // In Sandbox mode, credit immediately so user can test full flow; if real gateway is configured, create Pending intent
    const status = isSandbox ? 'Completed' : 'Pending';

    db.transaction(() => {
      db.prepare(
        `INSERT INTO transactions (id, user_id, type, amount, payment_method, gateway_provider, gateway_ref, status, description, created_at)
         VALUES (?, ?, 'topup', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        txId,
        req.user!.userId,
        Math.round(amount),
        paymentMethod,
        gatewayProvider,
        gatewayRef,
        status,
        `Top up saldo via ${paymentMethod}${isSandbox ? ' (Sandbox)' : ''}`,
        now
      );

      if (isSandbox) {
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(Math.round(amount), req.user!.userId);
      }
    })();

    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user!.userId) as { balance: number };
    emitToUser(req.user!.userId, 'balance:updated', { balance: user.balance });

    res.status(201).json({
      transaction: {
        id: txId,
        type: 'topup',
        amount: Math.round(amount),
        paymentMethod,
        gatewayProvider,
        gatewayRef,
        status,
        createdAt: now,
      },
      balance: user.balance,
      sandboxMode: isSandbox,
    });
  });

  app.post('/api/payments/webhook', (req: Request, res: Response) => {
    const secret = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET;
    if (secret) {
      const signature = String(req.headers['x-gateway-signature'] || '');
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (signature !== expected) {
        res.status(401).json({ error: 'Signature webhook pembayaran tidak valid.' });
        return;
      }
    }

    const gatewayRef = String(req.body?.gatewayRef || '');
    const newStatus = String(req.body?.status || 'Completed');
    if (!gatewayRef) {
      res.status(400).json({ error: 'gatewayRef wajib diisi.' });
      return;
    }

    const txRow = db.prepare('SELECT * FROM transactions WHERE gateway_ref = ?').get(gatewayRef) as
      | { id: string; user_id: string; amount: number; status: string; type: string }
      | undefined;

    if (!txRow) {
      res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
      return;
    }

    if (txRow.status === 'Pending' && newStatus === 'Completed' && txRow.type === 'topup') {
      db.transaction(() => {
        db.prepare(`UPDATE transactions SET status = 'Completed' WHERE id = ?`).run(txRow.id);
        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(txRow.amount, txRow.user_id);
      })();
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(txRow.user_id) as { balance: number };
      emitToUser(txRow.user_id, 'balance:updated', { balance: user.balance });
    } else if (txRow.status === 'Pending' && newStatus === 'Failed') {
      db.prepare(`UPDATE transactions SET status = 'Failed' WHERE id = ?`).run(txRow.id);
    }

    res.json({ ok: true });
  });

  // ==========================================
  // ADMIN DASHBOARD ROUTES
  // ==========================================
  app.get('/api/admin/overview', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    runExpirySweep();
    const totalUsers = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
    const totalNumbers = (db.prepare('SELECT COUNT(*) as cnt FROM virtual_numbers').get() as { cnt: number }).cnt;
    const availableNumbers = (
      db.prepare(`SELECT COUNT(*) as cnt FROM virtual_numbers WHERE status = 'Available'`).get() as { cnt: number }
    ).cnt;
    const activeRentals = (
      db.prepare(`SELECT COUNT(*) as cnt FROM rentals WHERE status = 'Active'`).get() as { cnt: number }
    ).cnt;
    const expiredRentals = (
      db.prepare(`SELECT COUNT(*) as cnt FROM rentals WHERE status IN ('Expired', 'Released')`).get() as { cnt: number }
    ).cnt;
    const totalRevenue = (
      db
        .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'rental' AND status = 'Completed'`)
        .get() as { total: number }
    ).total;
    const totalTopups = (
      db
        .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'topup' AND status = 'Completed'`)
        .get() as { total: number }
    ).total;

    const categoryBreakdown = db
      .prepare(
        `SELECT pattern_category as category, COUNT(*) as count FROM virtual_numbers GROUP BY pattern_category ORDER BY count DESC`
      )
      .all() as Array<{ category: string; count: number }>;

    res.json({
      totalUsers,
      totalNumbers,
      availableNumbers,
      activeRentals,
      expiredRentals,
      totalRevenue,
      totalTopups,
      categoryBreakdown,
    });
  });

  app.get('/api/admin/users', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const users = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.balance, u.created_at,
                (SELECT COUNT(*) FROM rentals r WHERE r.user_id = u.id) as rental_count
         FROM users u ORDER BY u.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        balance: u.balance,
        rentalCount: u.rental_count,
        createdAt: u.created_at,
      })),
    });
  });

  app.patch('/api/admin/users/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const role = req.body?.role;
    const addBalance = Number(req.body?.addBalance || 0);

    if (role && !['user', 'admin'].includes(role)) {
      res.status(400).json({ error: 'Role tidak valid.' });
      return;
    }

    const target = db.prepare('SELECT id, role, balance FROM users WHERE id = ?').get(req.params.id) as
      | { id: string; role: string; balance: number }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }

    if (role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
    }
    if (Number.isFinite(addBalance) && addBalance !== 0) {
      const rounded = Math.round(addBalance);
      db.transaction(() => {
        db.prepare('UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?').run(rounded, target.id);
        db.prepare(
          `INSERT INTO transactions (id, user_id, type, amount, payment_method, gateway_provider, gateway_ref, status, description, created_at)
           VALUES (?, ?, 'topup', ?, 'Admin Adjustment', 'internal', ?, 'Completed', ?, ?)`
        ).run(
          crypto.randomUUID(),
          target.id,
          Math.abs(rounded),
          `BN-ADM-${Date.now().toString().slice(-6)}`,
          rounded >= 0 ? 'Penyesuaian saldo oleh Admin' : 'Pengurangan saldo oleh Admin',
          Date.now()
        );
      })();
      const updated = db.prepare('SELECT balance FROM users WHERE id = ?').get(target.id) as { balance: number };
      emitToUser(target.id, 'balance:updated', { balance: updated.balance });
    }

    res.json({ ok: true });
  });

  app.get('/api/admin/providers', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const providers = db.prepare('SELECT * FROM providers ORDER BY is_demo ASC, name ASC').all() as ProviderMeta[];
    res.json({
      providers: providers.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        apiBaseUrl: p.api_base_url,
        isActive: p.is_active === 1,
        isDemo: p.is_demo === 1,
        supportedDurations: JSON.parse(p.supported_durations) as number[],
        description: p.description,
        updatedAt: p.updated_at,
        credentials: getCredentialStatuses(p.id, p.code),
      })),
    });
  });

  app.put('/api/admin/providers/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id) as ProviderMeta | undefined;
    if (!provider) {
      res.status(404).json({ error: 'Provider tidak ditemukan.' });
      return;
    }

    const isActive = typeof req.body?.isActive === 'boolean' ? (req.body.isActive ? 1 : 0) : provider.is_active;
    const apiBaseUrl = String(req.body?.apiBaseUrl || provider.api_base_url).trim();
    const credentials = (req.body?.credentials || {}) as Record<string, string>;
    const allowedKeys = PROVIDER_KEY_SPEC[provider.code] || [];
    const now = Date.now();

    db.transaction(() => {
      db.prepare('UPDATE providers SET is_active = ?, api_base_url = ?, updated_at = ? WHERE id = ?').run(
        isActive,
        apiBaseUrl,
        now,
        provider.id
      );

      for (const keyName of allowedKeys) {
        const rawVal = credentials[keyName];
        if (typeof rawVal === 'string' && rawVal.trim().length > 0) {
          const cleanVal = rawVal.trim();
          const encrypted = encryptSecret(cleanVal);
          const masked = maskSecret(cleanVal);
          db.prepare(
            `INSERT INTO provider_credentials (id, provider_id, key_name, encrypted_value, masked_preview, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(provider_id, key_name) DO UPDATE SET
               encrypted_value = excluded.encrypted_value,
               masked_preview = excluded.masked_preview,
               updated_at = excluded.updated_at`
          ).run(crypto.randomUUID(), provider.id, keyName, encrypted, masked, now);
        }
      }
    })();

    res.json({ ok: true, message: `Konfigurasi ${provider.name} berhasil disimpan secara terenkripsi.` });
  });

  app.get('/api/admin/numbers', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    runExpirySweep();
    const rows = db
      .prepare(
        `SELECT vn.*, p.name as provider_name, p.code as provider_code
         FROM virtual_numbers vn
         JOIN providers p ON vn.provider_id = p.id
         ORDER BY vn.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      numbers: rows.map((r) => ({
        id: r.id,
        phoneNumber: r.phone_number,
        countryCode: r.country_code,
        countryName: r.country_name,
        dialCode: r.dial_code,
        carrier: r.carrier,
        patternCategory: r.pattern_category,
        matchedPattern: r.matched_pattern,
        price10m: r.price_10m,
        price30m: r.price_30m,
        price1h: r.price_1h,
        price24h: r.price_24h,
        status: r.status,
        isDemo: r.is_demo === 1,
        providerName: r.provider_name,
        providerCode: r.provider_code,
        createdAt: r.created_at,
      })),
    });
  });

  app.post('/api/admin/numbers', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const phoneNumber = String(req.body?.phoneNumber || '').trim();
    const countryCode = String(req.body?.countryCode || 'ID').toUpperCase();
    const carrier = String(req.body?.carrier || 'Telkomsel').trim();
    const matchedPattern = String(req.body?.matchedPattern || '').trim();
    const price10m = Number(req.body?.price10m || 12000);
    const price30m = Number(req.body?.price30m || 22000);
    const price1h = Number(req.body?.price1h || 35000);
    const price24h = Number(req.body?.price24h || 75000);

    if (phoneNumber.length < 8) {
      res.status(400).json({ error: 'Format nomor telepon tidak valid.' });
      return;
    }

    const country = COUNTRY_METADATA.find((c) => c.code === countryCode) || COUNTRY_METADATA[0];
    const cleanDigits = matchedPattern || phoneNumber.replace(/\D/g, '').slice(-4);
    const category = String(req.body?.patternCategory || classifyPatternCategory(cleanDigits));

    try {
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO virtual_numbers (
          id, provider_id, phone_number, country_code, country_name, dial_code, carrier,
          pattern_category, matched_pattern, price_10m, price_30m, price_1h, price_24h,
          status, is_demo, created_at
        ) VALUES (?, 'prov-demo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Available', 1, ?)`
      ).run(
        id,
        phoneNumber,
        country.code,
        country.name,
        country.dialCode,
        carrier,
        category,
        cleanDigits,
        Math.max(1000, Math.round(price10m)),
        Math.max(1000, Math.round(price30m)),
        Math.max(1000, Math.round(price1h)),
        Math.max(1000, Math.round(price24h)),
        Date.now()
      );
      emitToAll('stats:updated', { timestamp: Date.now() });
      res.status(201).json({ ok: true, id });
    } catch {
      res.status(409).json({ error: 'Nomor tersebut sudah terdaftar di katalog.' });
    }
  });

  app.patch('/api/admin/numbers/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const existing = db.prepare('SELECT * FROM virtual_numbers WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Nomor tidak ditemukan.' });
      return;
    }

    const price10m = Number(req.body?.price10m ?? existing.price_10m);
    const price30m = Number(req.body?.price30m ?? existing.price_30m);
    const price1h = Number(req.body?.price1h ?? existing.price_1h);
    const price24h = Number(req.body?.price24h ?? existing.price_24h);
    const status = String(req.body?.status ?? existing.status);

    if (!['Available', 'Active', 'Expired'].includes(status)) {
      res.status(400).json({ error: 'Status nomor tidak valid.' });
      return;
    }

    db.prepare(
      `UPDATE virtual_numbers SET price_10m = ?, price_30m = ?, price_1h = ?, price_24h = ?, status = ? WHERE id = ?`
    ).run(
      Math.max(1000, Math.round(price10m)),
      Math.max(1000, Math.round(price30m)),
      Math.max(1000, Math.round(price1h)),
      Math.max(1000, Math.round(price24h)),
      status,
      req.params.id
    );

    emitToAll('stats:updated', { timestamp: Date.now() });
    res.json({ ok: true });
  });

  app.delete('/api/admin/numbers/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    db.prepare('DELETE FROM virtual_numbers WHERE id = ?').run(req.params.id);
    emitToAll('stats:updated', { timestamp: Date.now() });
    res.json({ ok: true });
  });

  app.get('/api/admin/transactions', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT t.*, u.name as user_name, u.email as user_email
         FROM transactions t
         JOIN users u ON t.user_id = u.id
         ORDER BY t.created_at DESC
         LIMIT 100`
      )
      .all() as Array<Record<string, unknown>>;

    res.json({
      transactions: rows.map((t) => ({
        id: t.id,
        userName: t.user_name,
        userEmail: t.user_email,
        type: t.type,
        amount: t.amount,
        paymentMethod: t.payment_method,
        gatewayProvider: t.gateway_provider,
        gatewayRef: t.gateway_ref,
        status: t.status,
        description: t.description,
        createdAt: t.created_at,
      })),
    });
  });
}
