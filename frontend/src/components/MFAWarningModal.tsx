import React from 'react';
import Modal from '@cloudscape-design/components/modal';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import { useNavigate } from 'react-router-dom';
import type { MFAStatus } from '../types/auth';

interface MFAWarningModalProps {
  visible: boolean;
  mfaStatus: MFAStatus;
  onDismiss: () => void;
}

const MFAWarningModal: React.FC<MFAWarningModalProps> = ({
  visible,
  mfaStatus,
  onDismiss
}) => {
  const navigate = useNavigate();

  const getWarningTitle = (daysRemaining: number) => {
    if (daysRemaining > 30) {
      return 'セキュリティ強化のお知らせ';
    } else if (daysRemaining > 7) {
      return '多要素認証の設定期限が近づいています';
    } else if (daysRemaining > 0) {
      return '【緊急】多要素認証の設定が必要です';
    } else {
      const gracePeriodDays = 7;
      const daysOverDeadline = Math.abs(daysRemaining);
      if (daysOverDeadline <= gracePeriodDays) {
        return '【猶予期間中】多要素認証の設定が必要です';
      } else {
        return '【至急】多要素認証の設定が必須です';
      }
    }
  };

  const getWarningMessage = (daysRemaining: number) => {
    if (daysRemaining > 30) {
      return `アカウントのセキュリティを強化するため、多要素認証（MFA）の設定をお願いいたします。設定期限まで${daysRemaining}日です。`;
    } else if (daysRemaining > 7) {
      return `多要素認証の設定期限まで${daysRemaining}日です。お早めに設定をお願いします。`;
    } else if (daysRemaining > 0) {
      return `多要素認証の設定期限まで${daysRemaining}日です。設定しないとログインできなくなります。今すぐ設定してください。`;
    } else {
      const gracePeriodDays = 7;
      const daysOverDeadline = Math.abs(daysRemaining);
      if (daysOverDeadline <= gracePeriodDays) {
        return `多要素認証の設定期限を過ぎていますが、猶予期間中です（残り${gracePeriodDays - daysOverDeadline}日）。至急設定してください。`;
      } else {
        return '多要素認証の設定期限を過ぎています。ログインには多要素認証の設定が必須です。';
      }
    }
  };

  const getButtonText = (daysRemaining: number) => {
    if (daysRemaining > 7) {
      return '設定する';
    } else {
      return '今すぐ設定する';
    }
  };

  const handleSetupMFA = () => {
    onDismiss();
    navigate('/mfa-setup');
  };

  const canSkip = mfaStatus.daysRemaining > 0;

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={getWarningTitle(mfaStatus.daysRemaining)}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            {canSkip && (
              <Button variant="link" onClick={onDismiss}>
                後で設定する
              </Button>
            )}
            <Button variant="primary" onClick={handleSetupMFA}>
              {getButtonText(mfaStatus.daysRemaining)}
            </Button>
          </SpaceBetween>
        </Box>
      }
      size="medium"
    >
      <SpaceBetween direction="vertical" size="m">
        <Alert 
          type={mfaStatus.warningLevel}
          header="多要素認証について"
        >
          {getWarningMessage(mfaStatus.daysRemaining)}
        </Alert>
        
        <Box>
          <SpaceBetween direction="vertical" size="s">
            <Box variant="h4">設定可能な認証方式</Box>
            <ul>
              <li><strong>SMS認証</strong>: 携帯電話番号にワンタイムパスワードを送信</li>
              <li><strong>認証アプリ（TOTP）</strong>: Google Authenticator等の認証アプリを使用</li>
            </ul>
          </SpaceBetween>
        </Box>

        <Box>
          <SpaceBetween direction="vertical" size="s">
            <Box variant="h4">設定期限</Box>
            <Box>
              期限: {mfaStatus.migrationDeadline.toLocaleDateString('ja-JP')}
              {mfaStatus.daysRemaining > 0 ? (
                <Box color="text-status-info">（残り{mfaStatus.daysRemaining}日）</Box>
              ) : (
                <Box color="text-status-error">（期限超過 {Math.abs(mfaStatus.daysRemaining)}日）</Box>
              )}
            </Box>
          </SpaceBetween>
        </Box>
      </SpaceBetween>
    </Modal>
  );
};

export default MFAWarningModal;