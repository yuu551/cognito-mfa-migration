# AWS Cognito MFA移行システム - お客様向けハンズオンデモガイド

このガイドでは、AWS Cognito MFA移行システムを実際にお客様の環境にデプロイし、多要素認証の段階的移行がどのように実現されるかを体験していただきます。

## 🎯 デモの目的と成果

### 体験できること
- **段階的なMFA移行プロセス**: ユーザーに配慮した移行体験
- **リアルタイム進捗管理**: 移行状況の可視化
- **自動化されたセキュリティ強化**: 技術的な実装パターン
- **実際のビジネス価値**: セキュリティとユーザビリティの両立

### 所要時間
- 合計: **30-45分**
- 環境構築: 10分
- ユーザー体験: 20分  
- 管理者確認: 10-15分

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

## 🚀 Phase 1: 環境構築（10分）

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
VITE_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=us-east-1
VITE_MFA_DEADLINE=2025-12-01  # 体験用に未来日付
```

### 1-4. フロントエンド起動

```bash
# 開発サーバー起動
npm run dev

# ブラウザで http://localhost:5173 にアクセス
```

> ✅ **確認ポイント**: ログイン画面が表示され、「MFA Migration System」のタイトルが見えること

## 👥 Phase 2: ユーザー体験シナリオ（20分）

### 2-1. デモユーザー作成

異なる段階のユーザーを作成して、移行プロセスを体験します。

```bash
# ターミナル新しいタブで cdk ディレクトリに移動
cd cognito-mfa-migration/cdk

# User Pool IDを環境変数に設定（デプロイ出力値を使用）
export USER_POOL_ID=us-east-1_xxxxxxxxx

# シナリオ1: MFA未設定の一般ユーザー
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username demo-user-basic \
  --user-attributes Name=email,Value=basic@demo-company.com Name=email_verified,Value=true \
  --temporary-password TempDemo123! \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username demo-user-basic \
  --password DemoPass123! \
  --permanent

# シナリオ2: IT管理者（セキュリティ意識の高いユーザー）
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username demo-admin \
  --user-attributes Name=email,Value=admin@demo-company.com Name=email_verified,Value=true \
  --temporary-password TempDemo123! \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username demo-admin \
  --password DemoPass123! \
  --permanent

# シナリオ3: 営業担当（外出が多い）
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username demo-sales \
  --user-attributes Name=email,Value=sales@demo-company.com Name=email_verified,Value=true \
  --temporary-password TempDemo123! \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username demo-sales \
  --password DemoPass123! \
  --permanent
```

### 2-2. ユーザー体験シナリオ実行

#### シナリオA: 一般ユーザーの初回体験

1. **ログイン**: 
   - ユーザー名: `demo-user-basic`
   - パスワード: `DemoPass123!`

2. **ダッシュボード確認**:
   - MFA設定状況: 「未設定」
   - 期限カウントダウン表示
   - 警告アラート（期限に応じた色分け）

3. **MFA設定体験**:
   - 「MFA設定を開始」ボタンをクリック
   - ウィザード形式での設定フロー
   - QRコード生成とTOTP設定
   - Google Authenticator等でスキャン
   - 認証コード入力と有効化

4. **設定完了後の確認**:
   - ダッシュボードに戻る
   - 進捗バー: 100%に更新
   - ステータス: 「有効」に変更

> 📝 **観察ポイント**: ユーザーフレンドリーな設定フローと視覚的フィードバック

#### シナリオB: 管理者ユーザーの迅速対応

1. **ログイン**:
   - ユーザー名: `demo-admin`
   - パスワード: `DemoPass123!`

2. **迅速なMFA設定**:
   - 警告を理解して即座にMFA設定開始
   - 手動シークレットキー入力も試行
   - 設定完了までの時間測定

> 📝 **観察ポイント**: セキュリティ意識の高いユーザーの行動パターン

#### シナリオC: 営業担当の懸念と説得

1. **ログイン**:
   - ユーザー名: `demo-sales` 
   - パスワード: `DemoPass123!`

2. **警告の認識**:
   - 期限警告の表示確認
   - 「後で設定する」の誘惑
   - 段階的な警告レベルの体験

3. **最終的な設定**:
   - 期限が近づいた際の設定実行
   - モバイルでの利便性確認

> 📝 **観察ポイント**: 抵抗感のあるユーザーへの段階的アプローチ効果

### 2-3. 期限設定による動作変化確認

期限を調整して警告レベルの変化を確認：

```bash
# 期限を過去に設定（猶予期間テスト用）
# .env.local を編集
VITE_MFA_DEADLINE=2024-01-01  # 過去の日付

