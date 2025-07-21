import React, { useState, useMemo } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Wizard from '@cloudscape-design/components/wizard';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import FormField from '@cloudscape-design/components/form-field';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Input from '@cloudscape-design/components/input';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import QRCode from 'qrcode';
import { useAuth } from '../contexts/AuthContext';
import type { User } from '../types/auth';

interface MFASetupProps {
  user: User;
}

const MFASetup: React.FC<MFASetupProps> = ({ user }) => {
  const { setupMFA, checkMFAStatus, verifyAndEnableMFA, setMfaSetupCompleted } = useAuth(); // 🚀 setMfaSetupCompletedを追加
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [mfaMethod, setMfaMethod] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [setupComplete, setSetupComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateQRCode = async (secret: string, username: string) => {
    const otpauthUrl = `otpauth://totp/MFA%20Migration%20System:${username}?secret=${secret}&issuer=MFA%20Migration%20System`;
    try {
      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
      setQrCodeUrl(qrCodeDataUrl);
    } catch (error) {
      console.error('QR Code generation error:', error);
    }
  };

  const handleMethodSelection = async () => {
    if (mfaMethod === 'TOTP') {
      setLoading(true);
      setError('');
      try {
        const totpSetupDetails = await setupMFA('TOTP');
        
        // AWS Amplifyの戻り値の構造を確認
        const setupUri = totpSetupDetails.getSetupUri ? 
          totpSetupDetails.getSetupUri('MFA Migration System', user.username) : 
          totpSetupDetails.setupUri;
        
        if (typeof setupUri === 'string') {
          const secretMatch = setupUri.match(/secret=([A-Z2-7]+)/);
          const secret = secretMatch ? secretMatch[1] : '';
          setTotpSecret(secret);
          await generateQRCode(secret, user.username);
        } else {
          const secret = totpSetupDetails.secret || totpSetupDetails.sharedSecret || '';
          setTotpSecret(secret);
          await generateQRCode(secret, user.username);
        }
        
        setActiveStepIndex(2); // Skip phone number step for TOTP
      } catch (error: any) {
        console.error('TOTP setup detailed error:', {
          name: error.name,
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        
        if (error.name === 'NotAuthorizedException') {
          setError('認証エラー: MFA設定の権限がありません。再ログインしてください。');
        } else if (error.name === 'InvalidParameterException') {
          setError('設定エラー: MFA設定に必要なパラメータが不足しています。');
        } else if (error.message.includes('No mfa settings given')) {
          setError('MFA設定エラー: User PoolでMFAが有効になっていない可能性があります。管理者にお問い合わせください。');
        } else {
          setError('TOTP設定の準備中にエラーが発生しました: ' + error.message);
        }
      } finally {
        setLoading(false);
      }
    } else if (mfaMethod === 'SMS') {
      setActiveStepIndex(1); // Go to phone number step
    }
  };

  const handlePhoneVerification = async () => {
    // SMS MFA設定のロジック（実装予定）
    setError('SMS MFA設定は現在準備中です。TOTPをご利用ください。');
  };

  const handleTOTPVerification = async () => {
    setLoading(true);
    setError('');
    try {
      if (verificationCode.length !== 6) {
        setError('6桁の認証コードを入力してください。');
        return;
      }

      // AWS CognitoでTOTPコードを検証してMFAを有効化
      await verifyAndEnableMFA(verificationCode);
      
      // MFA設定完了フラグを直接立てる
      setMfaSetupCompleted(true);
      
      setSetupComplete(true);
      setActiveStepIndex(3); // Go to completion step
    } catch (error: any) {
      console.error('TOTP verification error:', error);
      
      if (error.name === 'CodeMismatchException') {
        setError('認証コードが正しくありません。認証アプリから最新のコードを入力してください。');
      } else if (error.name === 'LimitExceededException') {
        setError('試行回数が上限に達しました。しばらく待ってから再試行してください。');
      } else {
        setError('認証コードの検証中にエラーが発生しました: ' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const steps = [
    {
      title: "認証方式の選択",
      content: (
        <SpaceBetween direction="vertical" size="l">
          <Box>
            <Box variant="h2">多要素認証方式を選択してください</Box>
            <Box color="text-body-secondary">
              アカウントのセキュリティを強化するため、追加の認証方式を設定します。
            </Box>
          </Box>

          <FormField label="認証方式" errorText={error}>
            <RadioGroup
              onChange={({ detail }) => setMfaMethod(detail.value)}
              value={mfaMethod}
              items={[
                {
                  value: "TOTP",
                  label: "認証アプリ（TOTP）",
                  description: "Google Authenticator、Microsoft Authenticator等のアプリを使用"
                },
                {
                  value: "SMS", 
                  label: "SMS認証",
                  description: "携帯電話番号にワンタイムパスワードを送信"
                }
              ]}
            />
          </FormField>

          <Alert type="info">
            <SpaceBetween direction="vertical" size="s">
              <Box variant="strong">推奨: 認証アプリ（TOTP）</Box>
              <Box>
                認証アプリは、インターネット接続がなくても使用でき、
                SMS認証よりもセキュリティが高いため推奨されます。
              </Box>
            </SpaceBetween>
          </Alert>
        </SpaceBetween>
      )
    },
    {
      title: "電話番号の設定",
      content: (
        <SpaceBetween direction="vertical" size="l">
          <Box>
            <Box variant="h2">電話番号を入力してください</Box>
            <Box color="text-body-secondary">
              SMS認証コードを受信する電話番号を入力してください。
            </Box>
          </Box>

          <FormField 
            label="電話番号" 
            description="国際形式で入力してください（例: +81901234567）"
            errorText={error}
          >
            <Input
              value={phoneNumber}
              onChange={({ detail }) => setPhoneNumber(detail.value)}
              placeholder="+81901234567"
              disabled={loading}
            />
          </FormField>

          <Alert type="warning">
            SMS認証は現在準備中です。認証アプリ（TOTP）をご利用ください。
          </Alert>
        </SpaceBetween>
      )
    },
    {
      title: "認証アプリの設定",
      content: (
        <SpaceBetween direction="vertical" size="l">
          <Box>
            <Box variant="h2">認証アプリでQRコードをスキャンしてください</Box>
            <Box color="text-body-secondary">
              Google AuthenticatorやMicrosoft Authenticator等のアプリでQRコードを読み取り、
              表示された6桁のコードを入力してください。
            </Box>
          </Box>

          {qrCodeUrl && (
            <Box textAlign="center">
              <img src={qrCodeUrl} alt="TOTP QR Code" style={{ maxWidth: '256px' }} />
            </Box>
          )}

          <Alert type="info">
            <SpaceBetween direction="vertical" size="s">
              <Box variant="strong">手動入力する場合</Box>
              <Box>
                アプリで手動入力を選択し、以下のシークレットキーを入力してください:
              </Box>
              <Box fontFamily="monospace" fontSize="body-s">
                {totpSecret}
              </Box>
            </SpaceBetween>
          </Alert>

          <FormField 
            label="認証コード" 
            description="認証アプリに表示された6桁のコードを入力してください"
            errorText={error}
          >
            <Input
              value={verificationCode}
              onChange={({ detail }) => setVerificationCode(detail.value)}
              placeholder="123456"
              maxLength={6}
              disabled={loading}
            />
          </FormField>
        </SpaceBetween>
      )
    },
    {
      title: "設定完了",
      content: (
        <SpaceBetween direction="vertical" size="l">
          <Box textAlign="center">
            <SpaceBetween direction="vertical" size="m">
              <StatusIndicator type="success" iconAriaLabel="Success">
                多要素認証の設定が完了しました
              </StatusIndicator>
              
              <Box>
                <Box variant="h2">設定完了</Box>
                <Box color="text-body-secondary">
                  アカウントのセキュリティが強化されました。
                  次回ログイン時から多要素認証が必要になります。
                </Box>
              </Box>

              <Alert type="success">
                <SpaceBetween direction="vertical" size="s">
                  <Box variant="strong">重要な注意事項</Box>
                  <ul>
                    <li>認証アプリのバックアップを取ってください</li>
                    <li>認証アプリにアクセスできない場合に備えて、復旧用コードを保存してください</li>
                    <li>機種変更時は事前に新しい端末に認証アプリを移行してください</li>
                  </ul>
                </SpaceBetween>
              </Alert>

              <Button variant="primary" href="/">
                ダッシュボードに戻る
              </Button>
            </SpaceBetween>
          </Box>
        </SpaceBetween>
      )
    }
  ];

  const handleNavigate = (detail: any) => {
    if (detail.requestedStepIndex > activeStepIndex) {
      // Forward navigation
      if (activeStepIndex === 0 && mfaMethod) {
        handleMethodSelection();
      } else if (activeStepIndex === 1 && phoneNumber) {
        handlePhoneVerification();
      } else if (activeStepIndex === 2 && verificationCode) {
        handleTOTPVerification();
      }
    } else {
      // Backward navigation
      setActiveStepIndex(detail.requestedStepIndex);
    }
  };


  const i18nStrings = useMemo(() => {
    const getSubmitButtonText = () => {
      if (activeStepIndex === steps.length - 1) return "完了";
      if (activeStepIndex === 0 && !mfaMethod) return "認証方式を選択";
      if (activeStepIndex === 1 && !phoneNumber) return "電話番号を入力";
      if (activeStepIndex === 2 && (!verificationCode || verificationCode.length !== 6)) return "認証コードを入力";
      return "次へ";
    };

    return {
      submitButton: getSubmitButtonText(),
      cancelButton: "キャンセル", 
      nextButton: "次へ",
      previousButton: "戻る",
      stepNumberLabel: (stepNumber: number) => `ステップ ${stepNumber}`,
      collapsedStepsLabel: (stepNumber: number, stepsCount: number) => 
        `ステップ ${stepNumber} / ${stepsCount}`,
      navigationAriaLabel: "MFA設定ウィザードナビゲーション",
      optional: "任意"
    };
  }, [activeStepIndex, mfaMethod, phoneNumber, verificationCode]);

  return (
    <Container
      header={
        <Header 
          variant="h1"
          description="多要素認証を設定してアカウントのセキュリティを強化します"
        >
          MFA設定ウィザード
        </Header>
      }
    >
      <Wizard
        steps={steps}
        activeStepIndex={activeStepIndex}
        onNavigate={({ detail }) => handleNavigate(detail)}
        allowSkipTo={false}
        i18nStrings={i18nStrings}
        onSubmit={() => {
          if (activeStepIndex === 0 && mfaMethod) {
            handleMethodSelection();
          } else if (activeStepIndex === 1 && phoneNumber) {
            handlePhoneVerification();
          } else if (activeStepIndex === 2 && verificationCode) {
            handleTOTPVerification();
          } else if (activeStepIndex === steps.length - 1) {
            window.location.href = '/';
          }
        }}
        onCancel={() => window.history.back()}
        isLoadingNextStep={loading}
      />
    </Container>
  );
};

export default MFASetup;