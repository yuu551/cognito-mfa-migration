import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class CognitoMfaMigrationStack extends cdk.Stack {
  public readonly legacyUserPool: cognito.UserPool;
  public readonly newUserPool: cognito.UserPool;
  public readonly legacyUserPoolClient: cognito.UserPoolClient;
  public readonly newUserPoolClient: cognito.UserPoolClient;
  public readonly sesEmailIdentity: ses.EmailIdentity;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const migrationDeadline = new Date('2025-09-01');
    const projectName = 'cognito-mfa-migration';

    // SES Email Identity for notifications
    this.sesEmailIdentity = new ses.EmailIdentity(this, 'SESEmailIdentity', {
      identity: ses.Identity.email('noreply@example.com'),
      feedbackForwarding: true
    });

    // Legacy User Pool (MFA Optional)
    this.legacyUserPool = new cognito.UserPool(this, 'LegacyUserPool', {
      userPoolName: `${projectName}-legacy-pool`,
      signInAliases: {
        email: true,
        phone: true,
        username: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        },
        phoneNumber: {
          required: false,
          mutable: true
        },
        familyName: {
          required: false,
          mutable: true
        },
        givenName: {
          required: false,
          mutable: true
        }
      },
      customAttributes: {
        migrationStatus: new cognito.StringAttribute({
          mutable: true
        }),
        migrationDeadline: new cognito.StringAttribute({
          mutable: true
        }),
        lastNotified: new cognito.StringAttribute({
          mutable: true
        }),
        migratedFrom: new cognito.StringAttribute({
          mutable: true
        })
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: true
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      selfSignUpEnabled: true,
      userVerification: {
        emailSubject: 'アカウント認証のお知らせ',
        emailBody: 'こんにちは、認証コードは {####} です。',
        emailStyle: cognito.VerificationEmailStyle.CODE,
        smsMessage: '認証コードは {####} です。'
      },
      userInvitation: {
        emailSubject: 'アカウント招待のお知らせ',
        emailBody: 'ユーザー名: {username}、仮パスワード: {####}',
        smsMessage: 'ユーザー名: {username}、仮パスワード: {####}'
      },
      autoVerify: {
        email: true,
        phone: true
      },
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // New User Pool (MFA Required)
    this.newUserPool = new cognito.UserPool(this, 'NewUserPool', {
      userPoolName: `${projectName}-new-pool`,
      signInAliases: {
        email: true,
        phone: true,
        username: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        },
        phoneNumber: {
          required: true,
          mutable: true
        },
        familyName: {
          required: false,
          mutable: true
        },
        givenName: {
          required: false,
          mutable: true
        }
      },
      customAttributes: {
        migrationStatus: new cognito.StringAttribute({
          mutable: true
        }),
        migrationDate: new cognito.StringAttribute({
          mutable: true
        }),
        migratedFrom: new cognito.StringAttribute({
          mutable: true
        })
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
      },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: {
        sms: true,
        otp: true
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      selfSignUpEnabled: true,
      userVerification: {
        emailSubject: 'アカウント認証のお知らせ（MFA必須）',
        emailBody: 'こんにちは、認証コードは {####} です。この環境ではMFAの設定が必要です。',
        emailStyle: cognito.VerificationEmailStyle.CODE,
        smsMessage: '認証コードは {####} です。MFAの設定が必要です。'
      },
      userInvitation: {
        emailSubject: 'アカウント招待のお知らせ（MFA必須）',
        emailBody: 'ユーザー名: {username}、仮パスワード: {####}。MFAの設定が必要です。',
        smsMessage: 'ユーザー名: {username}、仮パスワード: {####}。MFAの設定が必要です。'
      },
      autoVerify: {
        email: true,
        phone: true
      },
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Legacy User Pool Client
    this.legacyUserPoolClient = new cognito.UserPoolClient(this, 'LegacyUserPoolClient', {
      userPool: this.legacyUserPool,
      userPoolClientName: `${projectName}-legacy-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
        adminUserPassword: true
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.PHONE
        ],
        callbackUrls: ['http://localhost:3000/callback', 'https://example.com/callback'],
        logoutUrls: ['http://localhost:3000/logout', 'https://example.com/logout']
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO
      ],
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          phoneNumber: true,
          familyName: true,
          givenName: true
        })
        .withCustomAttributes('migrationStatus', 'migrationDeadline', 'lastNotified'),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          phoneNumber: true,
          familyName: true,
          givenName: true
        })
        .withCustomAttributes('migrationStatus', 'migrationDeadline', 'lastNotified')
    });

    // New User Pool Client
    this.newUserPoolClient = new cognito.UserPoolClient(this, 'NewUserPoolClient', {
      userPool: this.newUserPool,
      userPoolClientName: `${projectName}-new-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
        adminUserPassword: true
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.PHONE
        ],
        callbackUrls: ['http://localhost:3000/callback', 'https://example.com/callback'],
        logoutUrls: ['http://localhost:3000/logout', 'https://example.com/logout']
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO
      ],
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          phoneNumber: true,
          familyName: true,
          givenName: true
        })
        .withCustomAttributes('migrationStatus', 'migrationDate', 'migratedFrom'),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          phoneNumber: true,
          familyName: true,
          givenName: true
        })
        .withCustomAttributes('migrationStatus', 'migrationDate', 'migratedFrom')
    });

    // Create admin user group in both pools
    const adminGroup = new cognito.CfnUserPoolGroup(this, 'LegacyAdminGroup', {
      userPoolId: this.legacyUserPool.userPoolId,
      groupName: 'admin',
      description: 'Administrators with elevated permissions',
      precedence: 1
    });

    const newAdminGroup = new cognito.CfnUserPoolGroup(this, 'NewAdminGroup', {
      userPoolId: this.newUserPool.userPoolId,
      groupName: 'admin',
      description: 'Administrators with elevated permissions',
      precedence: 1
    });

    // Create test user group
    const testGroup = new cognito.CfnUserPoolGroup(this, 'LegacyTestGroup', {
      userPoolId: this.legacyUserPool.userPoolId,
      groupName: 'test-users',
      description: 'Test users for MFA migration',
      precedence: 10
    });

    // Output important values
    new cdk.CfnOutput(this, 'LegacyUserPoolId', {
      value: this.legacyUserPool.userPoolId,
      description: 'Legacy User Pool ID (MFA Optional)'
    });

    new cdk.CfnOutput(this, 'NewUserPoolId', {
      value: this.newUserPool.userPoolId,
      description: 'New User Pool ID (MFA Required)'
    });

    new cdk.CfnOutput(this, 'LegacyUserPoolClientId', {
      value: this.legacyUserPoolClient.userPoolClientId,
      description: 'Legacy User Pool Client ID'
    });

    new cdk.CfnOutput(this, 'NewUserPoolClientId', {
      value: this.newUserPoolClient.userPoolClientId,
      description: 'New User Pool Client ID'
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS Region'
    });

    new cdk.CfnOutput(this, 'MigrationDeadline', {
      value: migrationDeadline.toISOString(),
      description: 'MFA Migration Deadline'
    });

    new cdk.CfnOutput(this, 'SESEmailIdentityOutput', {
      value: this.sesEmailIdentity.emailIdentityName,
      description: 'SES Email Identity for notifications'
    });

    // Add tags
    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', 'development');
    cdk.Tags.of(this).add('Purpose', 'MFA Migration Testing');
  }
}