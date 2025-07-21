import { SES, SNS } from 'aws-sdk';
import { NotificationMessage, UserMFAStatus } from '../types';

export interface NotificationConfig {
  emailFrom: string;
  smsRegion: string;
  emailTemplates: {
    [key: string]: {
      subject: string;
      body: string;
    };
  };
}

export class NotificationService {
  private ses: SES;
  private sns: SNS;
  private config: NotificationConfig;

  constructor(region: string, config: NotificationConfig) {
    this.ses = new SES({ region });
    this.sns = new SNS({ region });
    this.config = config;
  }

  async sendMFANotification(userStatus: UserMFAStatus, notificationMessage: NotificationMessage): Promise<void> {
    const userId = userStatus.userId;
    const daysRemaining = notificationMessage.daysRemaining || 0;

    try {
      const emailMessage = this.formatEmailMessage(notificationMessage, daysRemaining);
      await this.sendEmail(userId, emailMessage);

      const smsMessage = this.formatSMSMessage(notificationMessage, daysRemaining);
      await this.sendSMS(userId, smsMessage);

      console.log(`MFA notification sent to user ${userId}`);
    } catch (error) {
      console.error(`Error sending MFA notification to user ${userId}:`, error);
      throw error;
    }
  }

  private formatEmailMessage(notificationMessage: NotificationMessage, daysRemaining: number): {
    subject: string;
    body: string;
  } {
    const templates = this.config.emailTemplates;
    
    if (daysRemaining > 30) {
      return templates.info || {
        subject: 'セキュリティ強化のお知らせ - 多要素認証の設定について',
        body: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">セキュリティ強化のお知らせ</h2>
            <p>いつもご利用いただき、ありがとうございます。</p>
            <p>アカウントのセキュリティを強化するため、多要素認証（MFA）の設定をお願いいたします。</p>
            <p>設定方法については、以下のガイドをご参照ください：</p>
            <ul>
              <li>SMS認証の設定手順</li>
              <li>認証アプリ（TOTP）の設定手順</li>
              <li>メール認証の設定手順</li>
            </ul>
            <p>ご不明な点がございましたら、サポートまでお問い合わせください。</p>
            <p>今後ともよろしくお願いいたします。</p>
          </div>
        `
      };
    } else if (daysRemaining > 7) {
      return templates.warning || {
        subject: `【重要】多要素認証の設定期限まで${daysRemaining}日です`,
        body: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ff6b35;">重要なお知らせ</h2>
            <p>多要素認証の設定期限まで<strong>${daysRemaining}日</strong>です。</p>
            <p>お早めに設定をお願いいたします。</p>
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>設定方法：</strong></p>
              <ol>
                <li>アカウント設定ページにアクセス</li>
                <li>セキュリティ設定を選択</li>
                <li>多要素認証を有効化</li>
              </ol>
            </div>
            <p>期限を過ぎると、ログインにはMFAの設定が必要になります。</p>
          </div>
        `
      };
    } else if (daysRemaining > 0) {
      return templates.urgent || {
        subject: `【緊急】多要素認証の設定期限まで${daysRemaining}日です - 今すぐ設定してください`,
        body: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #dc3545;">緊急のお知らせ</h2>
            <p>多要素認証の設定期限まで<strong>残り${daysRemaining}日</strong>です。</p>
            <div style="background-color: #f8d7da; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #dc3545;">
              <p><strong>重要：</strong>設定しないとログインできなくなります。</p>
            </div>
            <p>今すぐ設定を完了してください。</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="#" style="background-color: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">今すぐ設定する</a>
            </div>
          </div>
        `
      };
    } else {
      return templates.expired || {
        subject: '【至急】多要素認証の設定が必要です - ログインにはMFAが必要',
        body: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #dc3545;">至急のお知らせ</h2>
            <p>多要素認証の設定期限を過ぎています。</p>
            <div style="background-color: #f8d7da; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #dc3545;">
              <p><strong>ログインにはMFAの設定が必要です。</strong></p>
            </div>
            <p>サポートまでお問い合わせいただくか、設定を完了してください。</p>
          </div>
        `
      };
    }
  }

