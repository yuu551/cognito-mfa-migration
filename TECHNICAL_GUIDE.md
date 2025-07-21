# 技術実装ガイド: AWS Cognito MFA移行システム

## 📋 概要

このドキュメントでは、AWS Cognito MFA移行システムの技術実装の詳細について説明します。

### なぜこのシステムが必要か

多要素認証（MFA）の導入は、現代のセキュリティ要件において必須となっていますが、既存システムへの急激な導入はユーザーの混乱と運用負荷の増大を招きます。本システムは以下の課題を解決します：

- **ユーザー体験**: 突然のMFA強制ではなく、段階的な移行でユーザーの理解を促進
- **運用負荷**: 自動化された期限管理により、管理者の手動作業を最小化
- **セキュリティリスク**: 移行期間中の適切なリスク管理と段階的セキュリティ強化
- **ビジネス継続性**: 既存業務への影響を最小限に抑えた移行プロセス

各コンポーネントの役割、AWS SDK の使用方法、状態管理の仕組み、および実装上の重要なポイントを詳細に解説します。

## 🏗️ アーキテクチャ概要

### システム構成図

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   フロントエンド   │────│  AWS Cognito     │────│  Lambda Trigger │
│   (React + Vite)  │    │  User Pool       │    │  Pre-Auth       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Cloudscape UI   │    │  MFA Settings    │    │  Migration      │
│  Components      │    │  (TOTP/SMS)      │    │  Control Logic  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### 主要コンポーネント

#### 1. Frontend Application
**技術選択理由**: React + TypeScript + Cloudscape Design System
- **React**: コンポーネントベースの状態管理により複雑な認証フローを整理
- **TypeScript**: 型安全性により認証関連のバグを事前に防止
- **Cloudscape**: AWSエコシステムとの統合により、一貫したUXを提供

#### 2. Authentication Context
**実装目的**: AWS Amplify SDK v6 を使用した認証状態の一元管理
- **状態管理の一元化**: 複数画面にまたがる認証状態を整合性を保って管理
- **SDK v6対応**: 最新のAWS Amplifyの型安全なAPIを活用
- **ライフサイクル管理**: React のライフサイクルとAWS認証状態の適切な同期

#### 3. MFA Setup Wizard
**設計思想**: ステップ形式のMFA設定インターフェース
- **段階的設定**: 複雑なMFA設定をユーザーフレンドリーなステップに分解
- **エラーハンドリング**: 各ステップでの適切なエラー対応とガイダンス
- **実装パターン**: QRコード生成とTOTPシークレット管理の最適化

#### 4. Dashboard
**可視化戦略**: 進捗状況とユーザー情報の直感的な表示
- **進捗バー**: 移行状況の視覚的フィードバック
- **警告システム**: 期限に基づく段階的な警告レベル制御
- **状態永続化**: localStorage を用いたユーザビリティ向上

#### 5. CDK Infrastructure
**インフラ戦略**: AWS Cognito User Pool とトリガー関数の定義
- **デュアルプール構成**: 段階的移行を可能にするアーキテクチャ設計
- **Lambda制御**: Pre-authenticationトリガーによる動的なアクセス制御
- **スケーラビリティ**: 大規模ユーザーベースに対応可能な設計

## 🔧 AWS SDK 実装詳細

### 1. Authentication Context (AuthContext.tsx)

#### 主要インポート

```typescript
import {
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  getCurrentUser,
  fetchMFAPreference,
  setUpTOTP,
  verifyTOTPSetup,
  updateMFAPreference,
  confirmSignIn
} from 'aws-amplify/auth';
```

#### 認証フロー実装

##### 基本サインイン
```typescript
const signIn = async (username: string, password: string) => {
  const signInResult = await amplifySignIn({ username, password });
  
  if (signInResult.isSignedIn) {
    // 通常のサインイン完了
    const currentUser = await getCurrentUser();
    setUser({
      userId: currentUser.userId,
      username: currentUser.username,
      email: currentUser.signInDetails?.loginId || '',
      mfaEnabled: currentUser.username === 'testuser1' // 例: 条件付きMFA状態
    });
  } else if (signInResult.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
    // MFA確認が必要
    setNeedsMFAConfirmation(true);
  }
};
```

##### MFA確認フロー
```typescript
const confirmMFA = async (totpCode: string) => {
  const confirmResult = await confirmSignIn({ challengeResponse: totpCode });
  
  if (confirmResult.isSignedIn) {
    const currentUser = await getCurrentUser();
    setUser({
      ...currentUser,
      mfaEnabled: true // MFA認証済みユーザー
    });
    setNeedsMFAConfirmation(false);
  }
};
```

