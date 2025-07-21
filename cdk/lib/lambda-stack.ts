import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface LambdaStackProps extends cdk.StackProps {
  legacyUserPoolId: string;
  newUserPoolId: string;
  sesEmailIdentity: ses.EmailIdentity;
}

export class LambdaStack extends cdk.Stack {
  public readonly preAuthLambda: lambda.Function;
  public readonly testingLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    const projectName = 'cognito-mfa-migration';

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
                'cognito-idp:AdminEnableUser',
                'cognito-idp:AdminAddUserToGroup',
                'cognito-idp:AdminRemoveUserFromGroup',
                'cognito-idp:AdminListGroupsForUser',
                'cognito-idp:AdminSetUserMFAPreference',
                'cognito-idp:AdminSetUserSettings',
                'cognito-idp:ListUsers',
                'cognito-idp:ListGroups',
                'cognito-idp:DescribeUserPool',
                'cognito-idp:DescribeUserPoolClient'
              ],
              resources: [
                `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.legacyUserPoolId}`,
                `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.newUserPoolId}`
              ]
            })
          ]
        }),
        SESAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ses:SendEmail',
                'ses:SendRawEmail'
              ],
              resources: [
                `arn:aws:ses:${this.region}:${this.account}:identity/${props.sesEmailIdentity.emailIdentityName}`
              ]
            })
          ]
        }),
        SNSAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'sns:Publish'
              ],
              resources: ['*']
            })
          ]
        })
      }
    });

    // Pre-authentication Lambda function
    this.preAuthLambda = new lambda.Function(this, 'PreAuthLambda', {
      functionName: `${projectName}-pre-auth`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider();
const region = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION;

exports.handler = async (event) => {
  console.log('Pre-authentication trigger event:', JSON.stringify(event, null, 2));
  
  const { userAttributes, request } = event;
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
    
    // Check migration status
    const migrationStatusAttr = userDetails.UserAttributes.find(attr => attr.Name === 'custom:migrationStatus');
    const migrationStatus = migrationStatusAttr ? migrationStatusAttr.Value : 'pending';
    
    console.log(\`User \${username} migration status: \${migrationStatus}\`);
    
    // If user has MFA or migration is completed, allow login
    if (hasMFA || migrationStatus === 'completed') {
      console.log(\`User \${username} login allowed - MFA enabled or migration completed\`);
      return event;
    }
    
    // Grace period logic
    const gracePeriodDays = 7;
    
    if (currentDate > migrationDeadline) {
      const daysOverDeadline = Math.ceil((currentDate.getTime() - migrationDeadline.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysOverDeadline <= gracePeriodDays) {
        console.log(\`User \${username} in grace period (\${daysOverDeadline}/\${gracePeriodDays} days)\`);
        
        // Update last notified
        await cognito.adminUpdateUserAttributes({
          UserPoolId: userPoolId,
          Username: username,
          UserAttributes: [
            {
              Name: 'custom:lastNotified',
              Value: new Date().toISOString()
            }
          ]
        }).promise();
        
        return event;
      } else {
        console.log(\`User \${username} exceeded grace period, blocking login\`);
        throw new Error('MFA設定が必要です。多要素認証を設定してからログインしてください。');
      }
    } else {
      // Before deadline - show warning but allow login
      console.log(\`User \${username} login allowed - before deadline (\${daysRemaining} days remaining)\`);
      
      // Update last notified if it's a warning day
      const warningDays = [30, 14, 7, 3, 1];
      if (warningDays.includes(daysRemaining)) {
        await cognito.adminUpdateUserAttributes({
          UserPoolId: userPoolId,
          Username: username,
          UserAttributes: [
            {
              Name: 'custom:lastNotified',
              Value: new Date().toISOString()
            }
          ]
        }).promise();
      }
      
      return event;
    }
  } catch (error) {
    console.error(\`Pre-authentication error for user \${username}:\`, error);
    throw error;
  }
};
      `),
      environment: {
        MFA_MIGRATION_DEADLINE: '2025-09-01',
        LEGACY_USER_POOL_ID: props.legacyUserPoolId,
        NEW_USER_POOL_ID: props.newUserPoolId
      },
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_WEEK
    });

    // Testing Lambda function for API calls
    this.testingLambda = new lambda.Function(this, 'TestingLambda', {
      functionName: `${projectName}-testing`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const cognito = new AWS.CognitoIdentityServiceProvider();
const ses = new AWS.SES();
const sns = new AWS.SNS();
const region = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION;

exports.handler = async (event) => {
  console.log('Testing Lambda event:', JSON.stringify(event, null, 2));
  
  const { httpMethod, path, queryStringParameters, body } = event;
  
  try {
    if (httpMethod === 'GET' && path === '/migration-status') {
      return await getMigrationStatus();
    }
    
    if (httpMethod === 'POST' && path === '/create-test-user') {
      const requestBody = JSON.parse(body || '{}');
      return await createTestUser(requestBody);
    }
    
    if (httpMethod === 'POST' && path === '/send-notification') {
      const requestBody = JSON.parse(body || '{}');
      return await sendNotification(requestBody);
    }
    
    if (httpMethod === 'POST' && path === '/migrate-user') {
      const requestBody = JSON.parse(body || '{}');
      return await migrateUser(requestBody);
    }
    
    if (httpMethod === 'GET' && path === '/test-scenarios') {
      return await runTestScenarios();
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

async function getMigrationStatus() {
  const legacyUsers = await getAllUsersFromPool(process.env.LEGACY_USER_POOL_ID);
  const newUsers = await getAllUsersFromPool(process.env.NEW_USER_POOL_ID);
  
  const legacyActiveUsers = legacyUsers.filter(user => user.Enabled);
  const totalUsers = legacyActiveUsers.length + newUsers.length;
  const migrationProgress = totalUsers > 0 ? Math.round((newUsers.length / totalUsers) * 100) : 0;
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      legacyPoolUsers: legacyActiveUsers.length,
      newPoolUsers: newUsers.length,
      totalUsers,
      migrationProgress,
      migrationDeadline: process.env.MFA_MIGRATION_DEADLINE
    })
  };
}

async function createTestUser(requestBody) {
  const { username, email, phoneNumber, userPool = 'legacy' } = requestBody;
  
  const userPoolId = userPool === 'legacy' ? process.env.LEGACY_USER_POOL_ID : process.env.NEW_USER_POOL_ID;
  
  const params = {
    UserPoolId: userPoolId,
    Username: username,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'phone_number', Value: phoneNumber || '+819012345678' },
      { Name: 'phone_number_verified', Value: 'true' },
      { Name: 'custom:migrationStatus', Value: 'pending' },
      { Name: 'custom:migrationDeadline', Value: process.env.MFA_MIGRATION_DEADLINE }
    ],
    TemporaryPassword: 'TempPass123!',
    MessageAction: 'SUPPRESS'
  };
  
  const result = await cognito.adminCreateUser(params).promise();
  
  // Set permanent password
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
      user: result.User,
      credentials: {
        username,
        password: 'Password123!'
      }
    })
  };
}

