# 🚀 Cognito MFA Migration Patterns - デプロイ手順

このガイドでは、AWS CDKを使用してCognito MFA移行パターンの実装環境をデプロイし、テストする方法を説明します。

## 📋 前提条件

### 必要な環境
- **Node.js**: 18.x 以上
- **AWS CLI**: 2.x 以上
- **AWS CDK**: 2.x 以上
- **AWS アカウント**: 有効なアカウントとIAMアクセス権限

### 必要なAWS権限
以下のサービスに対する権限が必要です：
- Amazon Cognito (User Pools)
- AWS Lambda
- Amazon API Gateway
- Amazon SES
- Amazon SNS
- Amazon CloudWatch
- AWS IAM

## 🔧 セットアップ手順

### 1. プロジェクトのクローンと依存関係のインストール

```bash
# プロジェクトディレクトリに移動
cd sample-cognito

# メインプロジェクトの依存関係をインストール
npm install

# CDKディレクトリの依存関係をインストール
cd cdk
npm install
```

### 2. AWS認証情報の設定

```bash
# AWS認証情報を設定
aws configure

# または、環境変数で設定
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_DEFAULT_REGION=us-east-1
```

### 3. CDK環境の初期化

```bash
# CDKディレクトリで実行
cd cdk

# CDKをブートストラップ（初回のみ）
cdk bootstrap

# 変更内容を確認
cdk diff

# 全スタックをデプロイ
cdk deploy --all
```

### 4. デプロイ結果の確認

デプロイが完了すると、以下の出力が表示されます：

```
CognitoMfaMigrationStack
├── LegacyUserPoolId: us-east-1_XXXXXXXX
├── NewUserPoolId: us-east-1_YYYYYYYY
├── LegacyUserPoolClientId: xxxxxxxxxxxxxxxxx
├── NewUserPoolClientId: yyyyyyyyyyyyyyyyy
├── Region: us-east-1
├── MigrationDeadline: 2025-09-01T00:00:00.000Z
└── SESEmailIdentity: noreply@example.com

LambdaStack
├── PreAuthLambdaArn: arn:aws:lambda:us-east-1:xxxx:function:cognito-mfa-migration-pre-auth
└── TestingLambdaArn: arn:aws:lambda:us-east-1:xxxx:function:cognito-mfa-migration-testing

ApiStack
├── ApiGatewayUrl: https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/dev/
├── ApiDocumentation: https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/dev/docs
├── DeploymentInstructions: https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/dev/deploy
└── TestingEndpoints: {...}

MonitoringStack
├── DashboardUrl: https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=cognito-mfa-migration-dashboard
└── AlertTopicArn: arn:aws:sns:us-east-1:xxxx:cognito-mfa-migration-alerts
```

## 🧪 テスト手順

### 1. API エンドポイントの確認

デプロイ後、以下のURLにアクセスしてAPIドキュメントを確認：

```bash
# API ドキュメント
curl https://your-api-gateway-url/dev/docs

# デプロイ手順
curl https://your-api-gateway-url/dev/deploy
```

### 2. テストユーザーの作成

まず、管理者ユーザーを作成してアクセストークンを取得します：

```bash
# AWS CLIでテストユーザーを作成
aws cognito-idp admin-create-user \
    --user-pool-id us-east-1_XXXXXXXX \
    --username admin \
    --user-attributes Name=email,Value=admin@example.com Name=email_verified,Value=true \
    --temporary-password TempPass123! \
    --message-action SUPPRESS

# パスワードを永続化
aws cognito-idp admin-set-user-password \
    --user-pool-id us-east-1_XXXXXXXX \
    --username admin \
    --password AdminPass123! \
    --permanent
```

### 3. アクセストークンの取得

```bash
# 管理者ユーザーでログイン
aws cognito-idp admin-initiate-auth \
    --user-pool-id us-east-1_XXXXXXXX \
    --client-id your-client-id \
    --auth-flow ADMIN_NO_SRP_AUTH \
    --auth-parameters USERNAME=admin,PASSWORD=AdminPass123!
```

### 4. API経由でのテストユーザー作成

```bash
# テストユーザーを作成
curl -X POST \
    https://your-api-gateway-url/dev/admin/create-test-user \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "testuser1",
        "email": "testuser1@example.com",
        "phoneNumber": "+819012345678",
        "userPool": "legacy"
    }'
```

## 🔄 MFA移行パターンのテスト

### 1. 移行ステータスの確認

```bash
# 移行進捗の確認
curl https://your-api-gateway-url/dev/public/migration-status
```

### 2. 各種シナリオのテスト

```bash
# テストシナリオの実行
curl https://your-api-gateway-url/dev/public/test-scenarios
```

### 3. 通知システムのテスト

```bash
# メール通知の送信
curl -X POST \
    https://your-api-gateway-url/dev/admin/send-notification \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "userId": "testuser1",
        "userPool": "legacy",
        "type": "email"
    }'
```