  private formatSMSMessage(notificationMessage: NotificationMessage, daysRemaining: number): string {
    if (daysRemaining > 30) {
      return 'セキュリティ強化のため、多要素認証の設定をお願いします。詳細はメールをご確認ください。';
    } else if (daysRemaining > 7) {
      return `【重要】多要素認証の設定期限まで${daysRemaining}日です。お早めに設定をお願いします。`;
    } else if (daysRemaining > 0) {
      return `【緊急】多要素認証の設定期限まで${daysRemaining}日です。設定しないとログインできなくなります。`;
    } else {
      return '【至急】多要素認証の設定期限を過ぎています。ログインにはMFAの設定が必要です。';
    }
  }

  private async sendEmail(userId: string, message: { subject: string; body: string }): Promise<void> {
    const userEmail = await this.getUserEmail(userId);
    
    if (!userEmail) {
      console.warn(`No email found for user ${userId}, skipping email notification`);
      return;
    }

    const params = {
      Source: this.config.emailFrom,
      Destination: {
        ToAddresses: [userEmail]
      },
      Message: {
        Subject: {
          Data: message.subject,
          Charset: 'UTF-8'
        },
        Body: {
          Html: {
            Data: message.body,
            Charset: 'UTF-8'
          }
        }
      }
    };

    try {
      await this.ses.sendEmail(params).promise();
      console.log(`Email sent to ${userEmail} for user ${userId}`);
    } catch (error) {
      console.error(`Error sending email to ${userEmail}:`, error);
      throw error;
    }
  }

  private async sendSMS(userId: string, message: string): Promise<void> {
    const userPhoneNumber = await this.getUserPhoneNumber(userId);
    
    if (!userPhoneNumber) {
      console.warn(`No phone number found for user ${userId}, skipping SMS notification`);
      return;
    }

    const params = {
      PhoneNumber: userPhoneNumber,
      Message: message
    };

    try {
      await this.sns.publish(params).promise();
      console.log(`SMS sent to ${userPhoneNumber} for user ${userId}`);
    } catch (error) {
      console.error(`Error sending SMS to ${userPhoneNumber}:`, error);
      throw error;
    }
  }

  private async getUserEmail(userId: string): Promise<string | null> {
    return `user${userId}@example.com`;
  }

  private async getUserPhoneNumber(userId: string): Promise<string | null> {
    return `+81901234567${userId.slice(-1)}`;
  }

  async sendBulkNotifications(userStatuses: UserMFAStatus[]): Promise<{
    sent: number;
    failed: number;
    errors: string[];
  }> {
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const userStatus of userStatuses) {
      try {
        const currentDate = new Date();
        const deadline = userStatus.migrationDeadline || new Date('2025-09-01');
        const daysRemaining = Math.ceil((deadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

        const notificationMessage: NotificationMessage = {
          type: daysRemaining > 7 ? 'warning' : 'error',
          message: this.formatSMSMessage({ type: 'info', message: '', actionRequired: true }, daysRemaining),
          actionRequired: true,
          daysRemaining
        };

        await this.sendMFANotification(userStatus, notificationMessage);
        sent++;
      } catch (error) {
        failed++;
        errors.push(`User ${userStatus.userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      sent,
      failed,
      errors
    };
  }

  async scheduleNotification(userStatus: UserMFAStatus, scheduleDate: Date): Promise<void> {
    const now = new Date();
    const delay = scheduleDate.getTime() - now.getTime();

    if (delay <= 0) {
      console.log(`Immediate notification for user ${userStatus.userId}`);
      const notificationMessage: NotificationMessage = {
        type: 'warning',
        message: 'MFA設定の期限が近づいています',
        actionRequired: true
      };
      await this.sendMFANotification(userStatus, notificationMessage);
    } else {
      console.log(`Scheduling notification for user ${userStatus.userId} in ${delay}ms`);
      setTimeout(async () => {
        const notificationMessage: NotificationMessage = {
          type: 'warning',
          message: 'MFA設定の期限が近づいています',
          actionRequired: true
        };
        await this.sendMFANotification(userStatus, notificationMessage);
      }, delay);
    }
  }
}