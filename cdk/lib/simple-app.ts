#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
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
      autoVerify: {
        email: true,
        phone: true
      },
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // New User Pool (MFA Required)
    const newUserPool = new cognito.UserPool(this, 'NewUserPool', {
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
      autoVerify: {
        email: true,
        phone: true
      },
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // User Pool Clients
    const legacyUserPoolClient = new cognito.UserPoolClient(this, 'LegacyUserPoolClient', {
      userPool: legacyUserPool,
      userPoolClientName: `${projectName}-legacy-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
        adminUserPassword: true
      }
    });

    const newUserPoolClient = new cognito.UserPoolClient(this, 'NewUserPoolClient', {
      userPool: newUserPool,
      userPoolClientName: `${projectName}-new-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
        adminUserPassword: true
      }
    });

    // IAM Role for Lambda functions
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
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
                'cognito-idp:AdminDeleteUser',
                'cognito-idp:AdminDisableUser',
                'cognito-idp:AdminSetUserPassword',
                'cognito-idp:ListUsers',
                'cognito-idp:DescribeUserPool'
              ],
              resources: [
                legacyUserPool.userPoolArn,
                newUserPool.userPoolArn
              ]
            })
          ]
        })
      }
    });

    // Pre-authentication Lambda function
    const preAuthLambda = new lambda.Function(this, 'PreAuthLambda', {
      functionName: `${projectName}-pre-auth`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider();

exports.handler = async (event) => {
  console.log('Pre-authentication trigger event:', JSON.stringify(event, null, 2));
  
  const { userAttributes } = event;
  const userId = userAttributes.sub;
  const username = event.userName;
  const userPoolId = event.userPoolId;
  
  try {
    // Get migration deadline from environment variable
    const migrationDeadline = new Date(process.env.MFA_MIGRATION_DEADLINE || '2025-09-01');
    const currentDate = new Date();
    const daysRemaining = Math.ceil((migrationDeadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    console.log(\`Migration deadline: \${migrationDeadline.toISOString()}, days remaining: \${daysRemaining}\`);
    
    // Check if user has MFA enabled
    const userDetails = await cognito.adminGetUser({
      UserPoolId: userPoolId,
      Username: username
    }).promise();
    
    const mfaOptions = userDetails.MFAOptions || [];
    const hasMFA = mfaOptions.length > 0;
    
    console.log(\`User \${username} has MFA enabled: \${hasMFA}\`);
    
    // If user has MFA, allow login
    if (hasMFA) {
      console.log(\`User \${username} login allowed - MFA enabled\`);
      return event;
    }
    
    // Grace period logic
    const gracePeriodDays = 7;
    
    if (currentDate > migrationDeadline) {
      const daysOverDeadline = Math.ceil((currentDate.getTime() - migrationDeadline.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysOverDeadline <= gracePeriodDays) {
        console.log(\`User \${username} in grace period (\${daysOverDeadline}/\${gracePeriodDays} days)\`);
        return event;
      } else {
        console.log(\`User \${username} exceeded grace period, blocking login\`);
        throw new Error('MFA設定が必要です。多要素認証を設定してからログインしてください。');
      }
    } else {
      console.log(\`User \${username} login allowed - before deadline (\${daysRemaining} days remaining)\`);
      return event;
    }
  } catch (error) {
    console.error(\`Pre-authentication error for user \${username}:\`, error);
    throw error;
  }
};
      `),
      environment: {
        MFA_MIGRATION_DEADLINE: migrationDeadline,
        LEGACY_USER_POOL_ID: legacyUserPool.userPoolId,
        NEW_USER_POOL_ID: newUserPool.userPoolId
      },
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30)
    });

    // Testing Lambda function
    const testingLambda = new lambda.Function(this, 'TestingLambda', {
      functionName: `${projectName}-testing`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider();

exports.handler = async (event) => {
  console.log('Testing Lambda event:', JSON.stringify(event, null, 2));
  
  const { httpMethod, path, body } = event;
  
  try {
    if (httpMethod === 'GET' && path === '/migration-status') {
      const legacyUsers = await getAllUsersFromPool(process.env.LEGACY_USER_POOL_ID);
      const newUsers = await getAllUsersFromPool(process.env.NEW_USER_POOL_ID);
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          legacyPoolUsers: legacyUsers.length,
          newPoolUsers: newUsers.length,
          migrationDeadline: process.env.MFA_MIGRATION_DEADLINE
        })
      };
    }
    
    if (httpMethod === 'POST' && path === '/create-test-user') {
      const requestBody = JSON.parse(body || '{}');
      const { username, email, userPool = 'legacy' } = requestBody;
      
      const userPoolId = userPool === 'legacy' ? process.env.LEGACY_USER_POOL_ID : process.env.NEW_USER_POOL_ID;
      
      const params = {
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' }
        ],
        TemporaryPassword: 'TempPass123!',
        MessageAction: 'SUPPRESS'
      };
      
      const result = await cognito.adminCreateUser(params).promise();
      
      await cognito.adminSetUserPassword({
        UserPoolId: userPoolId,
        Username: username,
        Password: 'Password123!',
        Permanent: true
      }).promise();
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          message: 'Test user created successfully',
          username,
          password: 'Password123!'
        })
      };
    }
    
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Not Found' })
    };
  } catch (error) {
    console.error('Lambda error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function getAllUsersFromPool(userPoolId) {
  const allUsers = [];
  let paginationToken;
  
  do {
    const params = {
      UserPoolId: userPoolId,
      Limit: 60,
      ...(paginationToken && { PaginationToken: paginationToken })
    };
    
    const response = await cognito.listUsers(params).promise();
    allUsers.push(...(response.Users || []));
    paginationToken = response.PaginationToken;
  } while (paginationToken);
  
  return allUsers;
}
      `),
      environment: {
        MFA_MIGRATION_DEADLINE: migrationDeadline,
        LEGACY_USER_POOL_ID: legacyUserPool.userPoolId,
        NEW_USER_POOL_ID: newUserPool.userPoolId
      },
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30)
    });

    // Add the pre-authentication trigger
    legacyUserPool.addTrigger(cognito.UserPoolOperation.PRE_AUTHENTICATION, preAuthLambda);

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'MfaMigrationApi', {
      restApiName: `${projectName}-api`,
      description: 'API for testing MFA migration patterns',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key']
      },
      deployOptions: {
        stageName: 'dev'
      }
    });

    // Lambda integration
    const testingIntegration = new apigateway.LambdaIntegration(testingLambda, {
      requestTemplates: {
        'application/json': JSON.stringify({
          httpMethod: '$context.httpMethod',
          path: '$context.path',
          body: '$input.body'
        })
      }
    });

    // API endpoints
    const publicResource = api.root.addResource('public');
    
    const migrationStatusResource = publicResource.addResource('migration-status');
    migrationStatusResource.addMethod('GET', testingIntegration);

    const adminResource = api.root.addResource('admin');
    const createUserResource = adminResource.addResource('create-test-user');
    createUserResource.addMethod('POST', testingIntegration);

    // Output important values
    new cdk.CfnOutput(this, 'LegacyUserPoolId', {
      value: legacyUserPool.userPoolId,
      description: 'Legacy User Pool ID (MFA Optional)'
    });

    new cdk.CfnOutput(this, 'NewUserPoolId', {
      value: newUserPool.userPoolId,
      description: 'New User Pool ID (MFA Required)'
    });

    new cdk.CfnOutput(this, 'LegacyUserPoolClientId', {
      value: legacyUserPoolClient.userPoolClientId,
      description: 'Legacy User Pool Client ID'
    });

    new cdk.CfnOutput(this, 'NewUserPoolClientId', {
      value: newUserPoolClient.userPoolClientId,
      description: 'New User Pool Client ID'
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL'
    });

    new cdk.CfnOutput(this, 'TestingEndpoints', {
      value: JSON.stringify({
        'Migration Status': `${api.url}public/migration-status`,
        'Create User': `${api.url}admin/create-test-user`
      }),
      description: 'Testing endpoints'
    });
  }
}

const app = new cdk.App();

new CognitoMfaMigrationStack(app, 'CognitoMfaMigrationStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  },
  description: 'Cognito MFA Migration Patterns - All-in-One Stack'
});

app.synth();