async function sendNotification(requestBody) {
  const { userId, userPool = 'legacy', type = 'email' } = requestBody;
  
  const userPoolId = userPool === 'legacy' ? process.env.LEGACY_USER_POOL_ID : process.env.NEW_USER_POOL_ID;
  
  const userDetails = await cognito.adminGetUser({
    UserPoolId: userPoolId,
    Username: userId
  }).promise();
  
  const emailAttr = userDetails.UserAttributes.find(attr => attr.Name === 'email');
  const phoneAttr = userDetails.UserAttributes.find(attr => attr.Name === 'phone_number');
  
  const migrationDeadline = new Date(process.env.MFA_MIGRATION_DEADLINE);
  const currentDate = new Date();
  const daysRemaining = Math.ceil((migrationDeadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
  
  let message = 'セキュリティ強化のため、多要素認証の設定をお願いします。';
  if (daysRemaining <= 7 && daysRemaining > 0) {
    message = \`多要素認証の設定期限まで\${daysRemaining}日です。お早めに設定をお願いします。\`;
  } else if (daysRemaining <= 0) {
    message = '多要素認証の設定期限を過ぎています。ログインにはMFAの設定が必要です。';
  }
  
  if (type === 'email' && emailAttr) {
    await ses.sendEmail({
      Source: 'noreply@example.com',
      Destination: {
        ToAddresses: [emailAttr.Value]
      },
      Message: {
        Subject: {
          Data: 'MFA設定のお知らせ',
          Charset: 'UTF-8'
        },
        Body: {
          Text: {
            Data: message,
            Charset: 'UTF-8'
          }
        }
      }
    }).promise();
  }
  
  if (type === 'sms' && phoneAttr) {
    await sns.publish({
      PhoneNumber: phoneAttr.Value,
      Message: message
    }).promise();
  }
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      message: 'Notification sent successfully',
      type,
      recipient: type === 'email' ? emailAttr?.Value : phoneAttr?.Value,
      daysRemaining
    })
  };
}

async function migrateUser(requestBody) {
  const { username, password = 'Password123!' } = requestBody;
  
  try {
    // Get user from legacy pool
    const legacyUser = await cognito.adminGetUser({
      UserPoolId: process.env.LEGACY_USER_POOL_ID,
      Username: username
    }).promise();
    
    const userAttributes = legacyUser.UserAttributes || [];
    const email = userAttributes.find(attr => attr.Name === 'email')?.Value;
    const phoneNumber = userAttributes.find(attr => attr.Name === 'phone_number')?.Value;
    
    // Create user in new pool
    const newUserParams = {
      UserPoolId: process.env.NEW_USER_POOL_ID,
      Username: username,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'phone_number', Value: phoneNumber },
        { Name: 'phone_number_verified', Value: 'true' },
        { Name: 'custom:migrationStatus', Value: 'completed' },
        { Name: 'custom:migrationDate', Value: new Date().toISOString() },
        { Name: 'custom:migratedFrom', Value: process.env.LEGACY_USER_POOL_ID }
      ],
      TemporaryPassword: password,
      MessageAction: 'SUPPRESS'
    };
    
    const newUser = await cognito.adminCreateUser(newUserParams).promise();
    
    // Set permanent password
    await cognito.adminSetUserPassword({
      UserPoolId: process.env.NEW_USER_POOL_ID,
      Username: username,
      Password: password,
      Permanent: true
    }).promise();
    
    // Disable user in legacy pool
    await cognito.adminDisableUser({
      UserPoolId: process.env.LEGACY_USER_POOL_ID,
      Username: username
    }).promise();
    
    // Update migration status in legacy pool
    await cognito.adminUpdateUserAttributes({
      UserPoolId: process.env.LEGACY_USER_POOL_ID,
      Username: username,
      UserAttributes: [
        { Name: 'custom:migrationStatus', Value: 'migrated' },
        { Name: 'custom:migrationDate', Value: new Date().toISOString() }
      ]
    }).promise();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        message: 'User migrated successfully',
        username,
        newUserPoolId: process.env.NEW_USER_POOL_ID,
        migrationDate: new Date().toISOString()
      })
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        username
      })
    };
  }
}

async function runTestScenarios() {
  const scenarios = [
    { name: 'ユーザー1: 期限まで45日', daysFromDeadline: 45 },
    { name: 'ユーザー2: 期限まで30日', daysFromDeadline: 30 },
    { name: 'ユーザー3: 期限まで7日', daysFromDeadline: 7 },
    { name: 'ユーザー4: 期限まで1日', daysFromDeadline: 1 },
    { name: 'ユーザー5: 期限超過5日', daysFromDeadline: -5 }
  ];
  
  const results = [];
  
  for (const scenario of scenarios) {
    const migrationDeadline = new Date(process.env.MFA_MIGRATION_DEADLINE);
    const mockDate = new Date(migrationDeadline);
    mockDate.setDate(mockDate.getDate() - scenario.daysFromDeadline);
    
    const daysRemaining = Math.ceil((migrationDeadline.getTime() - mockDate.getTime()) / (1000 * 60 * 60 * 24));
    
    let mfaRequired = false;
    let allowLogin = true;
    let message = '';
    
    if (daysRemaining <= 0) {
      const gracePeriodDays = 7;
      const daysOverDeadline = Math.abs(daysRemaining);
      
      if (daysOverDeadline <= gracePeriodDays) {
        mfaRequired = true;
        allowLogin = true;
        message = \`猶予期間中(\${daysOverDeadline}/\${gracePeriodDays}日)\`;
      } else {
        mfaRequired = true;
        allowLogin = false;
        message = '猶予期間終了、ログイン不可';
      }
    } else if (daysRemaining <= 30) {
      mfaRequired = false;
      allowLogin = true;
      message = \`警告表示(\${daysRemaining}日前)\`;
    } else {
      mfaRequired = false;
      allowLogin = true;
      message = '通常状態';
    }
    
    results.push({
      scenario: scenario.name,
      daysRemaining,
      mfaRequired,
      allowLogin,
      message
    });
  }
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      scenarios: results,
      migrationDeadline: process.env.MFA_MIGRATION_DEADLINE,
      currentDate: new Date().toISOString()
    })
  };
}

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
        MFA_MIGRATION_DEADLINE: '2025-09-01',
        LEGACY_USER_POOL_ID: props.legacyUserPoolId,
        NEW_USER_POOL_ID: props.newUserPoolId
      },
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_WEEK
    });

    // Note: The pre-authentication trigger will be added to the legacy user pool 
    // in the app.ts file to avoid circular dependencies
    // props.legacyUserPool.addTrigger(cognito.UserPoolOperation.PRE_AUTHENTICATION, this.preAuthLambda);

    // Output Lambda function ARNs
    new cdk.CfnOutput(this, 'PreAuthLambdaArn', {
      value: this.preAuthLambda.functionArn,
      description: 'Pre-authentication Lambda function ARN'
    });

    new cdk.CfnOutput(this, 'TestingLambdaArn', {
      value: this.testingLambda.functionArn,
      description: 'Testing Lambda function ARN'
    });

    // Add tags
    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', 'development');
    cdk.Tags.of(this).add('Component', 'Lambda');
  }
}