### 4. ユーザー移行のテスト

```bash
# ユーザーを新しいプールに移行
curl -X POST \
    https://your-api-gateway-url/dev/admin/migrate-user \
    -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "testuser1",
        "password": "NewPassword123!"
    }'
```

### 5. 認証テストの実行

```bash
# レガシープールでの認証テスト
curl -X GET \
    https://your-api-gateway-url/dev/protected/legacy \
    -H "Authorization: Bearer LEGACY_POOL_TOKEN"

# 新プールでの認証テスト
curl -X GET \
    https://your-api-gateway-url/dev/protected/new \
    -H "Authorization: Bearer NEW_POOL_TOKEN"
```

## 📊 モニタリングとログ確認

### 1. CloudWatch ダッシュボード

デプロイ後、以下のURLでCloudWatchダッシュボードを確認：

```
https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=cognito-mfa-migration-dashboard
```

### 2. Lambda ログの確認

```bash
# Pre-authenticationログの確認
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/cognito-mfa-migration-pre-auth

# テスト用Lambdaログの確認
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/cognito-mfa-migration-testing
```

### 3. アラートの設定

```bash
# SNSトピックの確認
aws sns list-topics --query 'Topics[?contains(TopicArn, `cognito-mfa-migration-alerts`)]'

# メール通知の設定
aws sns subscribe \
    --topic-arn arn:aws:sns:us-east-1:xxxx:cognito-mfa-migration-alerts \
    --protocol email \
    --notification-endpoint your-email@example.com
```

## 🧪 実際のテストシナリオ

### シナリオ1: 期限前のユーザーログイン

```bash
# テストユーザーでログイン試行
aws cognito-idp admin-initiate-auth \
    --user-pool-id us-east-1_XXXXXXXX \
    --client-id your-client-id \
    --auth-flow ADMIN_NO_SRP_AUTH \
    --auth-parameters USERNAME=testuser1,PASSWORD=Password123!

# 期待される結果: ログイン成功、警告メッセージ表示
```

### シナリオ2: 期限後のユーザーログイン（猶予期間中）

```bash
# 移行期限を過去の日付に設定してテスト
# Lambda環境変数 MFA_MIGRATION_DEADLINE を変更

# ログイン試行
aws cognito-idp admin-initiate-auth \
    --user-pool-id us-east-1_XXXXXXXX \
    --client-id your-client-id \
    --auth-flow ADMIN_NO_SRP_AUTH \
    --auth-parameters USERNAME=testuser1,PASSWORD=Password123!

# 期待される結果: ログイン成功、猶予期間警告
```

### シナリオ3: 猶予期間終了後のログイン

```bash
# 猶予期間を過ぎた設定でテスト
# 期待される結果: ログイン失敗、MFA設定要求
```

### シナリオ4: MFA設定済みユーザーのログイン

```bash
# ユーザーにMFAを設定後のログイン試行
# 期待される結果: 通常のMFAフローでログイン成功
```

## 🔄 継続的なテスト

### 1. 定期的なヘルスチェック

```bash
# ヘルスチェック用スクリプト
#!/bin/bash
API_URL="https://your-api-gateway-url/dev"

echo "=== Migration Status Check ==="
curl -s "$API_URL/public/migration-status" | jq '.'

echo "=== Test Scenarios ==="
curl -s "$API_URL/public/test-scenarios" | jq '.'

echo "=== API Health Check ==="
curl -s "$API_URL/docs" | jq '.title'
```

### 2. 自動化されたテスト

```bash
# package.jsonにテストスクリプトを追加
{
  "scripts": {
    "test:deploy": "cd cdk && cdk deploy --all",
    "test:api": "node scripts/test-api.js",
    "test:scenarios": "node scripts/test-scenarios.js"
  }
}
```

## 🗑️ クリーンアップ

テスト完了後、リソースを削除：

```bash
# 全スタックを削除
cd cdk
cdk destroy --all

# 確認プロンプトでyesを選択
```

## 📚 追加リソース

### 1. ドキュメント
- [AWS Cognito MFA Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa.html)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/v2/guide/)

### 2. トラブルシューティング
- CloudWatch Logsで詳細なエラーログを確認
- IAM権限が適切に設定されているか確認
- リージョンの設定が一致しているか確認

### 3. カスタマイズ
- `cdk/lib/`の各スタックファイルを編集してカスタマイズ
- 環境変数やパラメータを調整
- 追加のテストシナリオを実装

## 🎯 本番環境への適用

このテスト環境で検証したパターンを本番環境に適用する際の注意点：

1. **段階的な展開**: 少数のユーザーから開始
2. **監視とアラート**: 詳細なモニタリングを設定
3. **ロールバック計画**: 問題発生時の対応手順を準備
4. **ユーザー通知**: 移行計画をユーザーに事前通知
5. **サポート体制**: 移行期間中のサポート体制を強化

これで、Cognito MFA移行パターンの完全なテスト環境が構築され、各パターンの動作を確認できます！