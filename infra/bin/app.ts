import { App } from 'aws-cdk-lib';
import { SalonWatcherStack } from '../lib/salonWatcherStack.js';

const app = new App();
new SalonWatcherStack(app, 'SalonWatcherStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1' },
});
