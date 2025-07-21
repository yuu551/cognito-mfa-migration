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
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  checkMFAStatus: () => Promise<void>;
  setupMFA: (method: 'SMS' | 'TOTP') => Promise<any>;
  verifyAndEnableMFA: (totpCode: string) => Promise<{ success: boolean }>;
  confirmMFA: (totpCode: string) => Promise<void>;
  initializeUser: (userData: User) => void;
}