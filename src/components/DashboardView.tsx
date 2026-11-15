import { motion } from 'motion/react';
import {
  Activity,
  ArrowUpRight,
  Clock,
  Copy,
  Hash,
  History,
  Inbox,
  PhoneOff,
  Radio,
  ShieldAlert,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
import { formatCountdown, formatDateTime, formatIDR } from '../lib/api';
import type { DashboardStats, Rental } from '../types';

interface DashboardViewProps {
  stats: DashboardStats | null;
  rentals: Rental[];
  loading: boolean;
  nowMs: number;
  onNavigateGenerator: () => void;
  onOpenInbox: (rentalId: string) => void;
  onReleaseRental: (rentalId: string) => Promise<void>;
  onCopyNumber: (phone: string) => void;
}

export function DashboardView({
  stats,
  rentals,
  loading,
  nowMs,
  onNavigateGenerator,
  onOpenInbox,
  onReleaseRental,
  onCopyNumber,
}: DashboardViewProps) {
  const activeRentals = rentals.filter((r) => r.status === 'Active');
  const recentHistory = rentals.slice(0, 8);

  const kpiCards = [
    {
      label: 'Total Nomor Tersedia',
      value: stats?.totalAvailable ?? 0,
      sub: 'Katalog siap sewa',
      icon: Hash,
      accent: 'text-sky-400',
    },
    {
      label: 'Sedang Digunakan',
      value: stats?.activeCount ?? 0,
      sub: 'Masa sewa berjalan',
      icon: Activity,
      accent: 'text-emerald-400',
    },
    {
      label: 'Sudah Kedaluwarsa',
      value: stats?.expiredCount ?? 0,
      sub: 'OTP otomatis terhapus',
      icon: Clock,
      accent: 'text-amber-400',
    },
    {
      label: 'Riwayat Pengguna',
      value: stats?.userHistoryCount ?? 0,
      sub: 'Total sewa akun Anda',
      icon: History,
      accent: 'text-violet-400',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero Action Banner */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-2xl bg-[#0D1528] border border-slate-800/90 p-5 sm:p-7 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5"
      >
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-sky-400">
              {stats?.hasLiveProviders ? 'LIVE API + DEMO' : 'MODE DEMO SANDBOX'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Nomor resmi terintegrasi backend</span>
            <span aria-hidden="true">·</span>
            <span>OTP berbatas waktu otomatis</span>
          </div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-white tracking-tight [text-wrap:balance]">
            Kelola nomor virtual cantik &amp; verifikasi OTP real-time
          </h1>
          <p className="mt-2 text-sm text-slate-300 leading-relaxed">
            {stats?.hasLiveProviders
              ? 'Provider API resmi terdeteksi aktif. Nomor live dari operator dapat disewa sesuai durasi yang tersedia.'
              : 'Kredensial API provider resmi belum diisi. Aplikasi berjalan dalam mode DEMO dengan nomor sandbox berlabel DEMO.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onNavigateGenerator}
            className="w-full sm:w-auto min-h-[46px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-sky-500 hover:from-violet-500 hover:to-sky-400 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all shadow-lg shadow-violet-600/20 whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate Number</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      </motion.section>

      {/* 4 KPI Summary Grid */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4" aria-label="Ringkasan statistik">
        {kpiCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-400 truncate">{card.label}</span>
                <Icon className={`w-4 h-4 shrink-0 ${card.accent}`} />
              </div>
              {loading ? (
                <div className="mt-3 h-8 w-16 rounded-lg bg-slate-800 animate-pulse" />
              ) : (
                <div className="mt-2.5 text-2xl sm:text-3xl font-bold text-white font-mono tabular-nums">
                  {card.value}
                </div>
              )}
              <p className="mt-1 text-xs text-slate-400 truncate">{card.sub}</p>
            </motion.div>
          );
        })}
      </section>

      {/* Active Rentals Section */}
      <section className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-800/80">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white">Nomor Aktif Anda</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Pantau sisa masa aktif secara langsung dan buka kotak masuk SMS/OTP.
            </p>
          </div>
          {activeRentals.length > 0 && (
            <button
              type="button"
              onClick={onNavigateGenerator}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-xs font-semibold text-slate-200 transition-colors self-start sm:self-auto whitespace-nowrap"
            >
              + Sewa Nomor Baru
            </button>
          )}
        </div>

        {loading ? (
          <div className="py-8 space-y-3">
            <div className="h-16 rounded-xl bg-slate-800/50 animate-pulse" />
            <div className="h-16 rounded-xl bg-slate-800/50 animate-pulse" />
          </div>
        ) : activeRentals.length === 0 ? (
          <div className="py-10 text-center max-w-md mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-slate-800/70 flex items-center justify-center mx-auto text-slate-400">
              <Radio className="w-6 h-6" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-white">Belum ada nomor yang sedang aktif</h3>
            <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
              Pilih negara, pola nomor cantik (7777, 8888, 1234, atau Custom Pattern), lalu sewa nomor dengan durasi 10 menit hingga 24 jam.
            </p>
            <button
              type="button"
              onClick={onNavigateGenerator}
              className="mt-5 min-h-[44px] px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              <span>Generate Number Sekarang</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {activeRentals.map((rental) => {
              const countdown = formatCountdown(rental.expiresAt, nowMs);
              const isAlmostExpired = rental.expiresAt - nowMs < 120000;
              return (
                <div
                  key={rental.id}
                  className="py-4 first:pt-4 last:pb-1 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-lg sm:text-xl font-bold font-mono tabular-nums text-white tracking-tight">
                        {rental.phoneNumber}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                        <Activity className="w-3.5 h-3.5" />
                        Active
                      </span>
                      {rental.isDemo && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold font-mono text-amber-300 border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 rounded-md">
                          DEMO
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>{rental.countryName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{rental.carrier}</span>
                      <span aria-hidden="true">·</span>
                      <span>Pola {rental.matchedPattern}</span>
                      <span aria-hidden="true">·</span>
                      <span>{rental.providerName}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <div
                      className={`px-3 py-2 rounded-xl border text-xs font-mono tabular-nums font-semibold ${
                        isAlmostExpired
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                          : 'bg-[#070C1A] border-slate-800 text-sky-300'
                      }`}
                    >
                      Sisa {countdown}
                    </div>
                    <button
                      type="button"
                      onClick={() => onCopyNumber(rental.phoneNumber)}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#070C1A] hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Salin</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenInbox(rental.id)}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Inbox className="w-3.5 h-3.5" />
                      <span>Buka OTP</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onReleaseRental(rental.id)}
                      className="min-h-[44px] px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <PhoneOff className="w-3.5 h-3.5" />
                      <span>Akhiri</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Rental History Table + Compliance Notice */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5 sm:p-6 overflow-hidden">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
            <div>
              <h2 className="text-base font-bold text-white">Riwayat Nomor Pengguna</h2>
              <p className="text-xs text-slate-400 mt-0.5">Daftar nomor virtual yang pernah dan sedang Anda sewa.</p>
            </div>
          </div>

          {recentHistory.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">Belum ada riwayat penyewaan nomor.</p>
          ) : (
            <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6 mt-2">
              <table className="w-full text-left border-collapse min-w-[560px]">
                <thead>
                  <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                    <th className="py-3 font-medium">Nomor Virtual</th>
                    <th className="py-3 font-medium">Negara &amp; Pola</th>
                    <th className="py-3 font-medium">Status</th>
                    <th className="py-3 font-medium">Mulai Sewa</th>
                    <th className="py-3 font-medium text-right">Biaya</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {recentHistory.map((item) => (
                    <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 pr-3 font-mono tabular-nums text-white font-medium whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{item.phoneNumber}</span>
                          {item.isDemo && (
                            <span className="text-[10px] font-bold text-amber-300 border border-amber-400/35 px-1.5 py-0.5 rounded">
                              DEMO
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-xs text-slate-300">
                        {item.countryName} · {item.matchedPattern}
                      </td>
                      <td className="py-3 pr-3 text-xs whitespace-nowrap">
                        {item.status === 'Active' ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                            <Activity className="w-3.5 h-3.5" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-slate-400">
                            <Clock className="w-3.5 h-3.5" />
                            Expired
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-xs text-slate-400 tabular-nums whitespace-nowrap">
                        {formatDateTime(item.startedAt)}
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums text-xs text-slate-200 whitespace-nowrap">
                        {formatIDR(item.pricePaid)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-[#0D1528] border border-slate-800/80 p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-sky-400">
              <ShieldAlert className="w-5 h-5" />
              <h2 className="text-base font-bold text-white">Kepatuhan &amp; Keamanan OTP</h2>
            </div>
            <ul className="mt-4 space-y-3 text-xs text-slate-300 leading-relaxed">
              <li className="pb-3 border-b border-slate-800/70">
                <strong className="text-white block mb-0.5">Sumber Nomor Resmi</strong>
                Nomor aktif hanya berasal dari API provider resmi (Twilio, Vonage, Telnyx). Bila API belum diatur, katalog ditandai jelas sebagai <span className="font-mono text-amber-300">DEMO</span>.
              </li>
              <li className="pb-3 border-b border-slate-800/70">
                <strong className="text-white block mb-0.5">Penghapusan OTP Otomatis</strong>
                Pesan OTP tidak disimpan lebih lama dari masa aktif sewa (maksimal 5 menit TTL) dan langsung dihapus permanen saat nomor berakhir.
              </li>
              <li>
                <strong className="text-white block mb-0.5">Larangan Penyalahgunaan</strong>
                Platform melarang keras intersepsi OTP pihak lain, bypass verifikasi ilegal, maupun pengambilalihan akun.
              </li>
            </ul>
          </div>

          <div className="pt-3 border-t border-slate-800/70 flex items-center gap-2.5 text-xs text-slate-400">
            <SquareTerminal className="w-4 h-4 text-violet-400 shrink-0" />
            <span>Webhook &amp; API Secret dikelola eksklusif di server.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
