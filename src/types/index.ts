export interface MFARequirementConfig {
  required: boolean;
  allowSkip: boolean;
  showWarning?: boolean;
  daysRemaining?: number;
  deadline?: Date;
}

export interface UserMFAStatus {
  userId: string;
  mfaEnabled: boolean;
  mfaMethods: string[];
  migrationStatus: 'pending' | 'in_progress' | 'completed';
  lastNotified?: Date;
  migrationDeadline?: Date;
}

export interface MFAMigrationSettings {
  migrationDeadline: Date;
  warningDays: number[];
  gracePeriodDays: number;
  enabledMethods: string[];
}

export interface NotificationMessage {
  type: 'info' | 'warning' | 'error';
  message: string;
  actionRequired: boolean;
  daysRemaining?: number;
}

export interface CognitoUserPoolConfig {
  userPoolId: string;
  clientId: string;
  region: string;
  mfaConfiguration: 'OFF' | 'ON' | 'OPTIONAL';
}

export interface MigrationStrategy {
  name: string;
  description: string;
  implement: (config: any) => Promise<any>;
}