#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { CognitoMfaMigrationStack } from './cognito-mfa-migration-stack';
import { LambdaStack } from './lambda-stack';
import { ApiStack } from './api-stack';
import { MonitoringStack } from './monitoring-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
};

const cognitoStack = new CognitoMfaMigrationStack(app, 'CognitoMfaMigrationStack', {
  env,
  description: 'Cognito User Pools for MFA migration testing'
});

const lambdaStack = new LambdaStack(app, 'LambdaStack', {
  env,
  description: 'Lambda functions for MFA migration patterns',
  legacyUserPoolId: cognitoStack.legacyUserPool.userPoolId,
  newUserPoolId: cognitoStack.newUserPool.userPoolId,
  sesEmailIdentity: cognitoStack.sesEmailIdentity
});

// Add the pre-authentication trigger to avoid circular dependencies
cognitoStack.legacyUserPool.addTrigger(cognito.UserPoolOperation.PRE_AUTHENTICATION, lambdaStack.preAuthLambda);

const apiStack = new ApiStack(app, 'ApiStack', {
  env,
  description: 'API Gateway for testing MFA migration patterns',
  legacyUserPool: cognitoStack.legacyUserPool,
  newUserPool: cognitoStack.newUserPool,
  preAuthLambda: lambdaStack.preAuthLambda,
  testingLambda: lambdaStack.testingLambda
});

const monitoringStack = new MonitoringStack(app, 'MonitoringStack', {
  env,
  description: 'CloudWatch monitoring for MFA migration',
  legacyUserPool: cognitoStack.legacyUserPool,
  newUserPool: cognitoStack.newUserPool,
  preAuthLambda: lambdaStack.preAuthLambda,
  testingLambda: lambdaStack.testingLambda,
  api: apiStack.api
});

app.synth();