export interface User {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  balance: number;
  createdAt: number;
}

export interface DashboardStats {
  totalAvailable: number;
  activeCount: number;
  expiredCount: number;
  userHistoryCount: number;
  hasLiveProviders: boolean;
  modeLabel: string;
}

export interface CountryMeta {
  code: string;
  name: string;
  dialCode: string;
  carriers: string[];
}

export interface DurationOption {
  minutes: number;
  label: string;
  key: string;
}

export interface ProviderInfo {
  id: string;
  code: string;
  name: string;
  isDemo: boolean;
  isConfigured: boolean;
  supportedDurations: number[];
  description: string;
}

export interface NumbersMetaResponse {
  countries: CountryMeta[];
  categories: string[];
  presetPatterns: string[];
  durations: DurationOption[];
  providers: ProviderInfo[];
}

export interface VirtualNumber {
  id: string;
  phoneNumber: string;
  countryCode: string;
  countryName: string;
  dialCode: string;
  carrier: string;
  patternCategory: string;
  matchedPattern: string;
  price10m: number;
  price30m: number;
  price1h: number;
  price24h: number;
  status: 'Available' | 'Active' | 'Expired';
  isDemo: boolean;
  providerName: string;
  providerCode: string;
  supportedDurations: number[];
  expiresAt?: number | null;
}

export interface Rental {
  id: string;
  numberId: string | null;
  phoneNumber: string;
  countryCode: string;
  countryName: string;
  carrier: string;
  providerName: string;
  providerCode: string;
  patternCategory: string;
  matchedPattern: string;
  isDemo: boolean;
  durationMinutes: number;
  pricePaid: number;
  status: 'Active' | 'Expired' | 'Released';
  startedAt: number;
  expiresAt: number;
}

export interface SmsMessage {
  id: string;
  rentalId?: string;
  sender: string;
  body: string;
  otpCode: string | null;
  receivedAt: number;
  expiresAt: number;
  isDemo: boolean;
}

export interface Transaction {
  id: string;
  type: 'topup' | 'rental' | 'refund';
  amount: number;
  paymentMethod: string;
  gatewayProvider: string;
  gatewayRef: string;
  status: 'Pending' | 'Completed' | 'Failed';
  description: string;
  createdAt: number;
  userName?: string;
  userEmail?: string;
}

export interface AdminOverview {
  totalUsers: number;
  totalNumbers: number;
  availableNumbers: number;
  activeRentals: number;
  expiredRentals: number;
  totalRevenue: number;
  totalTopups: number;
  categoryBreakdown: Array<{ category: string; count: number }>;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  balance: number;
  rentalCount: number;
  createdAt: number;
}

export interface CredentialStatus {
  keyName: string;
  configured: boolean;
  source: 'env' | 'vault' | 'none';
  maskedPreview: string;
}

export interface AdminProvider {
  id: string;
  code: string;
  name: string;
  apiBaseUrl: string;
  isActive: boolean;
  isDemo: boolean;
  supportedDurations: number[];
  description: string;
  updatedAt: number;
  credentials: CredentialStatus[];
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}
