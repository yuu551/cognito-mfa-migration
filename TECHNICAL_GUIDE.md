# 技術実装ガイド: AWS Cognito MFA移行システム

## 📋 概要

このドキュメントでは、AWS Cognito MFA移行システムの技術実装の詳細について説明します。

### なぜこのシステムが必要か

本システムは以下の課題を解決します。

- **ユーザー体験**: 突然のMFA強制ではなく、段階的な移行でユーザーの理解を促進

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

## 🔧 AWS SDK 実装詳細

### 1. Authentication Context (AuthContext.tsx)

#### 主要インポート

AWS Amplify v6の認証関連APIをインポート。サインイン、MFA設定、認証状態管理に必要な関数群。
v6ではAPI名が変更されており、`totp: 'PREFERRED'`形式でMFA設定を行う。

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

ユーザー名とパスワードでサインイン処理を実行。MFAが必要な場合は確認状態へ遷移。
signInResultの状態を確認し、通常ログインかMFA確認が必要かを判定する。

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
      mfaEnabled: false
    });
  } else if (signInResult.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
    // MFA確認が必要
    setNeedsMFAConfirmation(true);
  }
};
```

##### MFA確認フロー

TOTPコードを送信してMFA認証を完了。成功時はユーザー情報を更新して認証済み状態へ。
confirmSignInでチャレンジレスポンスとして6桁のTOTPコードを送信する。

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

TOTP方式のMFA設定を開始。Amplifyの`setUpTOTP`でシークレットキーとQRコード情報を取得。
戻り値にはsetupUriやgetSetupUri関数が含まれ、認証アプリ登録に必要な情報を提供。

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

入力されたTOTPコードを検証し、MFAを有効化。`PREFERRED`設定でTOTPを優先認証方式に設定。
エラー時は`ENABLED`にフォールバックし、ローカル状態とlocalStorageを即座に更新。

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

MFAを有効化したタイミングだけ、localStroageで状態を保持します。
サインアウトで状態は削除します。

#### 実装方法と技術的詳細

MFA設定完了フラグをlocalStorageで永続化。ページリロードやコンポーネント再マウント時も状態を維持。
useState初期化時に読み込み、更新時は同期的に保存。サインアウト時にクリア。

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

### 3. MFA Setup Wizard の実装

ウィザード形式でTOTPの設定手順をユーザーに案内する実装。4ステップでMFA設定を完了させる。

#### QR Code 生成ロジック

TOTP秘密鍵からQRコードを生成。otpauth://形式のURIを作成してData URLに変換。
Google AuthenticatorやMicrosoft Authenticatorなどの標準的な認証アプリで読み取り可能。

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

AWS Amplifyの戻り値からTOTPシークレットを抽出。戻り値構造の違いに対応した柔軟な実装。
getSetupUri関数がある場合はそれを使用し、ない場合はsecretフィールドから直接取得。

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

MFA設定完了時に即座に完了フラグを立てる。Dashboardの進捗表示を100%に更新。
AuthContextの状態更新を待たずに、MFASetupコンポーネントから直接フラグを制御。

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

### 4. Dashboard の状態管理

MFA設定の進捗状況を計算・表示する実装。期限管理と警告レベル制御を行う。

#### MFA状態計算

ユーザーのMFA設定状態と期限を計算。残り日数に応じて警告レベル（info/warning/error）を判定。
30日以上はinfo、7-30日はwarning、7日以内はerror。localStorageのフラグも考慮。

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

MFA設定の進捗パーセンテージを計算。設定済みは100%、未設定は期限までの残り日数から算出。
期限超過は0%、期限までの日数を2倍して100から引くことで段階的な進捗を表現。

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

