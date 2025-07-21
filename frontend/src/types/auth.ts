export interface User {
  userId: string;
  username: string;
  email: string;
  mfaEnabled: boolean;
}

export interface MFAStatus {
  enabled: boolean;
  methods: string[];
  migrationDeadline: Date;
  daysRemaining: number;
  warningLevel: 'info' | 'warning' | 'error';
  showWarning: boolean;
}

export interface AuthContextType {
  user: User | null;
  mfaStatus: MFAStatus | null;
  needsMFAConfirmation: boolean;
  mfaSetupCompleted: boolean; // 🚀 MFA設定完了フラグ
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  checkMFAStatus: () => Promise<void>;
  setupMFA: (method: 'SMS' | 'TOTP') => Promise<unknown>;
  verifyAndEnableMFA: (totpCode: string) => Promise<{ success: boolean }>;
  confirmMFA: (totpCode: string) => Promise<void>;
  initializeUser: (userData: User) => void;
  setMfaSetupCompleted: (completed: boolean) => void; // 🚀 フラグ操作関数を追加
}