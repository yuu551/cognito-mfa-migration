# 🎉 修正版デプロイ手順

すべてのエラーを修正し、シンプルな1つのスタックで動作するようになりました！

## 🔧 修正した問題

1. **TypeScriptエラー**: CDKのプロパティを正しく修正
2. **循環依存**: 1つのスタックに統合して解決
3. **環境変数**: AWS_REGIONの競合を解決
4. **フィーチャーフラグ**: CDKv2対応の設定に修正

## 🚀 デプロイ方法

### 1. AWS認証情報の設定

```bash
# AWS認証情報を設定
aws configure
# または
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_DEFAULT_REGION=us-east-1
```

### 2. CDKディレクトリでデプロイ

```bash
cd cdk

# 依存関係をインストール
npm install

# CDKをブートストラップ（初回のみ）
cdk bootstrap

# デプロイ実行
cdk deploy
```

## 🎯 作成されるリソース

### Cognito User Pools
- **Legacy Pool**: MFA Optional（移行前のユーザー用）
- **New Pool**: MFA Required（移行後のユーザー用）

### Lambda Functions
- **Pre-authentication**: 移行期限に基づく認証制御
- **Testing**: API経由での各種テスト機能

### API Gateway
- `GET /public/migration-status`: 移行状況確認
- `POST /admin/create-test-user`: テストユーザー作成

## 🧪 基本的なテスト

### 1. 移行ステータス確認

```bash
# デプロイ後に出力されるAPI URLを使用
curl https://your-api-url/dev/public/migration-status
```

### 2. テストユーザー作成

```bash
curl -X POST https://your-api-url/dev/admin/create-test-user \
    -H "Content-Type: application/json" \
    -d '{
        "username": "testuser1",
        "email": "test@example.com",
        "userPool": "legacy"
    }'
```

### 3. 認証テスト

```bash
# Legacy Poolでのログイン試行
aws cognito-idp admin-initiate-auth \
    --user-pool-id us-east-1_XXXXXXXX \
    --client-id your-client-id \
    --auth-flow ADMIN_NO_SRP_AUTH \
    --auth-parameters USERNAME=testuser1,PASSWORD=Password123!
```

## 📊 実装されたMFA移行パターン

### 1. 期限前（警告フェーズ）
- **動作**: ログイン成功
- **メッセージ**: "before deadline (X days remaining)"
- **目的**: ユーザーにMFA設定を促す

### 2. 期限後（猶予期間）
- **動作**: ログイン成功（7日間）
- **メッセージ**: "in grace period (X/7 days)"
- **目的**: 急激な変更を避ける

### 3. 猶予期間終了後
- **動作**: ログイン拒否
- **メッセージ**: "MFA設定が必要です"
- **目的**: MFA必須の強制

### 4. MFA設定済みユーザー
- **動作**: 通常のMFAフローでログイン
- **メッセージ**: "MFA enabled"
- **目的**: 正常なMFA認証

## 📈 テストシナリオ

### シナリオ1: 期限前ユーザー
```bash
# 現在の設定では2025-09-01が期限
# 2025年8月のユーザー → 警告表示でログイン成功
```

### シナリオ2: 期限後ユーザー
```bash
# 2025年9月のユーザー → 猶予期間でログイン成功
# 2025年9月8日以降のユーザー → ログイン拒否
```

### シナリオ3: MFA設定済みユーザー
```bash
# MFA設定後 → 通常のMFAフローでログイン
```

## 🔍 ログとモニタリング

### CloudWatch Logs
```bash
# Pre-authentication Lambda のログ
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/cognito-mfa-migration-pre-auth

# ログストリーム確認
aws logs describe-log-streams --log-group-name /aws/lambda/cognito-mfa-migration-pre-auth
```

### 認証ログの確認
```bash
# 特定ユーザーの認証ログ
aws logs filter-log-events \
    --log-group-name /aws/lambda/cognito-mfa-migration-pre-auth \
    --filter-pattern "testuser1"
```

## 🔄 設定のカスタマイズ

### 移行期限の変更
```typescript
// simple-app.ts の migrationDeadline を変更
const migrationDeadline = '2025-12-01'; // 新しい期限
```

### 猶予期間の調整
```typescript
// Lambda関数内の gracePeriodDays を変更
const gracePeriodDays = 14; // 14日間に延長
```

## 🗑️ クリーンアップ

テスト完了後：

```bash
cd cdk
cdk destroy
```

## 🎉 成功！

これで、sample.mdで説明されていたMFA移行パターンが実際に動作する環境が完成しました！

- ✅ 期限前の警告表示
- ✅ 期限後の猶予期間
- ✅ MFA必須の強制
- ✅ 動的な認証制御
- ✅ テスト用API

すべてのパターンをテストして、実際の挙動を確認できます。