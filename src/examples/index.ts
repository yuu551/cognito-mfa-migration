import { MFAController } from '../services/MFAController';
import { UserMigrationManager } from '../services/UserMigrationManager';
import { NotificationService } from '../services/NotificationService';
import { MultipleUserPoolStrategy } from '../services/MultipleUserPoolStrategy';
import { MFAMigrationSettings } from '../types';

export class MFAMigrationDemo {
  private mfaController: MFAController;
  private userMigrationManager: UserMigrationManager;
  private notificationService: NotificationService;
  private multiplePoolStrategy: MultipleUserPoolStrategy;

  constructor() {
    const migrationSettings: MFAMigrationSettings = {
      migrationDeadline: new Date('2025-09-01'),
      warningDays: [30, 14, 7, 3, 1],
      gracePeriodDays: 7,
      enabledMethods: ['SMS', 'TOTP', 'EMAIL']
    };

    this.mfaController = new MFAController(migrationSettings);
    
    this.userMigrationManager = new UserMigrationManager(
      'us-east-1_example',
      'us-east-1',
      migrationSettings
    );

    this.notificationService = new NotificationService('us-east-1', {
      emailFrom: 'noreply@example.com',
      smsRegion: 'us-east-1',
      emailTemplates: {
        info: {
          subject: 'MFA設定のお知らせ',
          body: 'セキュリティ強化のため、MFAの設定をお願いします。'
        },
        warning: {
          subject: 'MFA設定期限が近づいています',
          body: 'MFAの設定期限が近づいています。お早めに設定してください。'
        },
        urgent: {
          subject: '【緊急】MFA設定が必要です',
          body: '期限を過ぎるとログインできなくなります。'
        }
      }
    });

    this.multiplePoolStrategy = new MultipleUserPoolStrategy('us-east-1', {
      legacyPool: {
        userPoolId: 'us-east-1_legacy',
        clientId: 'legacy-client',
        region: 'us-east-1',
        mfaConfiguration: 'OPTIONAL'
      },
      newPool: {
        userPoolId: 'us-east-1_new',
        clientId: 'new-client',
        region: 'us-east-1',
        mfaConfiguration: 'ON'
      },
      migrationStrategy: 'gradual',
      migrationDeadline: new Date('2025-09-01')
    });
  }

  async demonstrateOptionalMFAControl(): Promise<void> {
    console.log('\n=== Optional MFA + Application Control Demo ===');
    
    const scenarios = [
      { name: 'ユーザー1: 期限まで45日', daysFromDeadline: 45 },
      { name: 'ユーザー2: 期限まで30日', daysFromDeadline: 30 },
      { name: 'ユーザー3: 期限まで7日', daysFromDeadline: 7 },
      { name: 'ユーザー4: 期限まで1日', daysFromDeadline: 1 },
      { name: 'ユーザー5: 期限超過5日', daysFromDeadline: -5 }
    ];

    for (const scenario of scenarios) {
      console.log(`\n--- ${scenario.name} ---`);
      
      const mockDate = new Date();
      mockDate.setDate(mockDate.getDate() - scenario.daysFromDeadline);
      
      const originalDeadline = this.mfaController['migrationSettings'].migrationDeadline;
      this.mfaController['migrationSettings'].migrationDeadline = mockDate;
      
      const requirement = this.mfaController.checkMFARequirement({});
      console.log('MFA Requirement:', requirement);
      
      const message = this.mfaController.getMFAPromptMessage(requirement.daysRemaining || 0);
      console.log('Notification Message:', message);
      
      this.mfaController['migrationSettings'].migrationDeadline = originalDeadline;
    }
  }

  async demonstrateUserMigrationStatus(): Promise<void> {
    console.log('\n=== User Migration Status Demo ===');
    
    const userIds = ['user1', 'user2', 'user3', 'user4', 'user5'];
    
    for (const userId of userIds) {
      console.log(`\n--- ${userId} ---`);
      
      const status = await this.userMigrationManager.getUserMFAStatus(userId);
      console.log('Initial Status:', status);
      
      await this.userMigrationManager.updateUserMigrationStatus(userId, 'in_progress');
      console.log('Updated to in_progress');
      
      await this.userMigrationManager.updateLastNotified(userId);
      console.log('Updated last notified');
    }
    
    const progress = await this.userMigrationManager.getMigrationProgress();
    console.log('\nMigration Progress:', progress);
    
    const report = await this.userMigrationManager.generateMigrationReport();
    console.log('\nMigration Report:', JSON.stringify(report, null, 2));
  }