#### TOTP MFA設定実装

##### TOTP設定開始
```typescript
const setupMFA = async (method: 'SMS' | 'TOTP') => {
  if (method === 'TOTP') {
    // AWS Amplify v6 の setUpTOTP を使用
    const totpSetupDetails = await setUpTOTP();
    return totpSetupDetails;
  }
};
```

##### TOTP検証と有効化
```typescript
const verifyAndEnableMFA = async (totpCode: string) => {
  // Step 1: TOTP コードを検証
  await verifyTOTPSetup({ code: totpCode });
  
  // Step 2: MFA設定を優先モードに変更
  try {
    await updateMFAPreference({ totp: 'PREFERRED' });
  } catch (preferenceError) {
    // フォールバック: ENABLED モード
    await updateMFAPreference({ totp: 'ENABLED' });
  }
  
  // Step 3: ローカル状態を即座に更新
  if (user) {
    const updatedUser = { ...user, mfaEnabled: true };
    setUser(updatedUser);
    setMfaSetupCompleted(true); // 完了フラグを立てる
    
    const newMFAStatus = calculateMFAStatus(updatedUser);
    setMFAStatus(newMFAStatus);
  }
};
```

### 2. localStorage による状態永続化

#### 設計思想と実装背景
MFA設定完了状態の永続化は、本システムの核心的な技術課題の一つです。この実装が必要な理由と解決する問題について詳しく説明します。

##### 解決する問題

**1. React コンポーネントライフサイクルの課題**
Reactアプリケーションでは、コンポーネントのマウント・アンマウントが頻繁に発生します。特に以下の状況で状態が失われる問題がありました：
- MFA設定完了後のダッシュボードへの遷移
- ブラウザのタブ切り替えや戻る・進むボタンの使用
- 開発時のホットリロードによる状態リセット

**2. AWS Cognito APIの応答性問題**
Cognito APIでMFA状態を確認する`fetchMFAPreference`は、以下の制約があります：
- APIレート制限により頻繁な呼び出しが困難
- ネットワークレイテンシーによる応答遅延
- 一時的なAPI障害時の状態確認不可

**3. ユーザビリティの要件**
MFA設定は重要なセキュリティ操作であり、以下のUX要件を満たす必要があります：
- 設定完了の即座な視覚的フィードバック
- 設定状態の確実な永続化
- システム障害時の状態保持

##### 実装戦略

**localStorage選択の理由**
- **永続性**: ブラウザセッション終了後も状態保持
- **同期性**: APIコールと異なり即座に読み書き可能
- **信頼性**: ネットワーク状況に依存しない
- **セキュリティ**: 認証情報ではなく設定フラグのみ保存

**実装上の工夫**
- 初期化時の安全な読み込み（try-catch での例外処理）
- サインアウト時の確実なクリーンアップ
- 型安全性（boolean型での厳密な管理）

#### 実装方法と技術的詳細

```typescript
// 初期化時に localStorage から読み込み
const [mfaSetupCompleted, setMfaSetupCompleted] = useState(() => {
  try {
    const saved = localStorage.getItem('mfaSetupCompleted');
    return saved === 'true';
  } catch {
    return false;
  }
});

// 状態変更時に localStorage に保存
const setMfaSetupCompletedFlag = useCallback((completed: boolean) => {
  setMfaSetupCompleted(completed);
  
  try {
    if (completed) {
      localStorage.setItem('mfaSetupCompleted', 'true');
    } else {
      localStorage.removeItem('mfaSetupCompleted');
    }
  } catch (error) {
    console.error('localStorage save error:', error);
  }
}, []);
```

### 3. MFA Setup Wizard の実装戦略

#### 設計の背景と課題

MFA設定は技術的に複雑な処理ですが、エンドユーザーにとっては直感的で分かりやすいインターフェースである必要があります。以下の課題を解決するため、ウィザード形式を採用しました。

##### 解決対象の課題

**1. 技術的複雑性の隠蔽**
- TOTPアルゴリズム（RFC 6238）の複雑性
- AWS Cognito APIの詳細仕様
- QRコード生成とバイナリデータ処理
- エラー状況の多様性

**2. ユーザー教育の困難さ**
- MFA概念の理解促進
- 認証アプリの使用方法
- 緊急時の対応手順

**3. セキュリティ要件との両立**
- シークレットキーの安全な取り扱い
- 中間状態での適切なエラーハンドリング
- セッション管理との整合性

#### MFASetup.tsx 実装詳細

