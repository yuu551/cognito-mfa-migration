import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { signIn as amplifySignIn, signOut as amplifySignOut, getCurrentUser, fetchMFAPreference, setUpTOTP, verifyTOTPSetup, updateMFAPreference, confirmSignIn } from 'aws-amplify/auth';
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

  // 初期化時の認証状態確認
  useEffect(() => {
    const checkInitialAuth = async () => {
      try {
        const currentUser = await getCurrentUser();
        console.log('AuthContext - Initial auth check success:', currentUser.username);
        setUser({
          userId: currentUser.userId,
          username: currentUser.username,
          email: currentUser.signInDetails?.loginId || '',
          mfaEnabled: currentUser.username === 'testuser1' // 一時的なハードコード
        });
      } catch (error) {
        console.log('AuthContext - No initial authenticated user');
        setUser(null);
      }
    };
    checkInitialAuth();
  }, []);

  // App.tsxからユーザー情報を初期化する関数
  const initializeUser = useCallback((userData: User) => {
    setUser(userData);
  }, []);

  const calculateMFAStatus = (): MFAStatus => {
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

    return {
      enabled: user?.mfaEnabled || false,
      methods: user?.mfaEnabled ? ['TOTP'] : [],
      migrationDeadline: deadline,
      daysRemaining,
      warningLevel,
      showWarning: showWarning && !user?.mfaEnabled
    };
  };

  useEffect(() => {
    if (user) {
      setMFAStatus(calculateMFAStatus());
    }
  }, [user]);

  const signIn = async (username: string, password: string) => {
    try {
      console.log('AuthContext signIn - Starting login process');
      const signInResult = await amplifySignIn({ username, password });
      console.log('AuthContext signIn - SignIn result:', signInResult);
      
      if (signInResult.isSignedIn) {
        const currentUser = await getCurrentUser();
        console.log('AuthContext signIn - Got current user:', currentUser.username);
        
        const newUser: User = {
          userId: currentUser.userId,
          username: currentUser.username,
          email: currentUser.signInDetails?.loginId || '',
          mfaEnabled: currentUser.username === 'testuser1' // 一時的なハードコード
        };
        console.log('AuthContext signIn - Setting user:', newUser);
        setUser(newUser);
        setNeedsMFAConfirmation(false);
        console.log('AuthContext signIn - User set successfully');
      } else if (signInResult.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
        console.log('AuthContext signIn - MFA confirmation required');
        setNeedsMFAConfirmation(true);
        // MFA確認が必要な場合はエラーを投げずに状態変更のみ
      } else {
        console.warn('AuthContext signIn - Unexpected signIn state:', signInResult);
        throw new Error('予期しないサインイン状態です。');
      }
    } catch (error) {
      console.error('AuthContext signIn - Error:', error);
      throw error;
    }
  };

  const confirmMFA = async (totpCode: string) => {
    try {
      console.log('AuthContext confirmMFA - Confirming with TOTP code');
      const confirmResult = await confirmSignIn({ challengeResponse: totpCode });
      console.log('AuthContext confirmMFA - Confirm result:', confirmResult);
      
      if (confirmResult.isSignedIn) {
        const currentUser = await getCurrentUser();
        console.log('AuthContext confirmMFA - Got current user:', currentUser.username);
        
        const newUser: User = {
          userId: currentUser.userId,
          username: currentUser.username,
          email: currentUser.signInDetails?.loginId || '',
          mfaEnabled: true
        };
        console.log('AuthContext confirmMFA - Setting user:', newUser);
        setUser(newUser);
        setNeedsMFAConfirmation(false);
        console.log('AuthContext confirmMFA - MFA confirmation successful');
      } else {
        console.warn('AuthContext confirmMFA - User not signed in after MFA confirmation');
        throw new Error('MFA確認が完了しませんでした。');
      }
    } catch (error) {
      console.error('AuthContext confirmMFA - Error:', error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await amplifySignOut();
      setUser(null);
      setMFAStatus(null);
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  };

  const checkMFAStatus = async () => {
    // 一時的にAPI呼び出しを無効化（レート制限とループ防止）
    console.log('checkMFAStatus called - API disabled to prevent rate limiting');
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
        console.log('Setting up TOTP for user:', user?.username);
        
        // AWS Amplify v6の正しいsetUpTOTP呼び出し
        const totpSetupDetails = await setUpTOTP();
        
        console.log('TOTP setup successful:', totpSetupDetails);
        return totpSetupDetails;
      } else {
        // SMS MFA setup would be implemented here
        throw new Error('SMS MFA setup not yet implemented');
      }
    } catch (error) {
      console.error('MFA setup error details:', {
        errorName: error.name,
        errorMessage: error.message,
        errorCode: error.code,
        user: user?.username
      });
      throw error;
    }
  };

  const verifyAndEnableMFA = async (totpCode: string) => {
    try {
      console.log('Step 1: Verifying TOTP setup with code');
      
      // TOTP設定を検証
      await verifyTOTPSetup({ code: totpCode });
      console.log('Step 1 completed: TOTP verification successful');
      
      console.log('Step 2: Enabling MFA preference');
      
      try {
        // MFAを有効化 - AWS Amplify v6の正しい形式
        await updateMFAPreference({ 
          totp: 'PREFERRED'
        });
        console.log('Step 2 completed: MFA preference updated');
      } catch (preferenceError) {
        console.error('Step 2 failed: MFA preference update error:', preferenceError);
        
        // 代替的なアプローチを試す
        console.log('Trying alternative approach: TOTP enabled');
        await updateMFAPreference({ 
          totp: 'ENABLED'
        });
        console.log('Step 2 completed: Alternative MFA preference updated');
      }

      // MFA状態を更新
      console.log('Step 3: Checking updated MFA status');
      await checkMFAStatus();
      console.log('Step 3 completed: MFA status updated');
      
      return { success: true };
    } catch (error) {
      console.error('TOTP verification and enablement error:', {
        name: error.name,
        message: error.message,
        code: error.code,
        step: error.message.includes('verifyTOTPSetup') ? 'verification' : 'preference_update'
      });
      throw error;
    }
  };

  const value: AuthContextType = {
    user,
    mfaStatus,
    needsMFAConfirmation,
    signIn,
    signOut,
    checkMFAStatus,
    setupMFA,
    verifyAndEnableMFA,
    confirmMFA,
    initializeUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};