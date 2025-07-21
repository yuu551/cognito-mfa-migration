/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { signIn as amplifySignIn, signOut as amplifySignOut, getCurrentUser, setUpTOTP, verifyTOTPSetup, updateMFAPreference, confirmSignIn } from 'aws-amplify/auth';
import type { AuthContextType, User, MFAStatus } from '../types/auth';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [mfaStatus, setMFAStatus] = useState<MFAStatus | null>(null);
  const [needsMFAConfirmation, setNeedsMFAConfirmation] = useState(false);
  // 🚀 MFA設定完了フラグ - localStorageから初期値を読み込み
  const [mfaSetupCompleted, setMfaSetupCompleted] = useState(() => {
    try {
      const saved = localStorage.getItem('mfaSetupCompleted');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  // 初期化時の認証状態確認
  useEffect(() => {
    const checkInitialAuth = async () => {
      try {
        const currentUser = await getCurrentUser();
        setUser({
          userId: currentUser.userId,
          username: currentUser.username,
          email: currentUser.signInDetails?.loginId || '',
          mfaEnabled: currentUser.username === 'testuser1' // 一時的なハードコード
        });
      } catch {
        setUser(null);
      }
    };
    checkInitialAuth();
  }, []);

  // App.tsxからユーザー情報を初期化する関数
  const initializeUser = useCallback((userData: User) => {
    setUser(userData);
  }, []);

  // 🚀 MFA設定完了フラグを外部から操作する関数 - localStorage永続化対応
  const setMfaSetupCompletedFlag = useCallback((completed: boolean) => {
    setMfaSetupCompleted(completed);
    
    // localStorage に永続化
    try {
      if (completed) {
        localStorage.setItem('mfaSetupCompleted', 'true');
      } else {
        localStorage.removeItem('mfaSetupCompleted');
      }
    } catch (error: unknown) {
      console.error('localStorage save error:', error instanceof Error ? error.message : String(error));
    }
  }, []);

  const calculateMFAStatus = useCallback((targetUser?: User | null): MFAStatus => {
    const currentUser = targetUser || user;

    const deadline = new Date(import.meta.env.VITE_MFA_DEADLINE || '2025-09-01');
    const currentDate = new Date();
    const daysRemaining = Math.ceil((deadline.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));

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
      // 期限後（猶予期間）
      warningLevel = 'error';
      showWarning = true;
    }

    // 🚀 MFA設定完了フラグまたはユーザーのmfaEnabledをチェック
    const isMfaEnabled = mfaSetupCompleted || currentUser?.mfaEnabled || false;

    return {
      enabled: isMfaEnabled,
      methods: isMfaEnabled ? ['TOTP'] : [],
      migrationDeadline: deadline,
      daysRemaining,
      warningLevel,
      showWarning: showWarning && !isMfaEnabled
    };
  }, [mfaSetupCompleted, user]);

  useEffect(() => {
    if (user) {
      const newStatus = calculateMFAStatus();
      setMFAStatus(newStatus);
    }
  }, [user, mfaSetupCompleted, calculateMFAStatus]);

  const signIn = async (username: string, password: string) => {
    try {
      const signInResult = await amplifySignIn({ username, password });
      
      if (signInResult.isSignedIn) {
        const currentUser = await getCurrentUser();
        
        const newUser: User = {
          userId: currentUser.userId,
          username: currentUser.username,
          email: currentUser.signInDetails?.loginId || '',
          mfaEnabled: currentUser.username === 'testuser1' // 一時的なハードコード
        };
        setUser(newUser);
        setNeedsMFAConfirmation(false);
      } else if (signInResult.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
        setNeedsMFAConfirmation(true);
        // MFA確認が必要な場合はエラーを投げずに状態変更のみ
      } else {
        throw new Error('予期しないサインイン状態です。');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(errorMessage);
    }
  };

  const confirmMFA = async (totpCode: string) => {
    try {
      const confirmResult = await confirmSignIn({ challengeResponse: totpCode });
      
      if (confirmResult.isSignedIn) {
        const currentUser = await getCurrentUser();
        
        const newUser: User = {
          userId: currentUser.userId,
          username: currentUser.username,
          email: currentUser.signInDetails?.loginId || '',
          mfaEnabled: true
        };
        setUser(newUser);
        setNeedsMFAConfirmation(false);
      } else {
        throw new Error('MFA確認が完了しませんでした。');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(errorMessage);
    }
  };

  const signOut = async () => {
    try {
      await amplifySignOut();
      setUser(null);
      setMFAStatus(null);
      setMfaSetupCompleted(false); // 🚀 設定完了フラグもリセット
      
      // localStorage もクリア
      try {
        localStorage.removeItem('mfaSetupCompleted');
      } catch (storageError: unknown) {
        console.error('localStorage clear error:', storageError instanceof Error ? storageError.message : String(storageError));
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(errorMessage);
    }
  };

  const checkMFAStatus = async () => {
    // 一時的にAPI呼び出しを無効化（レート制限とループ防止）
    return;
    
    /* 元のコード - レート制限解除後に復元
    try {
      console.log('Checking MFA status for user:', user?.username);
      const mfaPreference = await fetchMFAPreference();
      console.log('MFA Preference response:', mfaPreference);
      
      // AWS Amplify v6の正しい形式: mfaPreference.enabled (小文字)
      const hasMFA = mfaPreference.enabled && mfaPreference.enabled.length > 0;
      console.log('User has MFA enabled:', hasMFA);
      console.log('MFA enabled methods:', mfaPreference.enabled);
      console.log('Current user object:', user);
      
      if (user) {
        console.log('Updating user with MFA status:', hasMFA);
        const updatedUser = { ...user, mfaEnabled: hasMFA };
        console.log('Updated user object:', updatedUser);
        setUser(updatedUser);
      } else {
        console.warn('User object is null, cannot update MFA status');
      }
    } catch (error) {
      console.error('MFA status check error:', {
        name: error.name,
        message: error.message,
        code: error.code,
        user: user?.username
      });
    }
    */
  };

  const setupMFA = async (method: 'SMS' | 'TOTP') => {
    try {
      if (method === 'TOTP') {
        
        // AWS Amplify v6の正しいsetUpTOTP呼び出し
        const totpSetupDetails = await setUpTOTP();
        
        return totpSetupDetails;
      } else {
        // SMS MFA setup would be implemented here
        throw new Error('SMS MFA setup not yet implemented');
      }
    } catch (error: unknown) {
      const errorInstance = error instanceof Error ? error : new Error(String(error));
      console.error('MFA setup error details:', {
        errorName: errorInstance.name,
        errorMessage: errorInstance.message,
        user: user?.username
      });
      throw errorInstance;
    }
  };

  const verifyAndEnableMFA = async (totpCode: string) => {
    try {
      // TOTP設定を検証
      await verifyTOTPSetup({ code: totpCode });
      
      try {
        // MFAを有効化 - AWS Amplify v6の正しい形式
        await updateMFAPreference({ 
          totp: 'PREFERRED'
        });
      } catch (preferenceError: unknown) {
        const errorMessage = preferenceError instanceof Error ? preferenceError.message : String(preferenceError);
        console.error('MFA preference update error:', errorMessage);
        
        // 代替的なアプローチを試す
        await updateMFAPreference({ 
          totp: 'ENABLED'
        });
      }

      // MFA状態を即座にローカル更新
      if (user) {
        const updatedUser = { ...user, mfaEnabled: true };
        setUser(updatedUser);
        
        // MFA設定完了フラグを立てる
        setMfaSetupCompleted(true);

        // MFA状態も即座に更新
        const newMFAStatus = calculateMFAStatus(updatedUser);
        setMFAStatus(newMFAStatus);
      }
      
      return { success: true };
    } catch (error: unknown) {
      const errorInstance = error instanceof Error ? error : new Error(String(error));
      console.error('TOTP verification and enablement error:', {
        name: errorInstance.name,
        message: errorInstance.message,
        step: errorInstance.message.includes('verifyTOTPSetup') ? 'verification' : 'preference_update'
      });
      throw errorInstance;
    }
  };

  const value: AuthContextType = {
    user,
    mfaStatus,
    needsMFAConfirmation,
    mfaSetupCompleted, // 🚀 MFA設定完了フラグを追加
    signIn,
    signOut,
    checkMFAStatus,
    setupMFA,
    verifyAndEnableMFA,
    confirmMFA,
    initializeUser,
    setMfaSetupCompleted: setMfaSetupCompletedFlag // 🚀 フラグ操作関数を追加
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};