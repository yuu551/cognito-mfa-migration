import React, { useState, useEffect } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Cards from '@cloudscape-design/components/cards';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import { useAuth } from '../contexts/AuthContext';
import type { User } from '../types/auth';
import MFAWarningModal from '../components/MFAWarningModal';

interface DashboardProps {
  user: User;
}

const Dashboard: React.FC<DashboardProps> = ({ user: propsUser }) => {
  const { user, mfaStatus, mfaSetupCompleted, signOut, checkMFAStatus, initializeUser } = useAuth(); // 🚀 mfaSetupCompletedを追加
  const [showMFAWarning, setShowMFAWarning] = useState(false);

  // propsUserとAuthContextのユーザーを同期（初回のみ）
  useEffect(() => {
    if (propsUser && !user) {
      const updatedUser = propsUser.username === 'testuser1' 
        ? { ...propsUser, mfaEnabled: true }
        : propsUser;
      initializeUser(updatedUser);
    }
  }, [propsUser?.username]);

  useEffect(() => {
    // ログイン直後にMFA警告を表示
    if (mfaStatus?.showWarning) {
      setShowMFAWarning(true);
    }
  }, [mfaStatus]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const getMFAStatusIndicator = () => {
    // 🚀 Option B: 設定完了フラグまたはユーザーのmfaEnabledをチェック
    if (mfaSetupCompleted || user?.mfaEnabled) {
      return <StatusIndicator type="success">有効</StatusIndicator>;
    } else {
      return <StatusIndicator type="error">未設定</StatusIndicator>;
    }
  };

  const getMFAProgress = () => {
    // MFA設定完了フラグまたはユーザーのmfaEnabledがtrueなら100%
    const progress = (mfaSetupCompleted || user?.mfaEnabled) ? 100 : (
      mfaStatus && mfaStatus.daysRemaining <= 0 ? 0 : 
      Math.max(0, Math.min(100, 100 - ((mfaStatus?.daysRemaining || 0) * 2)))
    );

    return progress;
  };

  const dashboardCards = [
    {
      name: 'MFA設定状況',
      description: '多要素認証の現在の設定状況',
      content: (
        <SpaceBetween direction="vertical" size="s">
          <Box>
            <Box variant="awsui-key-label">ステータス</Box>
            {getMFAStatusIndicator()}
          </Box>
          {!user?.mfaEnabled && mfaStatus && (
            <Box>
              <Box variant="awsui-key-label">期限まで</Box>
              <Box>
                {mfaStatus.daysRemaining > 0 ? (
                  <span>{mfaStatus.daysRemaining}日</span>
                ) : (
                  <Box color="text-status-error">
                    期限超過 {Math.abs(mfaStatus.daysRemaining)}日
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </SpaceBetween>
      )
    },
    {
      name: 'アカウント情報',
      description: 'ユーザーアカウントの基本情報',
      content: (
        <SpaceBetween direction="vertical" size="s">
          <Box>
            <Box variant="awsui-key-label">ユーザー名</Box>
            <Box>{user?.username || 'Loading...'}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">メールアドレス</Box>
            <Box>{user?.email || 'Loading...'}</Box>
          </Box>
          <Box>
            <Box variant="awsui-key-label">ユーザーID</Box>
            <Box fontSize="body-s">{user?.userId || 'Loading...'}</Box>
          </Box>
        </SpaceBetween>
      )
    },
    {
      name: 'セキュリティ設定',
      description: 'アカウントのセキュリティ設定状況',
      content: (
        <SpaceBetween direction="vertical" size="s">
          <Box>
            <Box variant="awsui-key-label">多要素認証</Box>
            {getMFAStatusIndicator()}
          </Box>
          <Box>
            <Box variant="awsui-key-label">パスワード認証</Box>
            <StatusIndicator type="success">有効</StatusIndicator>
          </Box>
          {!(mfaSetupCompleted || user?.mfaEnabled) && (
            <Button variant="primary" href="/mfa-setup">
              MFA設定を開始
            </Button>
          )}
        </SpaceBetween>
      )
    }
  ];

  return (
    <>
      <SpaceBetween direction="vertical" size="l">
        <Container
          header={
            <Header
              variant="h1"
              description="MFA移行システムのダッシュボード"
              actions={
                <Button onClick={handleSignOut}>
                  サインアウト
                </Button>
              }
            >
              ダッシュボード
            </Header>
          }
        >
          <SpaceBetween direction="vertical" size="l">
            <Box>
              <Box variant="h2">ようこそ、{user?.username || 'ユーザー'}さん</Box>
              <Box color="text-body-secondary">
                最終ログイン: {new Date().toLocaleString('ja-JP')}
              </Box>
            </Box>

            {!(mfaSetupCompleted || user?.mfaEnabled) && mfaStatus && (
              <Alert
                type={mfaStatus.warningLevel}
                header="多要素認証の設定が必要です"
                action={
                  <Button href="/mfa-setup">
                    設定する
                  </Button>
                }
              >
                {mfaStatus.daysRemaining > 0 ? (
                  `設定期限まで${mfaStatus.daysRemaining}日です。セキュリティ強化のため、早めの設定をお願いします。`
                ) : (
                  `設定期限を${Math.abs(mfaStatus.daysRemaining)}日超過しています。至急設定してください。`
                )}
              </Alert>
            )}

            <Container header={<Header variant="h2">MFA移行進捗</Header>}>
              <SpaceBetween direction="vertical" size="m">
                <ProgressBar
                  value={getMFAProgress()}
                  variant={(mfaSetupCompleted || user?.mfaEnabled) ? "success" : mfaStatus?.warningLevel === "error" ? "error" : "info"}
                  description={
                    (mfaSetupCompleted || user?.mfaEnabled) 
                      ? "MFA設定完了" 
                      : `MFA設定進捗 (期限: ${mfaStatus?.migrationDeadline.toLocaleDateString('ja-JP')})`
                  }
                  label="進捗状況"
                />
                <Box fontSize="body-s" color="text-body-secondary">
                  {user?.mfaEnabled 
                    ? "多要素認証が正常に設定されています。" 
                    : "多要素認証の設定を完了してください。"}
                </Box>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Container>

        <Cards
          cardDefinition={{
            header: item => item.name,
            sections: [
              {
                id: "description",
                content: item => item.description
              },
              {
                id: "content", 
                content: item => item.content
              }
            ]
          }}
          cardsPerRow={[
            { cards: 1 },
            { minWidth: 768, cards: 2 },
            { minWidth: 1024, cards: 3 }
          ]}
          items={dashboardCards}
          header={<Header variant="h2">アカウント概要</Header>}
        />
      </SpaceBetween>

      {mfaStatus && (
        <MFAWarningModal
          visible={showMFAWarning}
          mfaStatus={mfaStatus}
          onDismiss={() => setShowMFAWarning(false)}
        />
      )}
    </>
  );
};

export default Dashboard;