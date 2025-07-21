import { Amplify } from 'aws-amplify';

const amplifyConfig = {
  Auth: {
    Cognito: {
      region: import.meta.env.VITE_COGNITO_REGION,
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
      signUpVerificationMethod: 'code' as const,
      loginWith: {
        email: true,
        phone: false,
        username: true
      },
      // MFA設定を追加
      mfaConfiguration: 'OPTIONAL' as const,
      mfaTypes: ['TOTP', 'SMS'] as const
    }
  }
};

Amplify.configure(amplifyConfig);

export default amplifyConfig;