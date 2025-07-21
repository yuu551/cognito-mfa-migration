import { CognitoIdentityServiceProvider } from 'aws-sdk';
import { CognitoUserPoolConfig } from '../types';

export interface UserPoolMigrationConfig {
  legacyPool: CognitoUserPoolConfig;
  newPool: CognitoUserPoolConfig;
  migrationStrategy: 'gradual' | 'immediate' | 'scheduled';
  migrationDeadline: Date;
}

export class MultipleUserPoolStrategy {
  private cognitoClient: CognitoIdentityServiceProvider;
  private config: UserPoolMigrationConfig;

  constructor(region: string, config: UserPoolMigrationConfig) {
    this.cognitoClient = new CognitoIdentityServiceProvider({ region });
    this.config = config;
  }

  async migrateUser(userId: string, password: string): Promise<{
    success: boolean;
    newUserId?: string;
    error?: string;
  }> {
    try {
      const legacyUser = await this.getUserFromPool(userId, this.config.legacyPool.userPoolId);
      
      if (!legacyUser) {
        return {
          success: false,
          error: 'User not found in legacy pool'
        };
      }

      const newUserId = await this.createUserInNewPool(legacyUser, password);
      
      const migrationResult = await this.transferUserData(legacyUser, newUserId);
      
      if (migrationResult.success) {
        await this.disableLegacyUser(userId);
        
        return {
          success: true,
          newUserId
        };
      } else {
        await this.rollbackUserCreation(newUserId);
        return {
          success: false,
          error: migrationResult.error
        };
      }
    } catch (error) {
      console.error(`Error migrating user ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getUserFromPool(userId: string, userPoolId: string): Promise<any> {
    try {
      const response = await this.cognitoClient.adminGetUser({
        UserPoolId: userPoolId,
        Username: userId
      }).promise();

      return response;
    } catch (error) {
      if ((error as any).code === 'UserNotFoundException') {
        return null;
      }
      throw error;
    }
  }

  async createUserInNewPool(legacyUser: any, password: string): Promise<string> {
    const userAttributes = legacyUser.UserAttributes || [];
    const email = userAttributes.find((attr: any) => attr.Name === 'email')?.Value;
    const phoneNumber = userAttributes.find((attr: any) => attr.Name === 'phone_number')?.Value;

    const createParams = {
      UserPoolId: this.config.newPool.userPoolId,
      Username: legacyUser.Username,
      UserAttributes: [
        {
          Name: 'email',
          Value: email
        },
        {
          Name: 'phone_number',
          Value: phoneNumber
        },
        {
          Name: 'custom:migrated_from',
          Value: this.config.legacyPool.userPoolId
        },
        {
          Name: 'custom:migration_date',
          Value: new Date().toISOString()
        }
      ].filter(attr => attr.Value),
      TemporaryPassword: password,
      MessageAction: 'SUPPRESS'
    };

    const response = await this.cognitoClient.adminCreateUser(createParams).promise();
    
    await this.cognitoClient.adminSetUserPassword({
      UserPoolId: this.config.newPool.userPoolId,
      Username: legacyUser.Username,
      Password: password,
      Permanent: true
    }).promise();

    return response.User?.Username || legacyUser.Username;
  }

  async transferUserData(legacyUser: any, newUserId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const userAttributes = legacyUser.UserAttributes || [];
      const customAttributes = userAttributes.filter((attr: any) => attr.Name.startsWith('custom:'));

      if (customAttributes.length > 0) {
        await this.cognitoClient.adminUpdateUserAttributes({
          UserPoolId: this.config.newPool.userPoolId,
          Username: newUserId,
          UserAttributes: customAttributes
        }).promise();
      }

      const groups = await this.cognitoClient.adminListGroupsForUser({
        UserPoolId: this.config.legacyPool.userPoolId,
        Username: legacyUser.Username
      }).promise();

      for (const group of groups.Groups || []) {
        try {
          await this.cognitoClient.adminAddUserToGroup({
            UserPoolId: this.config.newPool.userPoolId,
            Username: newUserId,
            GroupName: group.GroupName!
          }).promise();
        } catch (error) {
          console.warn(`Could not add user to group ${group.GroupName}:`, error);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error transferring user data:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async disableLegacyUser(userId: string): Promise<void> {
    await this.cognitoClient.adminDisableUser({
      UserPoolId: this.config.legacyPool.userPoolId,
      Username: userId
    }).promise();

    await this.cognitoClient.adminUpdateUserAttributes({
      UserPoolId: this.config.legacyPool.userPoolId,
      Username: userId,
      UserAttributes: [
        {
          Name: 'custom:migration_status',
          Value: 'migrated'
        },
        {
          Name: 'custom:migration_date',
          Value: new Date().toISOString()
        }
      ]
    }).promise();
  }

  async rollbackUserCreation(userId: string): Promise<void> {
    try {
      await this.cognitoClient.adminDeleteUser({
        UserPoolId: this.config.newPool.userPoolId,
        Username: userId
      }).promise();
    } catch (error) {
      console.error(`Error rolling back user creation for ${userId}:`, error);
    }
  }

  async getUserPoolMigrationStatus(): Promise<{
    legacyPoolUsers: number;
    newPoolUsers: number;
    migrationProgress: number;
    usersToMigrate: any[];
  }> {
    try {
      const [legacyUsers, newUsers] = await Promise.all([
        this.getAllUsersFromPool(this.config.legacyPool.userPoolId),
        this.getAllUsersFromPool(this.config.newPool.userPoolId)
      ]);

      const activeUsers = legacyUsers.filter(user => user.Enabled);
      const totalUsers = activeUsers.length + newUsers.length;
      const migrationProgress = totalUsers > 0 ? Math.round((newUsers.length / totalUsers) * 100) : 0;

      const usersToMigrate = activeUsers.filter(user => {
        const migrationStatus = user.UserAttributes?.find((attr: any) => attr.Name === 'custom:migration_status')?.Value;
        return migrationStatus !== 'migrated';
      });

      return {
        legacyPoolUsers: activeUsers.length,
        newPoolUsers: newUsers.length,
        migrationProgress,
        usersToMigrate
      };
    } catch (error) {
      console.error('Error getting migration status:', error);
      return {
        legacyPoolUsers: 0,
        newPoolUsers: 0,
        migrationProgress: 0,
        usersToMigrate: []
      };
    }
  }

  private async getAllUsersFromPool(userPoolId: string): Promise<any[]> {
    const allUsers: any[] = [];
    let paginationToken: string | undefined;

    do {
      const params: any = {
        UserPoolId: userPoolId,
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
  }

  async scheduleUserMigration(userId: string, migrationDate: Date): Promise<void> {
    const now = new Date();
    const delay = migrationDate.getTime() - now.getTime();

    if (delay <= 0) {
      console.log(`Immediate migration for user ${userId}`);
      await this.migrateUser(userId, this.generateTemporaryPassword());
    } else {
      console.log(`Scheduling migration for user ${userId} in ${delay}ms`);
      setTimeout(async () => {
        await this.migrateUser(userId, this.generateTemporaryPassword());
      }, delay);
    }
  }

  async batchMigrateUsers(userIds: string[], batchSize: number = 10): Promise<{
    successful: string[];
    failed: { userId: string; error: string }[];
  }> {
    const successful: string[] = [];
    const failed: { userId: string; error: string }[] = [];

    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (userId) => {
        const result = await this.migrateUser(userId, this.generateTemporaryPassword());
        if (result.success) {
          successful.push(userId);
        } else {
          failed.push({ userId, error: result.error || 'Unknown error' });
        }
      });

      await Promise.all(batchPromises);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return {
      successful,
      failed
    };
  }

  private generateTemporaryPassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  async validateMigrationReadiness(): Promise<{
    ready: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      const legacyPool = await this.cognitoClient.describeUserPool({
        UserPoolId: this.config.legacyPool.userPoolId
      }).promise();

      const newPool = await this.cognitoClient.describeUserPool({
        UserPoolId: this.config.newPool.userPoolId
      }).promise();

      if (legacyPool.UserPool?.MfaConfiguration !== 'OPTIONAL') {
        issues.push('Legacy pool should have MFA set to OPTIONAL for migration');
      }

      if (newPool.UserPool?.MfaConfiguration !== 'ON') {
        issues.push('New pool should have MFA set to ON');
      }

      if (this.config.migrationDeadline < new Date()) {
        issues.push('Migration deadline has passed');
      }

      const timeTillDeadline = this.config.migrationDeadline.getTime() - new Date().getTime();
      const daysLeft = Math.ceil(timeTillDeadline / (1000 * 60 * 60 * 24));

      if (daysLeft < 7) {
        recommendations.push('Consider extending migration deadline');
      }

      recommendations.push('Test migration with a small subset of users first');
      recommendations.push('Prepare user communication about the migration');
      recommendations.push('Set up monitoring for migration progress');

    } catch (error) {
      issues.push(`Error validating pools: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      ready: issues.length === 0,
      issues,
      recommendations
    };
  }
}