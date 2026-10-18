import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { SalonWatcherStack } from '../lib/salonWatcherStack.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let template: Template;

beforeAll(() => {
  const out = path.resolve(here, '../../web/out');
  if (!existsSync(out)) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'index.html'), '<html></html>');
  }
  const app = new App({
    context: {
      ownerEmail: 'owner@example.com',
      notifyFrom: 'noreply@example.com',
      notifyTo: 'owner@example.com',
      cognitoDomainPrefix: 'salon-watcher-test',
      sourcesDisabled: 'threads',
    },
  });
  template = Template.fromStack(new SalonWatcherStack(app, 'TestStack'));
});

describe('SalonWatcherStack', () => {
  it('defines four JST schedules with the expected expressions', () => {
    template.resourceCountIs('AWS::Scheduler::Schedule', 4);
    const schedules = Object.values(template.findResources('AWS::Scheduler::Schedule')).map((r) => r.Properties);
    expect(schedules.map((s) => s.ScheduleExpression).sort()).toEqual(
      [
        'cron(0 0,6,12,18 * * ? *)',
        'cron(0 5 * * ? *)',
        'cron(0 7 * * ? *)',
        'cron(0 4 ? * MON *)',
      ].sort(),
    );
    for (const s of schedules) expect(s.ScheduleExpressionTimezone).toBe('Asia/Tokyo');
  });

  it('has a single state machine', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
  });

  it('disables self sign-up in Cognito', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it('has two alarms', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 2);
  });

  it('runs lambdas on Node.js 22 arm64 with SSM prefix', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Environment: { Variables: Match.objectLike({ SSM_PREFIX: '/salon-watcher/' }) },
    });
  });

  it('passes SOURCES_DISABLED from context to collect lambdas', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ SOURCES_DISABLED: 'threads' }) },
    });
  });
});
