import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  legacyUserPool: cognito.UserPool;
  newUserPool: cognito.UserPool;
  preAuthLambda: lambda.Function;
  testingLambda: lambda.Function;
  api: apigateway.RestApi;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const projectName = 'cognito-mfa-migration';

    // SNS Topic for alerts
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `${projectName}-alerts`,
      displayName: 'MFA Migration Alerts'
    });

    // Add email subscription (replace with your email)
    alertTopic.addSubscription(
      new subscriptions.EmailSubscription('admin@example.com')
    );

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'MfaMigrationDashboard', {
      dashboardName: `${projectName}-dashboard`,
      defaultInterval: cdk.Duration.hours(1)
    });

    // Cognito Metrics
    const legacyUserPoolMetrics = this.createUserPoolMetrics(props.legacyUserPool, 'Legacy Pool');
    const newUserPoolMetrics = this.createUserPoolMetrics(props.newUserPool, 'New Pool');

    // Lambda Metrics
    const preAuthLambdaMetrics = this.createLambdaMetrics(props.preAuthLambda, 'Pre-Auth Lambda');
    const testingLambdaMetrics = this.createLambdaMetrics(props.testingLambda, 'Testing Lambda');

    // API Gateway Metrics
    const apiMetrics = this.createApiMetrics(props.api, 'MFA Migration API');

    // Add widgets to dashboard
    dashboard.addWidgets(
      // Row 1: Overview
      new cloudwatch.GraphWidget({
        title: 'User Pool Authentication Overview',
        left: [
          legacyUserPoolMetrics.signInSuccesses,
          newUserPoolMetrics.signInSuccesses
        ],
        right: [
          legacyUserPoolMetrics.signInFailures,
          newUserPoolMetrics.signInFailures
        ],
        width: 12,
        height: 6
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Total Users',
        metrics: [
          legacyUserPoolMetrics.userCount,
          newUserPoolMetrics.userCount
        ],
        width: 6,
        height: 6
      }),
      new cloudwatch.SingleValueWidget({
        title: 'MFA Challenges',
        metrics: [
          legacyUserPoolMetrics.mfaChallenges,
          newUserPoolMetrics.mfaChallenges
        ],
        width: 6,
        height: 6
      })
    );

    dashboard.addWidgets(
      // Row 2: Lambda Performance
      new cloudwatch.GraphWidget({
        title: 'Lambda Function Performance',
        left: [
          preAuthLambdaMetrics.invocations,
          testingLambdaMetrics.invocations
        ],
        right: [
          preAuthLambdaMetrics.errors,
          testingLambdaMetrics.errors
        ],
        width: 12,
        height: 6
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration',
        left: [
          preAuthLambdaMetrics.duration,
          testingLambdaMetrics.duration
        ],
        width: 12,
        height: 6
      })
    );

    dashboard.addWidgets(
      // Row 3: API Performance
      new cloudwatch.GraphWidget({
        title: 'API Gateway Performance',
        left: [apiMetrics.count],
        right: [apiMetrics.errors],
        width: 12,
        height: 6
      }),
      new cloudwatch.GraphWidget({
        title: 'API Latency',
        left: [apiMetrics.latency],
        width: 12,
        height: 6
      })
    );

    // Custom Log Insights queries
    const logInsightsWidgets = this.createLogInsightsWidgets(props);
    dashboard.addWidgets(...logInsightsWidgets);

    // Alarms
    this.createAlarms(props, alertTopic);

    // Output dashboard URL
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${projectName}-dashboard`,
      description: 'CloudWatch Dashboard URL'
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      description: 'SNS Topic ARN for alerts'
    });

    // Add tags
    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', 'development');
    cdk.Tags.of(this).add('Component', 'Monitoring');
  }

  private createUserPoolMetrics(userPool: cognito.UserPool, label: string) {
    return {
      signInSuccesses: new cloudwatch.Metric({
        namespace: 'AWS/Cognito',
        metricName: 'SignInSuccesses',
        dimensionsMap: {
          UserPool: userPool.userPoolId,
          UserPoolClient: 'ALL'
        },
        statistic: 'Sum',
        label: `${label} - Sign In Successes`
      }),
      signInFailures: new cloudwatch.Metric({
        namespace: 'AWS/Cognito',
        metricName: 'SignInFailures',
        dimensionsMap: {
          UserPool: userPool.userPoolId,
          UserPoolClient: 'ALL'
        },
        statistic: 'Sum',
        label: `${label} - Sign In Failures`
      }),
      userCount: new cloudwatch.Metric({
        namespace: 'AWS/Cognito',
        metricName: 'UserCount',
        dimensionsMap: {
          UserPool: userPool.userPoolId
        },
        statistic: 'Maximum',
        label: `${label} - User Count`
      }),
      mfaChallenges: new cloudwatch.Metric({
        namespace: 'AWS/Cognito',
        metricName: 'MFAChallenges',
        dimensionsMap: {
          UserPool: userPool.userPoolId
        },
        statistic: 'Sum',
        label: `${label} - MFA Challenges`
      })
    };
  }

  private createLambdaMetrics(lambdaFunction: lambda.Function, label: string) {
    return {
      invocations: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Invocations',
        dimensionsMap: {
          FunctionName: lambdaFunction.functionName
        },
        statistic: 'Sum',
        label: `${label} - Invocations`
      }),
      errors: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: {
          FunctionName: lambdaFunction.functionName
        },
        statistic: 'Sum',
        label: `${label} - Errors`
      }),
      duration: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        dimensionsMap: {
          FunctionName: lambdaFunction.functionName
        },
        statistic: 'Average',
        label: `${label} - Duration`
      }),
      throttles: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Throttles',
        dimensionsMap: {
          FunctionName: lambdaFunction.functionName
        },
        statistic: 'Sum',
        label: `${label} - Throttles`
      })
    };
  }

  private createApiMetrics(api: apigateway.RestApi, label: string) {
    return {
      count: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'Count',
        dimensionsMap: {
          ApiName: api.restApiName
        },
        statistic: 'Sum',
        label: `${label} - Requests`
      }),
      errors: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '4XXError',
        dimensionsMap: {
          ApiName: api.restApiName
        },
        statistic: 'Sum',
        label: `${label} - 4XX Errors`
      }),
      serverErrors: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5XXError',
        dimensionsMap: {
          ApiName: api.restApiName
        },
        statistic: 'Sum',
        label: `${label} - 5XX Errors`
      }),
      latency: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'Latency',
        dimensionsMap: {
          ApiName: api.restApiName
        },
        statistic: 'Average',
        label: `${label} - Latency`
      })
    };
  }

  private createLogInsightsWidgets(props: MonitoringStackProps): cloudwatch.IWidget[] {
    const widgets: cloudwatch.IWidget[] = [];

    // MFA Migration Events
    widgets.push(
      new cloudwatch.LogQueryWidget({
        title: 'MFA Migration Events',
        logGroupNames: [
          `/aws/lambda/${props.preAuthLambda.functionName}`,
          `/aws/lambda/${props.testingLambda.functionName}`
        ],
        queryLines: [
          'fields @timestamp, @message',
          'filter @message like /MFA/ or @message like /migration/',
          'sort @timestamp desc',
          'limit 100'
        ],
        width: 24,
        height: 6
      })
    );

    // Authentication Failures
    widgets.push(
      new cloudwatch.LogQueryWidget({
        title: 'Authentication Failures',
        logGroupNames: [
          `/aws/lambda/${props.preAuthLambda.functionName}`
        ],
        queryLines: [
          'fields @timestamp, @message',
          'filter @message like /error/ or @message like /failed/ or @message like /block/',
          'sort @timestamp desc',
          'limit 50'
        ],
        width: 12,
        height: 6
      })
    );

    // Grace Period Usage
    widgets.push(
      new cloudwatch.LogQueryWidget({
        title: 'Grace Period Usage',
        logGroupNames: [
          `/aws/lambda/${props.preAuthLambda.functionName}`
        ],
        queryLines: [
          'fields @timestamp, @message',
          'filter @message like /grace period/',
          'sort @timestamp desc',
          'limit 50'
        ],
        width: 12,
        height: 6
      })
    );

    return widgets;
  }

  private createAlarms(props: MonitoringStackProps, alertTopic: sns.Topic) {
    // High error rate alarm for pre-auth lambda
    new cloudwatch.Alarm(this, 'PreAuthHighErrorRate', {
      alarmName: 'MFA-PreAuth-HighErrorRate',
      alarmDescription: 'High error rate in pre-authentication lambda',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: {
          FunctionName: props.preAuthLambda.functionName
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5)
      }),
      threshold: 10,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    }).addAlarmAction(new actions.SnsAction(alertTopic));

    // High authentication failure rate
    new cloudwatch.Alarm(this, 'HighAuthFailureRate', {
      alarmName: 'MFA-HighAuthFailureRate',
      alarmDescription: 'High authentication failure rate',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Cognito',
        metricName: 'SignInFailures',
        dimensionsMap: {
          UserPool: props.legacyUserPool.userPoolId,
          UserPoolClient: 'ALL'
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5)
      }),
      threshold: 20,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    }).addAlarmAction(new actions.SnsAction(alertTopic));

    // API Gateway high error rate
    new cloudwatch.Alarm(this, 'ApiHighErrorRate', {
      alarmName: 'MFA-API-HighErrorRate',
      alarmDescription: 'High error rate in API Gateway',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '4XXError',
        dimensionsMap: {
          ApiName: props.api.restApiName
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5)
      }),
      threshold: 15,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    }).addAlarmAction(new actions.SnsAction(alertTopic));

    // Lambda duration alarm
    new cloudwatch.Alarm(this, 'LambdaHighDuration', {
      alarmName: 'MFA-Lambda-HighDuration',
      alarmDescription: 'Lambda functions taking too long',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        dimensionsMap: {
          FunctionName: props.preAuthLambda.functionName
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5)
      }),
      threshold: 10000, // 10 seconds
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    }).addAlarmAction(new actions.SnsAction(alertTopic));
  }
}