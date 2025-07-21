import React, { useState } from 'react';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Header from '@cloudscape-design/components/header';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import { useAuth } from '../contexts/AuthContext';

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { signIn, confirmMFA, needsMFAConfirmation } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (needsMFAConfirmation) {
        await confirmMFA(totpCode);
      } else {
        await signIn(username, password);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Pre-authentication Lambda のエラーメッセージを表示
      if (errorMessage.includes('MFA')) {
        setError(errorMessage);
      } else {
        setError('ログインに失敗しました。ユーザー名とパスワードを確認してください。');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      backgroundColor: '#f9f9f9',
      padding: '16px'
    }}>
      <div style={{ width: '400px' }}>
        <Container
          header={
            <Header 
              variant="h1"
              description="AWS MFA移行システムにサインインしてください"
            >
              サインイン
            </Header>
          }
        >
          <form onSubmit={handleSubmit}>
            <SpaceBetween direction="vertical" size="l">
              {error && (
                <Alert type="error" dismissible onDismiss={() => setError('')}>
                  {error}
                </Alert>
              )}
              
              <FormField 
                label="ユーザー名"
                description={needsMFAConfirmation ? "認証中のユーザー" : undefined}
              >
                <Input
                  value={username}
                  onChange={({ detail }) => setUsername(detail.value)}
                  placeholder="ユーザー名を入力"
                  disabled={loading || needsMFAConfirmation}
                />
              </FormField>

              {!needsMFAConfirmation && (
                <FormField label="パスワード">
                  <Input
                    type="password"
                    value={password}
                    onChange={({ detail }) => setPassword(detail.value)}
                    placeholder="パスワードを入力"
                    disabled={loading}
                  />
                </FormField>
              )}

              {needsMFAConfirmation && (
                <>
                  <Alert type="info" header="多要素認証が必要です">
                    {username} として認証を続行します。認証アプリに表示されたコードを入力してください。
                  </Alert>
                  <FormField 
                    label="認証コード" 
                    description="認証アプリに表示された6桁のコードを入力してください"
                  >
                    <Input
                      value={totpCode}
                      onChange={({ detail }) => setTotpCode(detail.value)}
                      placeholder="123456"
                      disabled={loading}
                    />
                  </FormField>
                </>
              )}

              <Button 
                variant="primary" 
                loading={loading}
                disabled={needsMFAConfirmation ? !totpCode || totpCode.length !== 6 : !username || !password}
                fullWidth
              >
                {needsMFAConfirmation ? '認証を確認' : 'サインイン'}
              </Button>

              <Box textAlign="center" color="text-body-secondary" fontSize="body-s">
                <SpaceBetween direction="vertical" size="xs">
                  <Box>テストアカウント: testuser1 / Password123!</Box>
                  <Box>MFA移行期限: {import.meta.env.VITE_MFA_DEADLINE}</Box>
                </SpaceBetween>
              </Box>
            </SpaceBetween>
          </form>
        </Container>
      </div>
    </div>
  );
};

export default Login;