# フロントエンド再起動
npm run dev
```

新しいテストユーザーでログインして、期限超過時の動作を確認。

## 📊 Phase 3: 管理者視点での確認（10-15分）

### 3-1. システム監視と進捗管理

1. **移行進捗の可視化**:
   - 各ユーザーのMFA設定状況
   - 期限までの残り日数
   - 警告レベルの分布

2. **Lambda制御の動作確認**:
   - CloudWatch Logsでトリガー実行確認
   - 期限超過ユーザーのログイン制御
   - 猶予期間の動作確認

```bash
# Lambda実行ログ確認
aws logs describe-log-groups | grep PreAuth
aws logs tail /aws/lambda/CognitoMfaMigrationStack-PreAuthFunction --follow
```

### 3-2. 運用シナリオの検証

1. **段階的移行プロセス**:
   - 3ヶ月前: 情報提供段階
   - 1ヶ月前: 推奨段階
   - 1週間前: 強く推奨段階
   - 期限後: 必須段階

2. **ユーザーサポート観点**:
   - 設定困難ユーザーの識別
   - ヘルプデスク対応パターン
   - エスカレーション基準

## 🎯 Phase 4: ビジネス価値の確認（5分）

### 実現されるビジネス価値

#### 1. セキュリティ強化
- **多層防御**: パスワード + MFAによる認証強化
- **不正アクセス防止**: 99.9%以上の不正ログイン阻止
- **コンプライアンス対応**: セキュリティ基準への準拠

#### 2. ユーザーエクスペリエンス
- **段階的移行**: ユーザーの混乱最小化
- **視覚的フィードバック**: 進捗の明確な表示
- **柔軟な猶予期間**: 急激な変更によるトラブル回避

#### 3. 運用効率化
- **自動化された制御**: 手動管理の削減
- **リアルタイム監視**: 移行状況の即座把握
- **段階的強制力**: 自然な移行促進

### ROI（投資対効果）試算

```
想定効果（年間）:
- セキュリティインシデント削減: 500万円
- ヘルプデスク問い合わせ削減: 200万円  
- コンプライアンス対応工数削減: 100万円

実装コスト:
- 開発費用: 300万円
- 運用コスト: 50万円/年

ROI: (700万円 - 350万円) / 350万円 = 100%
```

## 🔄 応用・カスタマイズ案

### 業界特有の要件対応

1. **金融業界**: より厳格な認証要件
2. **医療業界**: HIPAA準拠対応
3. **製造業**: 現場端末での利用考慮

### 技術的拡張

1. **SMS MFA対応**: 認証アプリ不使用ユーザー向け
2. **ハードウェアトークン**: 高セキュリティ要求対応
3. **リスクベース認証**: IP・デバイス・行動パターン分析

## 📞 次のステップ

### 即座に検討可能な項目
- [ ] 自社環境での詳細要件定義
- [ ] 既存システムとの統合検討  
- [ ] ユーザートレーニング計画
- [ ] 段階的展開スケジュール

### 技術的検討事項
- [ ] 既存User Poolとの統合方法
- [ ] カスタム属性の追加要件
- [ ] 監視・アラート設定
- [ ] 災害復旧対応

### ビジネス検討事項
- [ ] 社内承認プロセス
- [ ] ユーザーコミュニケーション戦略
- [ ] 予算・スケジュール確保
- [ ] 成功指標の定義

---

## 💡 よくある質問

### Q: ユーザーが認証アプリを紛失したらどうなりますか？
A: 管理者による手動リセット機能や、バックアップコード機能を実装可能です。

### Q: 段階的移行の期間はカスタマイズできますか？
A: はい。期限日、警告タイミング、猶予期間すべて設定変更可能です。

### Q: 既存システムへの影響はありますか？
A: Cognito User Poolを使用している場合は最小限の変更で統合可能です。

### Q: 運用開始後の監視はどうしますか？
A: CloudWatch、Lambda logs、カスタムダッシュボードで包括的な監視が可能です。

---

**お疲れさまでした！** このデモを通じて、AWS Cognito MFA移行システムの実装パターンとビジネス価値をご体験いただけたと思います。ご質問やカスタマイズのご相談がございましたら、お気軽にお声がけください。