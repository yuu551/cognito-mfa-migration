import { Amplify } from 'aws-amplify';

const amplifyConfig = {
  Auth: {
    Cognito: {
      region: import.meta.env.VITE_COGNITO_REGION,
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
      signUpVerificationMethod: 'code', // 'code' | 'link'
      loginWith: {
        email: true,
        phone: false,
        username: true
      },
      // MFA設定を追加
      mfaConfiguration: 'OPTIONAL',
      mfaTypes: ['TOTP', 'SMS']
    }
  }
};

Amplify.configure(amplifyConfig);

export default amplifyConfig;