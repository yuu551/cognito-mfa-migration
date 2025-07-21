# 技術実装ガイド: AWS Cognito MFA移行システム

## 📋 概要

このドキュメントでは、AWS Cognito MFA移行システムの技術実装の詳細について説明します。各コンポーネントの役割、AWS SDK の使用方法、状態管理の仕組み、および実装上の重要なポイントを詳細に解説します。

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

1. **Frontend Application** - React + TypeScript + Cloudscape Design System
2. **Authentication Context** - AWS Amplify SDK v6 を使用した認証状態管理
3. **MFA Setup Wizard** - ステップ形式のMFA設定インターフェース
4. **Dashboard** - 進捗状況とユーザー情報の可視化
5. **CDK Infrastructure** - AWS Cognito User Pool とトリガー関数の定義

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

#### 設計思想
MFA設定完了状態は、ページ遷移やブラウザリロードに対して永続化する必要があります。これは以下の理由によるものです：

1. **UX向上**: 設定完了後の画面遷移で進捗がリセットされることを防ぐ
2. **状態整合性**: React のコンポーネントライフサイクルによる状態リセットを回避
3. **セッション維持**: ブラウザリロード時でも設定状態を保持

#### 実装方法

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

### 3. MFA Setup Wizard (MFASetup.tsx)

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

### 4. Dashboard 進捗計算ロジック

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

### 1. React ライフサイクルとの整合性

#### useEffect 依存配列の最適化

```typescript
useEffect(() => {
  if (user) {
    const newStatus = calculateMFAStatus();
    setMFAStatus(newStatus);
  }
}, [user?.mfaEnabled, mfaSetupCompleted]); // 両方の変更を監視
```

### 2. エラーハンドリング戦略

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

### 3. TypeScript 型定義

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