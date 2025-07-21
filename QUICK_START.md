# 🚀 クイックスタート手順

## 1. AWS認証情報の設定

以下のいずれかの方法で設定してください：

### 方法1: AWS CLI設定
```bash
aws configure
```

以下を入力してください：
- AWS Access Key ID: [あなたのアクセスキー]
- AWS Secret Access Key: [あなたのシークレットキー]
- Default region name: us-east-1 (またはお好みのリージョン)
- Default output format: json

### 方法2: 環境変数設定
```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_DEFAULT_REGION=us-east-1
```

### 方法3: AWS SSOを使用している場合
```bash
aws sso login
```

## 2. デプロイ実行

```bash
# 自動デプロイ
./deploy.sh --deploy

# または手動デプロイ
cd cdk
cdk bootstrap
cdk deploy --all
```

## 3. テスト実行

```bash
# 基本テスト
./deploy.sh --test

# 手動テスト
curl https://your-api-url/dev/public/migration-status
```

## 4. 管理者ユーザーの作成（オプション）

デプロイ後、管理者ユーザーを作成して認証テストを実行できます：

```bash
# 管理者ユーザー作成
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

## 5. 各種機能のテスト

### 移行ステータス確認
```bash
curl https://your-api-url/dev/public/migration-status
```

### テストシナリオ実行
```bash
curl https://your-api-url/dev/public/test-scenarios
```

### テストユーザー作成
```bash
curl -X POST https://your-api-url/dev/admin/create-test-user \
    -H "Authorization: Bearer YOUR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "username": "testuser1",
        "email": "test@example.com",
        "userPool": "legacy"
    }'
```

## 6. クリーンアップ

テスト完了後：

```bash
./deploy.sh --cleanup
```

## 🎯 主な確認ポイント

1. **Legacy Pool (MFA Optional)**: MFA設定前でもログイン可能
2. **New Pool (MFA Required)**: MFA設定必須
3. **Pre-Auth Lambda**: 期限に基づく動的制御
4. **Migration Status**: 移行進捗の追跡
5. **Notifications**: 段階的な通知システム

## 📊 リソース確認

デプロイ完了後、以下のリソースが作成されます：

- **Cognito User Pools**: Legacy (Optional MFA) + New (Required MFA)
- **Lambda Functions**: Pre-authentication + Testing
- **API Gateway**: 管理・テスト用エンドポイント
- **CloudWatch**: ダッシュボード + アラート
- **SES**: メール通知用

## 🔧 トラブルシューティング

### よくある問題
1. **権限エラー**: IAM権限を確認
2. **リージョン設定**: 全リソースが同じリージョンか確認
3. **MFA設定**: 電話番号やメール認証が正しく設定されているか確認

### ログ確認
```bash
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/cognito-mfa-migration
```

これで、すべてのMFA移行パターンをテストできます！