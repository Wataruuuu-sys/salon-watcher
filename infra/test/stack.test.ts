import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { SalonWatcherStack } from '../lib/salonWatcherStack.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let template: Template;

const testContext = {
  ownerEmail: 'owner@test.invalid',
  notifyFrom: 'noreply@test.invalid',
  notifyTo: 'owner@test.invalid',
  cognitoDomainPrefix: 'salon-watcher-test',
  sourcesDisabled: 'threads',
};

/** The state machine definition with CloudFormation tokens replaced by a placeholder. */
function definition(): { States: Record<string, Record<string, unknown>> } {
  const sm = Object.values(template.findResources('AWS::StepFunctions::StateMachine'))[0]!;
  const parts = sm.Properties.DefinitionString['Fn::Join'][1] as unknown[];
  return JSON.parse(parts.map((p) => (typeof p === 'string' ? p : 'TOKEN')).join(''));
}

beforeAll(() => {
  const out = path.resolve(here, '../../web/out');
  if (!existsSync(out)) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'index.html'), '<html></html>');
  }
  const app = new App({ context: testContext });
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

  it('alarms on pipeline failures/timeouts and refresh/notify lambda errors, all to SNS', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 4);
    const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm')).map((r) => r.Properties);
    expect(alarms.map((a) => a.MetricName).sort()).toEqual(['Errors', 'Errors', 'ExecutionsFailed', 'ExecutionsTimedOut']);
    for (const a of alarms) expect(a.AlarmActions).toHaveLength(1);
    const errorFns = alarms
      .filter((a) => a.MetricName === 'Errors')
      .map((a) => JSON.stringify(a.Dimensions));
    expect(errorFns.some((d) => d.includes('NotifyFn'))).toBe(true);
  });

  it('catches Process failures so Hpb still runs, then fails the execution', () => {
    const states = definition().States;
    const catchers = states.Process!.Catch as { ErrorEquals: string[]; ResultPath: string; Next: string }[];
    expect(catchers).toEqual([{ ErrorEquals: ['States.ALL'], ResultPath: '$.processError', Next: 'Hpb' }]);
    const choice = JSON.stringify(states.AnyShardFailed);
    expect(choice).toContain('processError');
  });

  it('outputs the Cognito authority URL', () => {
    const out = template.findOutputs('CognitoAuthority');
    expect(JSON.stringify(out)).toContain('https://cognito-idp.');
  });

  it('cdk.json carries no deploy context defaults', () => {
    const cdkJson = JSON.parse(readFileSync(path.resolve(here, '../cdk.json'), 'utf8'));
    expect(cdkJson.context ?? {}).not.toHaveProperty('ownerEmail');
    expect(JSON.stringify(cdkJson)).not.toContain('example.com');
  });

  it('rejects missing or example.com context', () => {
    const make = (context: Record<string, string>) => () =>
      new SalonWatcherStack(new App({ context }), 'S');
    const { ownerEmail: _drop, ...rest } = testContext;
    expect(make(rest)).toThrow(/missing CDK context: ownerEmail/);
    expect(make({ ...testContext, notifyTo: 'a@example.com' })).toThrow(/example\.com.*notifyTo|notifyTo.*example\.com/);
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
