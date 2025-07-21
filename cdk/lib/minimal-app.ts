#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class CognitoMfaMigrationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const projectName = 'cognito-mfa-migration';
    const migrationDeadline = '2025-09-01';

    // Legacy User Pool (MFA Optional)
    const legacyUserPool = new cognito.UserPool(this, 'LegacyUserPool', {
      userPoolName: `${projectName}-legacy-pool`,
      signInAliases: {
        email: true,
        username: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        }
      },
      customAttributes: {
        migrationStatus: new cognito.StringAttribute({
          mutable: true
        }),
        migrationDeadline: new cognito.StringAttribute({
          mutable: true
        })
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: true
      },
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // New User Pool (MFA Required)
    const newUserPool = new cognito.UserPool(this, 'NewUserPool', {
      userPoolName: `${projectName}-new-pool`,
      signInAliases: {
        email: true,
        username: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        }
      },
      customAttributes: {
        migrationStatus: new cognito.StringAttribute({
          mutable: true
        })
      },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: {
        sms: true,
        otp: true
      },
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // User Pool Clients
    const legacyClient = new cognito.UserPoolClient(this, 'LegacyClient', {
      userPool: legacyUserPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO
      ],
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          emailVerified: true,
          phoneNumber: true,
          phoneNumberVerified: true,
          preferredUsername: true
        })
        .withCustomAttributes('migrationStatus', 'migrationDeadline'),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          phoneNumber: true,
          preferredUsername: true
        })
        .withCustomAttributes('migrationStatus', 'migrationDeadline')
    });

    const newClient = new cognito.UserPoolClient(this, 'NewClient', {
      userPool: newUserPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO
      ],
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          emailVerified: true,
          phoneNumber: true,
          phoneNumberVerified: true,
          preferredUsername: true
        }),
      writeAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({
          email: true,
          phoneNumber: true,
          preferredUsername: true
        })
    });

    // Lambda Role
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        CognitoAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-idp:AdminGetUser',
                'cognito-idp:AdminUpdateUserAttributes',
                'cognito-idp:AdminCreateUser',
                'cognito-idp:AdminSetUserPassword',
                'cognito-idp:ListUsers'
              ],
              resources: ['*']
            })
          ]
        })
      }
    });

    // Pre-authentication Lambda
    const preAuthLambda = new lambda.Function(this, 'PreAuthFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
exports.handler = async (event) => {
  console.log('Pre-authentication event:', JSON.stringify(event, null, 2));
  
  const { userAttributes } = event;
  const username = event.userName;
  
  try {
    // Check migration deadline
    const migrationDeadline = new Date('${migrationDeadline}');
    const currentDate = new Date();
    const daysRemaining = Math.ceil((migrationDeadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    console.log(\`User: \${username}, Days remaining: \${daysRemaining}\`);
    
    // Simple logic for demonstration
    if (currentDate > migrationDeadline) {
      const gracePeriodDays = 7;
      const daysOverDeadline = Math.ceil((currentDate.getTime() - migrationDeadline.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysOverDeadline > gracePeriodDays) {
        console.log(\`User \${username} exceeded grace period, blocking login\`);
        throw new Error('MFA設定が必要です。多要素認証を設定してからログインしてください。');
      } else {
        console.log(\`User \${username} in grace period (\${daysOverDeadline}/\${gracePeriodDays} days)\`);
      }
    } else {
      console.log(\`User \${username} login allowed - before deadline (\${daysRemaining} days remaining)\`);
    }
    
    return event;
  } catch (error) {
    console.error('Pre-authentication error:', error);
    throw error;
  }
};
      `),
      role: lambdaRole
    });

    // Add trigger to user pool
    legacyUserPool.addTrigger(cognito.UserPoolOperation.PRE_AUTHENTICATION, preAuthLambda);

    // Output values
    new cdk.CfnOutput(this, 'LegacyPoolId', {
      value: legacyUserPool.userPoolId,
      description: 'Legacy User Pool ID (MFA Optional)'
    });

    new cdk.CfnOutput(this, 'NewPoolId', {
      value: newUserPool.userPoolId,
      description: 'New User Pool ID (MFA Required)'
    });

    new cdk.CfnOutput(this, 'LegacyClientId', {
      value: legacyClient.userPoolClientId,
      description: 'Legacy Client ID'
    });

    new cdk.CfnOutput(this, 'NewClientId', {
      value: newClient.userPoolClientId,
      description: 'New Client ID'
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS Region'
    });

    new cdk.CfnOutput(this, 'TestInstructions', {
      value: JSON.stringify({
        '1. Create test user': `aws cognito-idp admin-create-user --user-pool-id ${legacyUserPool.userPoolId} --username testuser1 --user-attributes Name=email,Value=test@example.com Name=email_verified,Value=true --temporary-password TempPass123! --message-action SUPPRESS`,
        '2. Set permanent password': `aws cognito-idp admin-set-user-password --user-pool-id ${legacyUserPool.userPoolId} --username testuser1 --password Password123! --permanent`,
        '3. Test login': `aws cognito-idp admin-initiate-auth --user-pool-id ${legacyUserPool.userPoolId} --client-id ${legacyClient.userPoolClientId} --auth-flow ADMIN_NO_SRP_AUTH --auth-parameters USERNAME=testuser1,PASSWORD=Password123!`
      }, null, 2),
      description: 'Testing commands'
    });
  }
}

const app = new cdk.App();

new CognitoMfaMigrationStack(app, 'CognitoMfaMigrationStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  }
});

app.synth();