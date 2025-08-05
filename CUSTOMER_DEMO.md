# AWS Cognito MFA移行システム - お客様向けハンズオンデモガイド

このガイドでは、AWS Cognito MFA移行システムを実際にお客様の環境にデプロイし、多要素認証の段階的移行がどのように実現されるかを体験していただきます。

## 🎯 デモの目的と成果

### 体験できること
- **段階的なMFA移行プロセス**: ユーザーに配慮した移行体験

## 📋 事前準備

### 必要な環境
- **AWS アカウント**: Administrator権限
- **Node.js**: 18以上
- **AWS CLI**: 設定済み
- **AWS CDK**: `npm install -g aws-cdk`
- **Git**: リポジトリクローン用

### 確認コマンド
```bash
# 環境確認
aws sts get-caller-identity  # AWS認証確認
node --version               # Node.js 18+
cdk --version               # CDK 2.x
```

## 🚀 Step 1: 環境構築（10分）

### 1-1. リポジトリクローンとセットアップ

```bash
# リポジトリクローン
git clone https://github.com/yuu551/cognito-mfa-migration.git
cd cognito-mfa-migration

# CDK環境構築
cd cdk
npm install

# CDKブートストラップ（初回のみ）
cdk bootstrap
```

### 1-2. インフラデプロイ

```bash
# CDKスタックデプロイ（約5分）
cdk deploy

# 重要：デプロイ完了後の出力値をメモ
# - LegacyPoolId: us-east-1_xxxxxxxxx
# - LegacyClientId: xxxxxxxxxxxxxxxxxxxx
# - Region: us-east-1
```

### 1-3. フロントエンド環境設定

```bash
# フロントエンドディレクトリに移動
cd ../frontend

# 依存関係インストール
npm install

# 環境設定ファイル作成
cp .env.example .env.local

# .env.localを編集（デプロイ出力値を設定）
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_REGION=us-east-1
VITE_MFA_DEADLINE=2025-12-01  # 体験用に未来日付
```

### 1-4. フロントエンド起動

```bash
# 開発サーバー起動
npm run dev

# ブラウザで http://localhost:5173 にアクセス
```

> ✅ **確認ポイント**: ログイン画面が表示され、「MFA Migration System」のタイトルが見えること

## 👥 Step 2: デモユーザー体験（10分）

### 2-1. テストユーザー作成

```bash
# ターミナル新しいタブで cdk ディレクトリに移動
cd cognito-mfa-migration/cdk

# User Pool IDを環境変数に設定（デプロイ出力値を使用）
export USER_POOL_ID=us-east-1_xxxxxxxxx

# ユーザー1: 基本ユーザー（MFA未設定）
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username user1 \
  --user-attributes Name=email,Value=user1@demo.com Name=email_verified,Value=true \
  --temporary-password TempPass123! \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username user1 \
  --password DemoPass123! \
  --permanent

# ユーザー2: 管理者ユーザー
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username admin1 \
  --user-attributes Name=email,Value=admin@demo.com Name=email_verified,Value=true \
  --temporary-password TempPass123! \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username admin1 \
  --password DemoPass123! \
  --permanent

# ユーザー3: 営業ユーザー
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username sales1 \
  --user-attributes Name=email,Value=sales@demo.com Name=email_verified,Value=true \
  --temporary-password TempPass123! \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username sales1 \
  --password DemoPass123! \
  --permanent
```

### 2-2. 各ユーザーでのログイン体験

#### 体験1: 基本的なMFA設定体験

1. **ログイン**: 
   - ユーザー名: `user1`
   - パスワード: `DemoPass123!`

2. **ダッシュボード確認**:
   - MFA設定状況: 「未設定」の表示
   - 期限カウントダウン
   - 警告アラート

3. **MFA設定実行**:
   - 「MFA設定を開始」ボタンをクリック
   - ウィザード形式での設定
   - QRコードをGoogle Authenticator等でスキャン
   - 認証コード入力して有効化

4. **完了確認**:
   - 進捗バー: 100%に更新
   - ステータス: 「有効」に変更

#### 体験2: 他ユーザーでの比較確認

- `admin1` / `DemoPass123!` でログイン
- `sales1` / `DemoPass123!` でログイン

それぞれ同じMFA設定フローを体験し、ユーザー毎の設定状況を確認できます。

### 2-3. 期限設定による動作変化の確認

```bash
# 期限を過去に設定して制御動作を確認
# .env.local を編集
VITE_MFA_DEADLINE=2024-01-01  # 過去の日付

# フロントエンド再起動
npm run dev
```

未設定ユーザーでログインして、期限超過時の警告表示の変化を確認。