import * as dotenv from 'dotenv';
import { MFAMigrationDemo } from './examples';

dotenv.config();

async function main() {
  console.log('📋 AWS Cognito MFA Migration Patterns - Implementation Demo');
  console.log('================================================');
  
  const demo = new MFAMigrationDemo();
  
  try {
    await demo.runAllDemos();
  } catch (error) {
    console.error('Error running demos:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export * from './types';
export * from './services/MFAController';
export * from './services/UserMigrationManager';
export * from './services/NotificationService';
export * from './services/MultipleUserPoolStrategy';
export * from './lambda/preAuthentication';
export * from './examples';