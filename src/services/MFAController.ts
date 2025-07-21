import { MFARequirementConfig, UserMFAStatus, MFAMigrationSettings, NotificationMessage } from '../types';

export class MFAController {
  private migrationSettings: MFAMigrationSettings;

  constructor(migrationSettings: MFAMigrationSettings) {
    this.migrationSettings = migrationSettings;
  }

  checkMFARequirement(userAttributes: any): MFARequirementConfig {
    const currentDate = new Date();
    const mfaDeadline = this.migrationSettings.migrationDeadline;
    
    if (currentDate > mfaDeadline) {
      return {
        required: true,
        allowSkip: false,
        showWarning: false,
        daysRemaining: 0,
        deadline: mfaDeadline
      };
    } else {
      const daysRemaining = Math.ceil((mfaDeadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
      
      return {
        required: false,
        allowSkip: true,
        showWarning: true,
        daysRemaining,
        deadline: mfaDeadline
      };
    }
  }

  getMFAPromptMessage(daysRemaining: number): NotificationMessage {
    if (daysRemaining > 30) {
      return {
        type: 'info',
        message: 'セキュリティ強化のため、多要素認証の設定をお願いします。',
        actionRequired: false,
        daysRemaining
      };
    } else if (daysRemaining > 7) {
      return {
        type: 'warning',
        message: `多要素認証の設定期限まで${daysRemaining}日です。お早めに設定をお願いします。`,
        actionRequired: true,
        daysRemaining
      };
    } else if (daysRemaining > 0) {
      return {
        type: 'error',
        message: `多要素認証の設定期限まで${daysRemaining}日です。設定しないとログインできなくなります。`,
        actionRequired: true,
        daysRemaining
      };
    } else {
      return {
        type: 'error',
        message: '多要素認証の設定期限を過ぎています。ログインにはMFAの設定が必要です。',
        actionRequired: true,
        daysRemaining: 0
      };
    }
  }

  getUserMFAStatus(userId: string): UserMFAStatus {
    return {
      userId,
      mfaEnabled: false,
      mfaMethods: [],
      migrationStatus: 'pending',
      lastNotified: undefined,
      migrationDeadline: this.migrationSettings.migrationDeadline
    };
  }

  updateMigrationStatus(userId: string, status: 'pending' | 'in_progress' | 'completed'): void {
    console.log(`Updating migration status for user ${userId}: ${status}`);
  }

  shouldShowMFAPrompt(userStatus: UserMFAStatus): boolean {
    const currentDate = new Date();
    const deadline = userStatus.migrationDeadline || this.migrationSettings.migrationDeadline;
    
    if (userStatus.mfaEnabled || userStatus.migrationStatus === 'completed') {
      return false;
    }
    
    if (currentDate > deadline) {
      return true;
    }
    
    const daysRemaining = Math.ceil((deadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (this.migrationSettings.warningDays.includes(daysRemaining)) {
      return true;
    }
    
    const lastNotified = userStatus.lastNotified;
    if (!lastNotified) {
      return true;
    }
    
    const daysSinceLastNotification = Math.ceil((currentDate.getTime() - lastNotified.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceLastNotification >= 7;
  }

  getMigrationProgress(): { total: number; completed: number; pending: number; percentage: number } {
    const total = 100;
    const completed = 25;
    const pending = total - completed;
    
    return {
      total,
      completed,
      pending,
      percentage: Math.round((completed / total) * 100)
    };
  }

  async enforceGracePeriod(userId: string): Promise<boolean> {
    const userStatus = this.getUserMFAStatus(userId);
    const currentDate = new Date();
    const deadline = userStatus.migrationDeadline || this.migrationSettings.migrationDeadline;
    
    if (userStatus.mfaEnabled) {
      return true;
    }
    
    const daysOverDeadline = Math.ceil((currentDate.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysOverDeadline <= this.migrationSettings.gracePeriodDays) {
      console.log(`User ${userId} is in grace period (${daysOverDeadline}/${this.migrationSettings.gracePeriodDays} days)`);
      return true;
    }
    
    console.log(`User ${userId} exceeded grace period, MFA is required`);
    return false;
  }
}