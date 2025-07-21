import { PreAuthenticationTriggerEvent, PreAuthenticationTriggerResponse } from 'aws-lambda';
import { CognitoIdentityServiceProvider } from 'aws-sdk';

interface UserAttributes {
  [key: string]: string;
}

export class PreAuthenticationHandler {
  private cognitoClient: CognitoIdentityServiceProvider;
  private migrationDeadline: Date;

  constructor(region: string, migrationDeadline: Date) {
    this.cognitoClient = new CognitoIdentityServiceProvider({ region });
    this.migrationDeadline = migrationDeadline;
  }

  async handlePreAuthentication(event: PreAuthenticationTriggerEvent): Promise<PreAuthenticationTriggerResponse> {
    const { userAttributes, request } = event;
    const userId = userAttributes.sub;
    const username = event.userName;

    console.log(`Pre-authentication trigger for user: ${username}`);

    try {
      const mfaRequired = await this.checkMFARequirement(userId, userAttributes);
      
      if (mfaRequired.required && !mfaRequired.allowLogin) {
        console.log(`MFA required for user ${username}, blocking login`);
        throw new Error('MFA設定が必要です。多要素認証を設定してからログインしてください。');
      }

      if (mfaRequired.showWarning) {
        console.log(`MFA warning for user ${username}, days remaining: ${mfaRequired.daysRemaining}`);
        await this.logMFAWarning(userId, mfaRequired.daysRemaining);
      }

      return event;
    } catch (error) {
      console.error(`Pre-authentication error for user ${username}:`, error);
      throw error;
    }
  }

  private async checkMFARequirement(userId: string, userAttributes: UserAttributes): Promise<{
    required: boolean;
    allowLogin: boolean;
    showWarning: boolean;
    daysRemaining: number;
  }> {
    const currentDate = new Date();
    const daysRemaining = Math.ceil((this.migrationDeadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    const hasMFAEnabled = await this.checkUserMFAStatus(userId);
    
    if (hasMFAEnabled) {
      return {
        required: false,
        allowLogin: true,
        showWarning: false,
        daysRemaining
      };
    }
    
    const gracePeriodDays = 7;
    
    if (currentDate > this.migrationDeadline) {
      const daysOverDeadline = Math.ceil((currentDate.getTime() - this.migrationDeadline.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysOverDeadline <= gracePeriodDays) {
        return {
          required: true,
          allowLogin: true,
          showWarning: true,
          daysRemaining: gracePeriodDays - daysOverDeadline
        };
      } else {
        return {
          required: true,
          allowLogin: false,
          showWarning: true,
          daysRemaining: 0
        };
      }
    } else {
      return {
        required: false,
        allowLogin: true,
        showWarning: daysRemaining <= 30,
        daysRemaining
      };
    }
  }

  private async checkUserMFAStatus(userId: string): Promise<boolean> {
    try {
      const userPoolId = process.env.COGNITO_USER_POOL_ID;
      if (!userPoolId) {
        throw new Error('COGNITO_USER_POOL_ID environment variable is not set');
      }

      const params = {
        UserPoolId: userPoolId,
        Username: userId
      };

      const response = await this.cognitoClient.adminGetUser(params).promise();
      const mfaOptions = response.MFAOptions || [];
      
      return mfaOptions.length > 0;
    } catch (error) {
      console.error(`Error checking MFA status for user ${userId}:`, error);
      return false;
    }
  }

  private async logMFAWarning(userId: string, daysRemaining: number): Promise<void> {
    const logEntry = {
      userId,
      event: 'mfa_warning_shown',
      daysRemaining,
      timestamp: new Date().toISOString(),
      message: this.getMFAWarningMessage(daysRemaining)
    };

    console.log('MFA Warning:', JSON.stringify(logEntry, null, 2));
  }

  private getMFAWarningMessage(daysRemaining: number): string {
    if (daysRemaining > 30) {
      return 'セキュリティ強化のため、多要素認証の設定をお願いします。';
    } else if (daysRemaining > 7) {
      return `多要素認証の設定期限まで${daysRemaining}日です。お早めに設定をお願いします。`;
    } else if (daysRemaining > 0) {
      return `多要素認証の設定期限まで${daysRemaining}日です。設定しないとログインできなくなります。`;
    } else {
      return '多要素認証の設定期限を過ぎています。ログインにはMFAの設定が必要です。';
    }
  }
}

export const handler = async (event: PreAuthenticationTriggerEvent): Promise<PreAuthenticationTriggerResponse> => {
  const migrationDeadline = new Date(process.env.MFA_MIGRATION_DEADLINE || '2025-09-01');
  const region = process.env.AWS_REGION || 'us-east-1';
  
  const preAuthHandler = new PreAuthenticationHandler(region, migrationDeadline);
  return await preAuthHandler.handlePreAuthentication(event);
};