#### QR Code 生成ロジック

```typescript
const generateQRCode = async (secret: string, username: string) => {
  // TOTP URI 形式に従ってURL生成
  const otpauthUrl = `otpauth://totp/MFA%20Migration%20System:${username}?secret=${secret}&issuer=MFA%20Migration%20System`;
  
  // QRコードライブラリでData URLに変換
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  setQrCodeUrl(qrCodeDataUrl);
};
```

#### TOTP Secret 抽出ロジック

```typescript
const handleMethodSelection = async () => {
  const totpSetupDetails = await setupMFA('TOTP');
  
  // AWS Amplify の戻り値構造に対応
  const setupUri = totpSetupDetails.getSetupUri ?
    totpSetupDetails.getSetupUri('MFA Migration System', user.username) :
    totpSetupDetails.setupUri;
  
  if (typeof setupUri === 'string') {
    // URI から secret を抽出
    const secretMatch = setupUri.match(/secret=([A-Z2-7]+)/);
    const secret = secretMatch ? secretMatch[1] : '';
    setTotpSecret(secret);
  } else {
    // 直接 secret フィールドから取得
    const secret = totpSetupDetails.secret || totpSetupDetails.sharedSecret || '';
    setTotpSecret(secret);
  }
  
  await generateQRCode(secret, user.username);
};
```

#### 直接的なフラグ制御

```typescript
const handleTOTPVerification = async () => {
  // TOTP コード検証
  await verifyAndEnableMFA(verificationCode);
  
  // 重要: 設定完了フラグを直接制御
  setMfaSetupCompleted(true);
  
  setSetupComplete(true);
  setActiveStepIndex(3); // 完了ステップに遷移
};
```

### 4. Dashboard の状態管理戦略

#### 進捗計算の設計思想

ダッシュボードの進捗表示は、単純な数値計算以上に、ユーザーの心理的な側面を考慮した設計が必要です。

##### 進捗バーの心理的効果

**1. モチベーション向上**
- 視覚的な達成感の提供
- 明確なゴール設定
- 段階的な成功体験の演出

**2. 不安軽減**
- 残り時間の可視化
- 進捗状況の透明性
- 次のステップの明確化

**3. 行動促進**
- 緊急度に応じた色彩変更
- 適切なタイミングでのアラート表示
- CTAボタンの最適配置

#### 技術実装の工夫

#### MFA状態計算

```typescript
const calculateMFAStatus = (targetUser?: User | null): MFAStatus => {
  const currentUser = targetUser || user;
  const deadline = new Date(import.meta.env.VITE_MFA_DEADLINE || '2025-09-01');
  const currentDate = new Date();
  const daysRemaining = Math.ceil((deadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

  // 警告レベルの段階的制御
  let warningLevel: 'info' | 'warning' | 'error' = 'info';
  let showWarning = false;

  if (daysRemaining > 30) {
    warningLevel = 'info';
    showWarning = true;
  } else if (daysRemaining > 7) {
    warningLevel = 'warning';
    showWarning = true;
  } else if (daysRemaining > 0) {
    warningLevel = 'error';
    showWarning = true;
  } else {
    // 期限後
    warningLevel = 'error';
    showWarning = true;
  }

  // localStorage フラグを最優先で確認
  const isMfaEnabled = mfaSetupCompleted || currentUser?.mfaEnabled || false;

  return {
    enabled: isMfaEnabled,
    methods: isMfaEnabled ? ['TOTP'] : [],
    migrationDeadline: deadline,
    daysRemaining,
    warningLevel,
    showWarning: showWarning && !isMfaEnabled
  };
};
```

#### 進捗バー計算

```typescript
const getMFAProgress = () => {
  // localStorage フラグまたはユーザーの MFA 有効状態で 100%
  const progress = (mfaSetupCompleted || user?.mfaEnabled) ? 100 : (
    mfaStatus && mfaStatus.daysRemaining <= 0 ? 0 : 
    Math.max(0, Math.min(100, 100 - ((mfaStatus?.daysRemaining || 0) * 2)))
  );

  return progress;
};
```

## 🔧 重要な実装上の考慮事項

### システム全体のアーキテクチャ判断

#### 1. 状態管理アーキテクチャの選択

**Context API vs Redux の判断**

本システムでは React Context API を選択しました。この判断の背景：

**Context API選択理由:**
- **複雑度**: 認証状態は比較的単純で、複雑な状態変更パターンが少ない
- **パフォーマンス**: 認証状態の変更頻度が低く、過度な最適化は不要
- **学習コスト**: チーム全体での理解・保守が容易
- **バンドルサイズ**: 追加ライブラリ不要

**避けたReduxの問題:**
- 認証のような単純な状態に対するボイラープレートの過剰さ
- 小規模チームでの開発効率の低下
- TypeScriptとの統合における型定義の複雑化

#### 2. エラーハンドリングの階層化戦略

エラーハンドリングは以下の3層構造で実装：

**1. API層（AuthContext）**
```typescript
// AWS SDK固有のエラーを捕捉・分類
if (error.name === 'CodeMismatchException') {
  // ユーザー向けの分かりやすいメッセージに変換
}
```

**2. UI層（各コンポーネント）**
```typescript
// ユーザー体験を損なわない適切な表示制御
setError('認証コードが正しくありません...');
```

**3. 監視層（将来の拡張ポイント）**
```typescript
// ログ集約・アラート・メトリクス収集
console.error('MFA Setup Error:', error);
```

### 1. React ライフサイクル管理の最適化

#### useEffect 依存配列の戦略的設計

本システムで最も重要な技術的課題の一つが、useEffect依存配列の適切な設計です。認証状態の変更検知において、以下の問題を解決しました。

##### 無限ループ問題の解決

**問題**: 認証状態チェック関数を依存配列に含めることで発生する無限レンダリング

**根本原因**:
```typescript
// 問題のあるコード例
const checkAuth = async () => { /* ... */ };
useEffect(() => {
  checkAuth();
}, [checkAuth]); // 関数参照が毎回変わるため無限ループ
```

**解決方法**:
1. **useCallback によるメモ化**: 関数参照の安定化
2. **依存配列の精査**: 本当に必要な値のみを依存に追加
3. **状態分離**: 頻繁に変わる状態と安定的な状態の分離

##### メモリリーク防止の実装

#### useEffect 依存配列の最適化

```typescript
useEffect(() => {
  if (user) {
    const newStatus = calculateMFAStatus();
    setMFAStatus(newStatus);
  }
}, [user?.mfaEnabled, mfaSetupCompleted]); // 両方の変更を監視
```

### 2. 段階的エラーハンドリング戦略

#### AWS Cognito API固有のエラー処理

Cognito APIは多様なエラーコードを返すため、ユーザビリティを考慮した段階的処理が必要です。

##### エラー分類と対応戦略

**1. ユーザー操作エラー（回復可能）**
- `CodeMismatchException`: 認証コード誤入力
- `InvalidParameterException`: 入力値の形式エラー
- **対応**: 具体的な修正方法を提示し、再入力を促す

**2. システム制約エラー（一時的）**
- `LimitExceededException`: API制限超過
- `TooManyRequestsException`: レート制限
- **対応**: 待機時間を提示し、自動リトライ機能を実装

**3. 設定・権限エラー（開発者対応必要）**
- `NotAuthorizedException`: 権限不足
- `ResourceNotFoundException`: リソース未存在
- **対応**: 詳細ログを記録し、管理者への連絡を促す

#### ユーザー体験を重視したエラーメッセージ設計

**技術的詳細の隠蔽**:
```typescript
// 技術者向けログ（開発環境・監視用）
console.error('Cognito API Error:', {
  name: error.name,
  code: error.code,
  requestId: error.$metadata?.requestId
});

// ユーザー向けメッセージ（分かりやすい言葉で）
setError('認証アプリから最新のコードを確認してください');
```

#### MFA 設定時のエラー分岐

```typescript
try {
  await updateMFAPreference({ totp: 'PREFERRED' });
} catch (preferenceError) {
  console.error('MFA preference update error:', preferenceError);
  
  // フォールバック処理
  await updateMFAPreference({ totp: 'ENABLED' });
}
```

#### 認証コード検証のエラー処理

```typescript
try {
  await verifyAndEnableMFA(verificationCode);
} catch (error: any) {
  if (error.name === 'CodeMismatchException') {
    setError('認証コードが正しくありません。認証アプリから最新のコードを入力してください。');
  } else if (error.name === 'LimitExceededException') {
    setError('試行回数が上限に達しました。しばらく待ってから再試行してください。');
  } else {
    setError('認証コードの検証中にエラーが発生しました: ' + error.message);
  }
}
```

### 3. TypeScript型安全性の戦略的活用

#### 認証状態の型安全性確保

認証システムでは、型エラーがセキュリティリスクに直結する可能性があるため、厳密な型定義を実装しています。

##### 設計原則

**1. Fail Fast 原則**
- 実行時エラーではなくコンパイル時エラーで問題を検知
- 型ガードによる実行時チェックの最小化
- null/undefined の明示的な処理

**2. 型の単一責任原則**
- 認証状態、MFA状態、UI状態の明確な分離
- インターフェースの適切な粒度設計
- 依存関係の循環参照回避

**3. 拡張性を考慮した型設計**
- 将来のMFA方式追加に対応可能な柔軟性
- AWS SDK のアップデートに対する耐性
- 他の認証プロバイダーへの移行可能性

##### 型定義の実装戦略

#### コア型定義

```typescript
export interface User {
  userId: string;
  username: string;
  email: string;
  mfaEnabled: boolean;
}

export interface MFAStatus {
  enabled: boolean;
  methods: string[];
  migrationDeadline: Date;
  daysRemaining: number;
  warningLevel: 'info' | 'warning' | 'error';
  showWarning: boolean;
}

export interface AuthContextType {
  user: User | null;
  mfaStatus: MFAStatus | null;
  needsMFAConfirmation: boolean;
  mfaSetupCompleted: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  checkMFAStatus: () => Promise<void>;
  setupMFA: (method: 'SMS' | 'TOTP') => Promise<any>;
  verifyAndEnableMFA: (totpCode: string) => Promise<{ success: boolean }>;
  confirmMFA: (totpCode: string) => Promise<void>;
  initializeUser: (userData: User) => void;
  setMfaSetupCompleted: (completed: boolean) => void;
}
```

## 🚀 AWS CDK インフラストラクチャ

### User Pool 設定

```typescript
const userPool = new cognito.UserPool(this, 'UserPool', {
  mfa: cognito.Mfa.OPTIONAL, // 段階的移行のため OPTIONAL
  mfaSecondFactor: {
    sms: true,
    otp: true
  },
  selfSignUpEnabled: false,
  signInAliases: {
    username: true,
    email: true
  },
  // Pre-authentication Lambda trigger
  lambdaTriggers: {
    preAuthentication: preAuthFunction
  }
});
```

### Lambda Pre-Authentication Trigger

```typescript
export const handler = async (event: PreAuthenticationTriggerEvent) => {
  const { userAttributes, request } = event;
  const currentDate = new Date();
  const deadline = new Date('2025-09-01'); // 環境変数から取得

  // MFA未設定ユーザーの制御ロジック
  if (!userAttributes.mfa_enabled && currentDate > deadline) {
    throw new Error('MFA設定期限を超過しています。MFAを設定してください。');
  }

  return event;
};
```

## 📦 パッケージ構成

### 主要依存関係

```json
{
  "dependencies": {
    "@cloudscape-design/components": "^3.x",
    "aws-amplify": "^6.x",
    "react": "^18.x",
    "typescript": "^5.x",
    "qrcode": "^1.x"
  },
  "devDependencies": {
    "@types/qrcode": "^1.x",
    "vite": "^5.x"
  }
}
```

### 環境変数設定

```env
# Frontend (.env.local)
VITE_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=us-east-1
VITE_MFA_DEADLINE=2025-09-01
```

## 🔍 デバッグとトラブルシューティング

### 1. localStorage 状態確認

```javascript
// ブラウザ開発者ツールで実行
console.log('MFA Setup Status:', localStorage.getItem('mfaSetupCompleted'));
```

### 2. AWS Amplify 設定確認

```typescript
import { fetchAuthSession } from 'aws-amplify/auth';

const checkAuthSession = async () => {
  try {
    const session = await fetchAuthSession();
    console.log('Auth Session:', session);
  } catch (error) {
    console.error('Auth Session Error:', error);
  }
};
```

### 3. MFA 設定状況確認

```typescript
import { fetchMFAPreference } from 'aws-amplify/auth';

const checkCurrentMFAStatus = async () => {
  try {
    const mfaPreference = await fetchMFAPreference();
    console.log('Current MFA Preference:', mfaPreference);
  } catch (error) {
    console.error('MFA Status Check Error:', error);
  }
};
```

## ⚠️ セキュリティ考慮事項

### 1. Secret の取り扱い

- TOTP シークレットは UI 上で一時的に表示されますが、localStorage には保存しません
- QR コード生成後は適切にメモリから削除されます

### 2. 認証状態の管理

- JWT トークンは AWS Amplify が自動管理
- ローカルストレージには認証情報以外の状態のみ保存

### 3. エラーメッセージ

- 詳細なエラー情報はコンソールログのみに出力
- ユーザー向けメッセージは抽象化して表示

---

このドキュメントは実装の詳細な技術仕様を提供します。追加の質問や詳細な説明が必要な場合は、該当セクションについてお知らせください。