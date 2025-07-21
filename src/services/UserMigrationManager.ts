import { CognitoIdentityServiceProvider } from 'aws-sdk';
import { UserMFAStatus, MFAMigrationSettings } from '../types';

export class UserMigrationManager {
  private cognitoClient: CognitoIdentityServiceProvider;
  private userPoolId: string;
  private migrationSettings: MFAMigrationSettings;
  private userStatuses: Map<string, UserMFAStatus> = new Map();

  constructor(userPoolId: string, region: string, migrationSettings: MFAMigrationSettings) {
    this.cognitoClient = new CognitoIdentityServiceProvider({ region });
    this.userPoolId = userPoolId;
    this.migrationSettings = migrationSettings;
  }

  async getUserMFAStatus(userId: string): Promise<UserMFAStatus> {
    if (this.userStatuses.has(userId)) {
      return this.userStatuses.get(userId)!;
    }

    try {
      const userDetails = await this.cognitoClient.adminGetUser({
        UserPoolId: this.userPoolId,
        Username: userId
      }).promise();

      const mfaOptions = userDetails.MFAOptions || [];
      const userAttributes = userDetails.UserAttributes || [];
      
      const migrationStatusAttr = userAttributes.find(attr => attr.Name === 'custom:migration_status');
      const migrationDeadlineAttr = userAttributes.find(attr => attr.Name === 'custom:migration_deadline');
      const lastNotifiedAttr = userAttributes.find(attr => attr.Name === 'custom:last_notified');

      const status: UserMFAStatus = {
        userId,
        mfaEnabled: mfaOptions.length > 0,
        mfaMethods: mfaOptions.map(option => option.DeliveryMedium || 'UNKNOWN'),
        migrationStatus: (migrationStatusAttr?.Value as any) || 'pending',
        migrationDeadline: migrationDeadlineAttr?.Value 
          ? new Date(migrationDeadlineAttr.Value) 
          : this.migrationSettings.migrationDeadline,
        lastNotified: lastNotifiedAttr?.Value ? new Date(lastNotifiedAttr.Value) : undefined
      };

      this.userStatuses.set(userId, status);
      return status;
    } catch (error) {
      console.error(`Error getting MFA status for user ${userId}:`, error);
      
      const defaultStatus: UserMFAStatus = {
        userId,
        mfaEnabled: false,
        mfaMethods: [],
        migrationStatus: 'pending',
        migrationDeadline: this.migrationSettings.migrationDeadline
      };

      this.userStatuses.set(userId, defaultStatus);
      return defaultStatus;
    }
  }

  async updateUserMigrationStatus(userId: string, status: 'pending' | 'in_progress' | 'completed'): Promise<void> {
    try {
      await this.cognitoClient.adminUpdateUserAttributes({
        UserPoolId: this.userPoolId,
        Username: userId,
        UserAttributes: [
          {
            Name: 'custom:migration_status',
            Value: status
          },
          {
            Name: 'custom:last_updated',
            Value: new Date().toISOString()
          }
        ]
      }).promise();

      const currentStatus = await this.getUserMFAStatus(userId);
      currentStatus.migrationStatus = status;
      this.userStatuses.set(userId, currentStatus);

      console.log(`Updated migration status for user ${userId}: ${status}`);
    } catch (error) {
      console.error(`Error updating migration status for user ${userId}:`, error);
      throw error;
    }
  }

  async updateLastNotified(userId: string): Promise<void> {
    try {
      const now = new Date();
      
      await this.cognitoClient.adminUpdateUserAttributes({
        UserPoolId: this.userPoolId,
        Username: userId,
        UserAttributes: [
          {
            Name: 'custom:last_notified',
            Value: now.toISOString()
          }
        ]
      }).promise();

      const currentStatus = await this.getUserMFAStatus(userId);
      currentStatus.lastNotified = now;
      this.userStatuses.set(userId, currentStatus);

      console.log(`Updated last notified for user ${userId}: ${now.toISOString()}`);
    } catch (error) {
      console.error(`Error updating last notified for user ${userId}:`, error);
      throw error;
    }
  }

