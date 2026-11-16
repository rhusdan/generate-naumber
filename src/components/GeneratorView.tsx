import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Globe,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { apiRequest, formatIDR } from '../lib/api';
import type { NumbersMetaResponse, VirtualNumber } from '../types';

interface GeneratorViewProps {
  userBalance: number;
  initialCategory?: string;
  onRented: (rentalId: string, newBalance: number) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

export function GeneratorView({ userBalance, initialCategory, onRented, onNotify }: GeneratorViewProps) {
  const [meta, setMeta] = useState<NumbersMetaResponse | null>(null);
  const [countryCode, setCountryCode] = useState('ALL');
  const [carrier, setCarrier] = useState('Semua Operator');
  const [providerCode, setProviderCode] = useState('all');
  const [category, setCategory] = useState(initialCategory || 'Semua Kategori');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [customPattern, setCustomPattern] = useState('');
  const [generatingSixDigit, setGeneratingSixDigit] = useState(false);

  const [numbers, setNumbers] = useState<VirtualNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Rental checkout modal state
  const [checkoutNumber, setCheckoutNumber] = useState<VirtualNumber | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number>(30);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [renting, setRenting] = useState(false);

  useEffect(() => {
    apiRequest<NumbersMetaResponse>('/api/numbers/meta')
      .then((res) => setMeta(res))
      .catch(() => undefined);
  }, []);

  const fetchNumbers = async (overrides?: {
    country?: string;
    op?: string;
    cat?: string;
    preset?: string;
    custom?: string;
    prov?: string;
  }) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({
        countryCode: overrides?.country ?? countryCode,
        carrier: overrides?.op ?? carrier,
        category: overrides?.cat ?? category,
        pattern: overrides?.preset ?? selectedPreset,
        customPattern: overrides?.custom ?? customPattern,
        providerCode: overrides?.prov ?? providerCode,
        status: 'Available',
      });
      const res = await apiRequest<{ numbers: VirtualNumber[]; warning: string | null }>(
        `/api/numbers?${params.toString()}`
      );
      setNumbers(res.numbers);
      setWarning(res.warning);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat daftar nomor.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const startCat = initialCategory || 'Semua Kategori';
    setCategory(startCat);
    fetchNumbers({ cat: startCat });
  }, [initialCategory]);

  const handleGenerateSixDigit = async () => {
    setGeneratingSixDigit(true);
    try {
      const targetCountry = countryCode === 'ALL' ? 'ID' : countryCode;
      const res = await apiRequest<{ pattern: string; phoneNumber: string; isDemo: boolean }>(
        '/api/numbers/generate-six-digit',
        {
          method: 'POST',
          body: JSON.stringify({ countryCode: targetCountry, carrier }),
        }
      );
      setCategory('6 Digit Kembar');
      setSelectedPreset('');
      setCustomPattern(res.pattern);
      await fetchNumbers({
        country: countryCode,
        cat: '6 Digit Kembar',
        preset: '',
        custom: res.pattern,
      });
      onNotify(
        'success',
        `Nomor 6 Digit Kembar dibuat (${res.pattern})`,
        `[DEMO] ${res.phoneNumber} siap disewa.`
      );
    } catch (err) {
      onNotify('error', 'Gagal membuat nomor 6 digit kembar', err instanceof Error ? err.message : undefined);
    } finally {
      setGeneratingSixDigit(false);
    }
  };

  const selectedCountryObj = meta?.countries.find((c) => c.code === countryCode);
  const availableCarriers = selectedCountryObj
    ? ['Semua Operator', ...selectedCountryObj.carriers]
    : ['Semua Operator'];

  const handlePresetClick = (pattern: string) => {
    const next = selectedPreset === pattern ? '' : pattern;
    setSelectedPreset(next);
    if (next) setCustomPattern('');
    fetchNumbers({ preset: next, custom: next ? '' : customPattern });
  };

  const handleResetFilters = () => {
    setCountryCode('ALL');
    setCarrier('Semua Operator');
    setProviderCode('all');
    setCategory('Semua Kategori');
    setSelectedPreset('');
    setCustomPattern('');
    fetchNumbers({
      country: 'ALL',
      op: 'Semua Operator',
      cat: 'Semua Kategori',
      preset: '',
      custom: '',
      prov: 'all',
    });
  };

  const getCheckoutPrice = (num: VirtualNumber, duration: number): number => {
    switch (duration) {
      case 10:
        return num.price10m;
      case 30:
        return num.price30m;
      case 60:
        return num.price1h;
      case 1440:
        return num.price24h;
      default:
        return num.price30m;
    }
  };

  const handleConfirmRent = async () => {
    if (!checkoutNumber) return;
    if (!acceptedTerms) {
      onNotify('error', 'Persetujuan diperlukan', 'Centang pernyataan penggunaan yang sah terlebih dahulu.');
      return;
    }
    setRenting(true);
    try {
      const res = await apiRequest<{ rental: { id: string; phone_number: string }; balance: number }>(
        '/api/numbers/rent',
        {
          method: 'POST',
          body: JSON.stringify({
            numberId: checkoutNumber.id,
            durationMinutes: selectedDuration,
            acceptedTerms: true,
          }),
        }
      );
      onNotify(
        'success',
        'Nomor berhasil disewa',
        `${checkoutNumber.isDemo ? '[DEMO] ' : ''}${checkoutNumber.phoneNumber} aktif sekarang.`
      );
      setCheckoutNumber(null);
      setAcceptedTerms(false);
      onRented(res.rental.id, res.balance);
      fetchNumbers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyewa nomor.';
      onNotify('error', 'Sewa gagal', msg);
    } finally {
      setRenting(false);
    }
  };

  const renderHighlightedNumber = (phone: string, pattern: string) => {
    if (!pattern) return phone;
    const idx = phone.lastIndexOf(pattern);
    if (idx === -1) return phone;
    return (
      <>
        <span>{phone.slice(0, idx)}</span>
        <span className="text-sky-400 underline decoration-violet-500/70 underline-offset-4">
          {phone.slice(idx, idx + pattern.length)}
        </span>
        <span>{phone.slice(idx + pattern.length)}</span>
      </>
    );
  };

  return (
    <div className="space-y-6">
      {/* Generator Studio Header & Filter Controls */}
      <section className="rounded-2xl bg-[#0D1528] border border-slate-800/90 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-5 border-b border-slate-800/80">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Generator Nomor Cantik
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Filter berdasarkan negara, kode telepon, operator, kategori pola, atau masukkan pola angka kustom.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
            <button
              type="button"
              disabled={generatingSixDigit}
              onClick={handleGenerateSixDigit}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap disabled:opacity-60"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{generatingSixDigit ? 'Membuat...' : 'Generate 6 Digit Kembar (DEMO)'}</span>
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#070C1A] hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset Filter</span>
            </button>
          </div>
        </div>

        {/* Filter Selectors */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="gen-country">
              Negara &amp; Kode Telepon
            </label>
            <select
              id="gen-country"
              value={countryCode}
              onChange={(e) => {
                const next = e.target.value;
                setCountryCode(next);
                setCarrier('Semua Operator');
                fetchNumbers({ country: next, op: 'Semua Operator' });
              }}
              className="w-full min-h-[44px] px-3.5 bg-[#070C1A] border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-sky-400"
            >
              <option value="ALL">Semua Negara</option>
              {meta?.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.dialCode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="gen-carrier">
              Operator Seluler
            </label>
            <select
              id="gen-carrier"
              value={carrier}
              onChange={(e) => {
                setCarrier(e.target.value);
                fetchNumbers({ op: e.target.value });
              }}
              className="w-full min-h-[44px] px-3.5 bg-[#070C1A] border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-sky-400"
            >
              {availableCarriers.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="gen-category">
              Kategori Nomor Cantik
            </label>
            <select
              id="gen-category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                fetchNumbers({ cat: e.target.value });
              }}
              className="w-full min-h-[44px] px-3.5 bg-[#070C1A] border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-sky-400"
            >
              {(meta?.categories || ['Semua Kategori']).map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="gen-provider">
              Sumber Provider API
            </label>
            <select
              id="gen-provider"
              value={providerCode}
              onChange={(e) => {
                setProviderCode(e.target.value);
                fetchNumbers({ prov: e.target.value });
              }}
              className="w-full min-h-[44px] px-3.5 bg-[#070C1A] border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-sky-400"
            >
              <option value="all">Semua Sumber (API + DEMO)</option>
              {meta?.providers.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.name} {p.isDemo ? '(DEMO)' : p.isConfigured ? '(LIVE)' : '(Belum Dikonfigurasi)'}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Preset Beauty Patterns & Custom Pattern Input */}
        <div className="mt-5 pt-5 border-t border-slate-800/80 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <span className="block text-xs font-medium text-slate-300 mb-2">
              Pola Angka Cantik (6 Digit Kembar &amp; 4 Digit)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {(
                meta?.presetPatterns || [
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
                ]
              ).map((pat) => {
                const active = selectedPreset === pat;
                return (
                  <button
                    key={pat}
                    type="button"
                    onClick={() => handlePresetClick(pat)}
                    className={`min-h-[40px] px-3.5 py-2 rounded-xl font-mono text-xs font-bold transition-all border ${
                      active
                        ? 'bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-600/25'
                        : 'bg-[#070C1A] border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    {pat}
                  </button>
                );
              })}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSelectedPreset('');
              fetchNumbers({ preset: '', custom: customPattern });
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5 lg:w-[380px]"
          >
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="gen-custom">
                Custom Pattern (2–8 digit)
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="gen-custom"
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  value={customPattern}
                  onChange={(e) => setCustomPattern(e.target.value.replace(/\D/g, ''))}
                  placeholder="Misal: 888888 atau 777777"
                  className="w-full min-h-[44px] pl-10 pr-4 bg-[#070C1A] border border-slate-800 rounded-xl font-mono text-sm text-white placeholder:text-slate-500 placeholder:font-sans focus:outline-none focus:border-sky-400"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-sky-500 hover:from-violet-500 hover:to-sky-400 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all whitespace-nowrap shrink-0"
            >
              <Filter className="w-4 h-4" />
              <span>Generate</span>
            </button>
          </form>
        </div>
      </section>

      {warning && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-start gap-3 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-4 text-xs text-rose-200">
          {errorMsg}
        </div>
      )}

      {/* Results Grid */}
      <section aria-label="Daftar nomor virtual tersedia">
        <div className="flex items-center justify-between mb-3.5 px-1">
          <h2 className="text-sm font-semibold text-slate-200">
            Nomor Tersedia <span className="font-mono tabular-nums text-sky-400">({numbers.length})</span>
          </h2>
          <span className="text-xs text-slate-400">
            Nomor sandbox ditandai label <strong className="text-amber-300 font-mono">DEMO</strong>
          </span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="h-44 rounded-2xl bg-[#0D1528] border border-slate-800/80 animate-pulse" />
            ))}
          </div>
        ) : numbers.length === 0 ? (
          <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-10 text-center">
            <Globe className="w-8 h-8 text-slate-500 mx-auto" />
            <h3 className="mt-3 text-sm font-semibold text-white">Tidak ada nomor cocok dengan filter saat ini</h3>
            <p className="mt-1 text-xs text-slate-400">
              Coba masukkan Custom Pattern (misalnya 7788) atau ubah filter negara/operator.
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="mt-4 min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-colors"
            >
              Tampilkan Semua Nomor
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {numbers.map((num, idx) => (
              <motion.article
                key={num.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: Math.min(idx * 0.025, 0.25), ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl bg-[#0D1528] border border-slate-800/90 hover:border-violet-500/40 p-5 flex flex-col justify-between gap-4 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {num.status}
                    </span>
                    {num.isDemo ? (
                      <span className="font-mono text-[11px] font-bold text-amber-300 border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 rounded-md">
                        DEMO
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] font-bold text-sky-300 border border-sky-400/35 bg-sky-500/10 px-2 py-0.5 rounded-md">
                        LIVE API
                      </span>
                    )}
                  </div>

                  <div className="mt-3 text-xl sm:text-2xl font-bold font-mono tabular-nums text-white tracking-tight">
                    {renderHighlightedNumber(num.phoneNumber, num.matchedPattern)}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                    <span className="text-slate-200 font-medium">{num.countryName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{num.carrier}</span>
                    <span aria-hidden="true">·</span>
                    <span>{num.patternCategory}</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] text-slate-400">Mulai 10 menit</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-white">
                      {formatIDR(num.price10m)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCheckoutNumber(num);
                      setSelectedDuration(num.supportedDurations.includes(30) ? 30 : num.supportedDurations[0] || 10);
                      setAcceptedTerms(false);
                    }}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Pilih &amp; Sewa</span>
                  </button>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </section>

      {/* Checkout Modal / Mobile Bottom Sheet */}
      <AnimatePresence>
        {checkoutNumber && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full sm:max-w-lg bg-[#0D1528] border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-4 sm:hidden" />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-sky-400">Konfirmasi Sewa Nomor</span>
                    {checkoutNumber.isDemo && (
                      <span className="font-mono text-[11px] font-bold text-amber-300 border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 rounded-md">
                        DEMO
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-xl sm:text-2xl font-bold font-mono tabular-nums text-white">
                    {checkoutNumber.phoneNumber}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {checkoutNumber.countryName} · {checkoutNumber.carrier} · {checkoutNumber.providerName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCheckoutNumber(null)}
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  aria-label="Tutup modal sewa"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-5">
                <span className="block text-xs font-semibold text-slate-300 mb-2.5">
                  Pilih Durasi Masa Aktif
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { minutes: 10, label: '10 Menit', price: checkoutNumber.price10m },
                    { minutes: 30, label: '30 Menit', price: checkoutNumber.price30m },
                    { minutes: 60, label: '1 Jam', price: checkoutNumber.price1h },
                    { minutes: 1440, label: '24 Jam', price: checkoutNumber.price24h },
                  ].map((opt) => {
                    const supported = checkoutNumber.supportedDurations.includes(opt.minutes);
                    const active = selectedDuration === opt.minutes;
                    return (
                      <button
                        key={opt.minutes}
                        type="button"
                        disabled={!supported}
                        onClick={() => setSelectedDuration(opt.minutes)}
                        className={`min-h-[54px] p-3 rounded-xl border text-left transition-all ${
                          active
                            ? 'bg-violet-600/20 border-violet-500 text-white'
                            : 'bg-[#070C1A] border-slate-800 text-slate-300 hover:border-slate-700'
                        } disabled:opacity-40`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs font-medium">
                          <span>{opt.label}</span>
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                        </div>
                        <div className="mt-1 text-sm font-bold font-mono tabular-nums text-sky-300">
                          {formatIDR(opt.price)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5 p-3.5 rounded-xl bg-[#070C1A] border border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-400">Saldo Dompet Anda</span>
                <span className="font-mono tabular-nums font-bold text-white">{formatIDR(userBalance)}</span>
              </div>

              {userBalance < getCheckoutPrice(checkoutNumber, selectedDuration) && (
                <p className="mt-2.5 text-xs text-rose-400">
                  Saldo tidak mencukupi. Silakan isi saldo di menu Dompet terlebih dahulu.
                </p>
              )}

              <label className="mt-4 flex items-start gap-3 p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-violet-600 rounded"
                />
                <span className="text-xs text-slate-300 leading-relaxed">
                  Saya menyatakan nomor sementara ini digunakan secara sah untuk verifikasi akun pribadi atau pengujian aplikasi, bukan untuk intersepsi OTP atau mengambil alih akun pihak lain.
                </span>
              </label>

              <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={() => setCheckoutNumber(null)}
                  className="min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={
                    renting || !acceptedTerms || userBalance < getCheckoutPrice(checkoutNumber, selectedDuration)
                  }
                  onClick={handleConfirmRent}
                  className="flex-1 min-h-[46px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-sky-500 hover:from-violet-500 hover:to-sky-400 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {renting
                      ? 'Mengaktifkan Nomor...'
                      : `Sewa (${formatIDR(getCheckoutPrice(checkoutNumber, selectedDuration))})`}
                  </span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
