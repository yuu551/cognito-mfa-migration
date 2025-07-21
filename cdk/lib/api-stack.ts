import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  legacyUserPool: cognito.UserPool;
  newUserPool: cognito.UserPool;
  preAuthLambda: lambda.Function;
  testingLambda: lambda.Function;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const projectName = 'cognito-mfa-migration';

    // Create API Gateway
    this.api = new apigateway.RestApi(this, 'MfaMigrationApi', {
      restApiName: `${projectName}-api`,
      description: 'API for testing MFA migration patterns',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token']
      },
      deployOptions: {
        stageName: 'dev',
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true
      }
    });

    // Create Cognito Authorizer for legacy pool
    const legacyAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'LegacyAuthorizer', {
      cognitoUserPools: [props.legacyUserPool],
      authorizerName: 'LegacyUserPoolAuthorizer'
    });

    // Create Cognito Authorizer for new pool
    const newAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'NewAuthorizer', {
      cognitoUserPools: [props.newUserPool],
      authorizerName: 'NewUserPoolAuthorizer'
    });

    // Lambda integration for testing functions
    const testingIntegration = new apigateway.LambdaIntegration(props.testingLambda, {
      requestTemplates: {
        'application/json': JSON.stringify({
          httpMethod: '$context.httpMethod',
          path: '$context.path',
          queryStringParameters: '$input.params().querystring',
          body: '$input.body'
        })
      }
    });

    // Public endpoints (no authentication required)
    const publicResource = this.api.root.addResource('public');
    
    // Migration status endpoint
    const migrationStatusResource = publicResource.addResource('migration-status');
    migrationStatusResource.addMethod('GET', testingIntegration);

    // Test scenarios endpoint
    const testScenariosResource = publicResource.addResource('test-scenarios');
    testScenariosResource.addMethod('GET', testingIntegration);

    // Admin endpoints (require authentication)
    const adminResource = this.api.root.addResource('admin');
    
    // Create test user endpoint
    const createUserResource = adminResource.addResource('create-test-user');
    createUserResource.addMethod('POST', testingIntegration, {
      authorizer: legacyAuthorizer
    });

    // Send notification endpoint
    const sendNotificationResource = adminResource.addResource('send-notification');
    sendNotificationResource.addMethod('POST', testingIntegration, {
      authorizer: legacyAuthorizer
    });

    // Migrate user endpoint
    const migrateUserResource = adminResource.addResource('migrate-user');
    migrateUserResource.addMethod('POST', testingIntegration, {
      authorizer: legacyAuthorizer
    });

    // Protected endpoints for testing authentication
    const protectedResource = this.api.root.addResource('protected');
    
    // Legacy pool protected endpoint
    const legacyProtectedResource = protectedResource.addResource('legacy');
    legacyProtectedResource.addMethod('GET', testingIntegration, {
      authorizer: legacyAuthorizer
    });

    // New pool protected endpoint
    const newProtectedResource = protectedResource.addResource('new');
    newProtectedResource.addMethod('GET', testingIntegration, {
      authorizer: newAuthorizer
    });

    // Documentation endpoint
    const docsResource = this.api.root.addResource('docs');
    docsResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Content-Type': "'application/json'",
          'method.response.header.Access-Control-Allow-Origin': "'*'"
        },
        responseTemplates: {
          'application/json': JSON.stringify({
            title: 'Cognito MFA Migration API',
            version: '1.0.0',
            description: 'API for testing MFA migration patterns',
            endpoints: {
              'GET /public/migration-status': {
                description: 'Get migration progress status',
                authentication: 'None',
                response: {
                  legacyPoolUsers: 'number',
                  newPoolUsers: 'number',
                  migrationProgress: 'percentage'
                }
              },
              'GET /public/test-scenarios': {
                description: 'Run test scenarios for different time periods',
                authentication: 'None',
                response: {
                  scenarios: 'array of test scenarios'
                }
              },
              'POST /admin/create-test-user': {
                description: 'Create a test user',
                authentication: 'Legacy User Pool',
                body: {
                  username: 'string',
                  email: 'string',
                  phoneNumber: 'string (optional)',
                  userPool: 'legacy | new'
                }
              },
              'POST /admin/send-notification': {
                description: 'Send MFA notification to user',
                authentication: 'Legacy User Pool',
                body: {
                  userId: 'string',
                  userPool: 'legacy | new',
                  type: 'email | sms'
                }
              },
              'POST /admin/migrate-user': {
                description: 'Migrate user from legacy to new pool',
                authentication: 'Legacy User Pool',
                body: {
                  username: 'string',
                  password: 'string (optional)'
                }
              },
              'GET /protected/legacy': {
                description: 'Test legacy pool authentication',
                authentication: 'Legacy User Pool'
              },
              'GET /protected/new': {
                description: 'Test new pool authentication',
                authentication: 'New User Pool'
              }
            },
            examples: {
              'Create test user': {
                method: 'POST',
                endpoint: '/admin/create-test-user',
                headers: {
                  'Authorization': 'Bearer <legacy-pool-token>',
                  'Content-Type': 'application/json'
                },
                body: {
                  username: 'testuser1',
                  email: 'testuser1@example.com',
                  phoneNumber: '+819012345678',
                  userPool: 'legacy'
                }
              },
              'Check migration status': {
                method: 'GET',
                endpoint: '/public/migration-status',
                headers: {}
              },
              'Send notification': {
                method: 'POST',
                endpoint: '/admin/send-notification',
                headers: {
                  'Authorization': 'Bearer <legacy-pool-token>',
                  'Content-Type': 'application/json'
                },
                body: {
                  userId: 'testuser1',
                  userPool: 'legacy',
                  type: 'email'
                }
              }
            }
          })
        }
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Content-Type': true,
          'method.response.header.Access-Control-Allow-Origin': true
        }
      }]
    });

    // Create deployment instructions endpoint
    const deployResource = this.api.root.addResource('deploy');
    deployResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Content-Type': "'application/json'",
          'method.response.header.Access-Control-Allow-Origin': "'*'"
        },
        responseTemplates: {
          'application/json': JSON.stringify({
            title: 'デプロイ手順',
            description: 'Cognito MFA Migration パターンのデプロイと使用方法',
            steps: {
              '1. 環境準備': {
                description: 'CDK環境とAWS認証情報を設定',
                commands: [
                  'npm install -g aws-cdk',
                  'aws configure',
                  'cd cdk',
                  'npm install'
                ]
              },
              '2. デプロイ': {
                description: 'AWS環境にリソースをデプロイ',
                commands: [
                  'cdk bootstrap',
                  'cdk deploy --all'
                ]
              },
              '3. 初期設定': {
                description: 'テストユーザーの作成',
                example: {
                  method: 'POST',
                  endpoint: '/admin/create-test-user',
                  body: {
                    username: 'testuser1',
                    email: 'test@example.com',
                    userPool: 'legacy'
                  }
                }
              },
              '4. テストパターン': {
                description: '各種MFA移行パターンのテスト',
                scenarios: [
                  '期限前の警告表示テスト',
                  '期限後の猶予期間テスト',
                  'ユーザー移行テスト',
                  '通知システムテスト'
                ]
              }
            },
            environment: {
              'Legacy User Pool': 'MFA Optional',
              'New User Pool': 'MFA Required',
              'Migration Deadline': '2025-09-01',
              'Grace Period': '7 days'
            }
          })
        }
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Content-Type': true,
          'method.response.header.Access-Control-Allow-Origin': true
        }
      }]
    });

    // Output API Gateway URL
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.api.url,
      description: 'API Gateway URL for testing MFA migration patterns'
    });

    new cdk.CfnOutput(this, 'ApiDocumentation', {
      value: `${this.api.url}docs`,
      description: 'API Documentation URL'
    });

    new cdk.CfnOutput(this, 'DeploymentInstructions', {
      value: `${this.api.url}deploy`,
      description: 'Deployment Instructions URL'
    });

    new cdk.CfnOutput(this, 'TestingEndpoints', {
      value: JSON.stringify({
        'Migration Status': `${this.api.url}public/migration-status`,
        'Test Scenarios': `${this.api.url}public/test-scenarios`,
        'Create User': `${this.api.url}admin/create-test-user`,
        'Send Notification': `${this.api.url}admin/send-notification`,
        'Migrate User': `${this.api.url}admin/migrate-user`
      }),
      description: 'Key testing endpoints'
    });

    // Add tags
    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', 'development');
    cdk.Tags.of(this).add('Component', 'API');
  }
}