  async getMigrationProgress(): Promise<{
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
    percentage: number;
    overdue: number;
  }> {
    try {
      const users = await this.getAllUsers();
      const currentDate = new Date();
      
      let completed = 0;
      let pending = 0;
      let inProgress = 0;
      let overdue = 0;

      for (const user of users) {
        const status = await this.getUserMFAStatus(user.Username!);
        
        if (status.mfaEnabled || status.migrationStatus === 'completed') {
          completed++;
        } else if (status.migrationStatus === 'in_progress') {
          inProgress++;
        } else {
          pending++;
          
          if (currentDate > (status.migrationDeadline || this.migrationSettings.migrationDeadline)) {
            overdue++;
          }
        }
      }

      const total = users.length;
      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        total,
        completed,
        pending,
        inProgress,
        percentage,
        overdue
      };
    } catch (error) {
      console.error('Error getting migration progress:', error);
      return {
        total: 0,
        completed: 0,
        pending: 0,
        inProgress: 0,
        percentage: 0,
        overdue: 0
      };
    }
  }

  async getUsersNeedingNotification(): Promise<UserMFAStatus[]> {
    try {
      const users = await this.getAllUsers();
      const usersNeedingNotification: UserMFAStatus[] = [];
      const currentDate = new Date();

      for (const user of users) {
        const status = await this.getUserMFAStatus(user.Username!);
        
        if (status.mfaEnabled || status.migrationStatus === 'completed') {
          continue;
        }

        const deadline = status.migrationDeadline || this.migrationSettings.migrationDeadline;
        const daysRemaining = Math.ceil((deadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

        const shouldNotify = this.shouldNotifyUser(status, daysRemaining);
        
        if (shouldNotify) {
          usersNeedingNotification.push(status);
        }
      }

      return usersNeedingNotification;
    } catch (error) {
      console.error('Error getting users needing notification:', error);
      return [];
    }
  }

  private shouldNotifyUser(status: UserMFAStatus, daysRemaining: number): boolean {
    if (this.migrationSettings.warningDays.includes(daysRemaining)) {
      return true;
    }

    if (daysRemaining <= 0) {
      return true;
    }

    const lastNotified = status.lastNotified;
    if (!lastNotified) {
      return true;
    }

    const daysSinceLastNotification = Math.ceil((new Date().getTime() - lastNotified.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceLastNotification >= 7;
  }

  private async getAllUsers(): Promise<any[]> {
    try {
      const allUsers: any[] = [];
      let paginationToken: string | undefined;

      do {
        const params: any = {
          UserPoolId: this.userPoolId,
          Limit: 60
        };

        if (paginationToken) {
          params.PaginationToken = paginationToken;
        }

        const response = await this.cognitoClient.listUsers(params).promise();
        allUsers.push(...(response.Users || []));
        paginationToken = response.PaginationToken;
      } while (paginationToken);

      return allUsers;
    } catch (error) {
      console.error('Error getting all users:', error);
      throw error;
    }
  }

  async generateMigrationReport(): Promise<{
    generatedAt: string;
    summary: any;
    usersByStatus: any;
    upcomingDeadlines: any[];
  }> {
    const progress = await this.getMigrationProgress();
    const usersNeedingNotification = await this.getUsersNeedingNotification();
    
    const usersByStatus = {
      completed: progress.completed,
      inProgress: progress.inProgress,
      pending: progress.pending,
      overdue: progress.overdue
    };

    const upcomingDeadlines = usersNeedingNotification.map(user => ({
      userId: user.userId,
      status: user.migrationStatus,
      deadline: user.migrationDeadline?.toISOString(),
      daysRemaining: Math.ceil(((user.migrationDeadline || this.migrationSettings.migrationDeadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    }));

    return {
      generatedAt: new Date().toISOString(),
      summary: progress,
      usersByStatus,
      upcomingDeadlines
    };
  }
}