  async demonstrateNotificationSystem(): Promise<void> {
    console.log('\n=== Notification System Demo ===');
    
    const testUsers = [
      { userId: 'user1', daysRemaining: 45 },
      { userId: 'user2', daysRemaining: 30 },
      { userId: 'user3', daysRemaining: 7 },
      { userId: 'user4', daysRemaining: 1 },
      { userId: 'user5', daysRemaining: 0 }
    ];

    for (const user of testUsers) {
      console.log(`\n--- ${user.userId} (${user.daysRemaining}日前) ---`);
      
      const userStatus = await this.userMigrationManager.getUserMFAStatus(user.userId);
      const notificationMessage = this.mfaController.getMFAPromptMessage(user.daysRemaining);
      
      console.log('Notification Message:', notificationMessage);
      
      try {
        await this.notificationService.sendMFANotification(userStatus, notificationMessage);
        console.log('Notification sent successfully');
      } catch (error) {
        console.log('Notification failed:', error);
      }
    }
  }

  async demonstrateMultipleUserPoolStrategy(): Promise<void> {
    console.log('\n=== Multiple User Pool Strategy Demo ===');
    
    const validationResult = await this.multiplePoolStrategy.validateMigrationReadiness();
    console.log('Migration Readiness:', validationResult);
    
    const migrationStatus = await this.multiplePoolStrategy.getUserPoolMigrationStatus();
    console.log('Migration Status:', migrationStatus);
    
    const testUsers = ['user1', 'user2', 'user3'];
    
    for (const userId of testUsers) {
      console.log(`\n--- Migrating ${userId} ---`);
      
      const migrationResult = await this.multiplePoolStrategy.migrateUser(userId, 'TempPassword123!');
      console.log('Migration Result:', migrationResult);
    }
    
    const batchResult = await this.multiplePoolStrategy.batchMigrateUsers(['user4', 'user5'], 2);
    console.log('\nBatch Migration Result:', batchResult);
  }

  async demonstrateGracePeriodBehavior(): Promise<void> {
    console.log('\n=== Grace Period Behavior Demo ===');
    
    const gracePeriodScenarios = [
      { userId: 'user1', daysOverDeadline: 0, description: '期限当日' },
      { userId: 'user2', daysOverDeadline: 3, description: '期限超過3日' },
      { userId: 'user3', daysOverDeadline: 7, description: '期限超過7日（猶予期間最終日）' },
      { userId: 'user4', daysOverDeadline: 10, description: '期限超過10日（猶予期間終了）' }
    ];

    for (const scenario of gracePeriodScenarios) {
      console.log(`\n--- ${scenario.userId}: ${scenario.description} ---`);
      
      const canLogin = await this.mfaController.enforceGracePeriod(scenario.userId);
      console.log('Login Allowed:', canLogin);
      
      const requirement = this.mfaController.checkMFARequirement({});
      console.log('MFA Requirement:', requirement);
    }
  }

  async demonstrateProgressiveNotifications(): Promise<void> {
    console.log('\n=== Progressive Notifications Demo ===');
    
    const warningDays = [30, 14, 7, 3, 1];
    
    for (const daysRemaining of warningDays) {
      console.log(`\n--- ${daysRemaining}日前通知 ---`);
      
      const message = this.mfaController.getMFAPromptMessage(daysRemaining);
      console.log('Message Type:', message.type);
      console.log('Message:', message.message);
      console.log('Action Required:', message.actionRequired);
      
      const userStatus = await this.userMigrationManager.getUserMFAStatus(`user_${daysRemaining}`);
      
      try {
        await this.notificationService.sendMFANotification(userStatus, message);
        console.log('Notification sent successfully');
      } catch (error) {
        console.log('Notification failed:', error);
      }
    }
  }

  async runAllDemos(): Promise<void> {
    console.log('🚀 Starting MFA Migration Pattern Demonstrations');
    
    await this.demonstrateOptionalMFAControl();
    await this.demonstrateUserMigrationStatus();
    await this.demonstrateNotificationSystem();
    await this.demonstrateMultipleUserPoolStrategy();
    await this.demonstrateGracePeriodBehavior();
    await this.demonstrateProgressiveNotifications();
    
    console.log('\n✅ All demonstrations completed!');
  }
}