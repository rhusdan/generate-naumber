import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Eye, EyeOff, Lock, Mail, PhoneCall, ShieldCheck, User as UserIcon } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { User } from '../types';

interface AuthScreenProps {
  onSuccess: (token: string, user: User) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

export function AuthScreen({ onSuccess, onNotify }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = mode === 'login' ? { email, password } : { name, email, password };
      const res = await apiRequest<{ token: string; user: User }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onNotify(
        'success',
        mode === 'login' ? 'Selamat datang kembali' : 'Akun berhasil dibuat',
        mode === 'register' ? 'Saldo uji coba sandbox Rp 50.000 telah ditambahkan.' : undefined
      );
      onSuccess(res.token, res.user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Autentikasi gagal.';
      setErrorMsg(msg);
      onNotify('error', 'Gagal masuk', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickDemoLogin = async (demoEmail: string, demoPassword: string, label: string) => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: demoEmail, password: demoPassword }),
      });
      onNotify('success', `Masuk sebagai ${label}`, `Akun ${res.user.email} aktif.`);
      onSuccess(res.token, res.user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login demo gagal.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060B18] text-slate-100 flex flex-col lg:flex-row">
      {/* Left Brand Showcase */}
      <div className="lg:w-1/2 xl:w-[54%] px-6 py-10 lg:px-14 lg:py-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-800/80 bg-[radial-gradient(ellipse_at_top_left,_rgba(124,58,237,0.14),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(14,165,233,0.12),_transparent_55%)]">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-sky-500 flex items-center justify-center shadow-lg shadow-violet-600/20">
              <PhoneCall className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">BEAUTY NUMBER</span>
          </div>

          <div className="mt-10 lg:mt-16 max-w-xl">
            <p className="text-xs font-medium tracking-wide text-sky-400">
              Temporary Phone Number Generator
            </p>
            <h1 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-[1.12] [text-wrap:balance]">
              Nomor virtual cantik untuk verifikasi sementara yang aman dan terukur.
            </h1>
            <p className="mt-5 text-sm sm:text-base text-slate-300 leading-relaxed max-w-lg">
              Cari pola angka eksklusif seperti 7777, 8888, 9999, 1234, atau pola kustom dari API provider resmi maupun mode Demo Sandbox berlabel jelas.
            </p>

            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-6 pt-8 border-t border-slate-800/80">
              <div>
                <h2 className="text-sm font-semibold text-white">Integrasi Provider Resmi</h2>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                  Mendukung Twilio, Vonage, dan Telnyx melalui backend terenkripsi. Mode DEMO aktif otomatis bila API belum terhubung.
                </p>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Privasi OTP Otomatis</h2>
                <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                  Pesan OTP masuk secara real-time dengan masa simpan terbatas dan penghapusan otomatis saat masa sewa selesai.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-800/70 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            Penggunaan sah untuk verifikasi akun pribadi &amp; QA testing
          </span>
          <span aria-hidden="true">·</span>
          <span>Kepatuhan anti-intersepsi OTP</span>
        </div>
      </div>

      {/* Right Auth Form */}
      <div className="lg:w-1/2 xl:w-[46%] px-6 py-10 sm:px-10 lg:px-14 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md bg-[#0D1528] border border-slate-800/90 rounded-2xl p-6 sm:p-8"
        >
          <div className="flex items-center gap-1 p-1 bg-[#070C1A] border border-slate-800/80 rounded-xl mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
              }}
              className={`flex-1 min-h-[44px] text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                mode === 'login' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Masuk
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMsg(null);
              }}
              className={`flex-1 min-h-[44px] text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                mode === 'register' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Daftar Akun
            </button>
          </div>

          <h2 className="text-xl font-bold text-white">
            {mode === 'login' ? 'Masuk ke Workspace' : 'Buat Akun BEAUTY NUMBER'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {mode === 'login'
              ? 'Kelola sewa nomor cantik, saldo dompet, dan kotak masuk OTP Anda.'
              : 'Dapatkan saldo sandbox Rp 50.000 untuk menguji generator nomor DEMO.'}
          </p>

          {errorMsg && (
            <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="auth-name">
                  Nama Lengkap
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Contoh: Rina Kusuma"
                    className="w-full min-h-[44px] pl-10 pr-4 bg-[#070C1A] border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400 transition-colors"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="auth-email">
                Alamat Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@domain.com"
                  className="w-full min-h-[44px] pl-10 pr-4 bg-[#070C1A] border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="auth-password">
                Kata Sandi
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  className="w-full min-h-[44px] pl-10 pr-11 bg-[#070C1A] border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-200"
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[46px] mt-2 rounded-xl bg-gradient-to-r from-violet-600 to-sky-500 hover:from-violet-500 hover:to-sky-400 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-60"
            >
              <span>{submitting ? 'Memproses...' : mode === 'login' ? 'Masuk Sekarang' : 'Daftar Akun'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800/80">
            <p className="text-xs font-medium text-slate-400 mb-3">Akses Cepat Uji Coba (Sandbox)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleQuickDemoLogin('rina@beautynumber.id', 'UserDemo123!', 'Pengguna Demo')}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-[#070C1A] hover:bg-slate-800/70 border border-slate-800 text-left transition-colors"
              >
                <div className="text-xs font-semibold text-white">Akun Pengguna</div>
                <div className="text-[11px] text-slate-400 truncate">rina@beautynumber.id</div>
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleQuickDemoLogin('admin@beautynumber.id', 'AdminBeauty123!', 'Administrator')}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-[#070C1A] hover:bg-slate-800/70 border border-slate-800 text-left transition-colors"
              >
                <div className="text-xs font-semibold text-sky-400">Akun Admin</div>
                <div className="text-[11px] text-slate-400 truncate">admin@beautynumber.id</div>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
