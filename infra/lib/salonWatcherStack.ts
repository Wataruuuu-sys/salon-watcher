import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_apigatewayv2 as apigw,
  aws_apigatewayv2_authorizers as apigwAuth,
  aws_apigatewayv2_integrations as apigwInt,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cwActions,
  aws_cognito as cognito,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_scheduler as scheduler,
  aws_ses as ses,
  aws_sns as sns,
  aws_sns_subscriptions as snsSubs,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const handlersDir = path.join(repoRoot, 'backend/src/handlers');
const SSM_PREFIX = '/salon-watcher/';

export class SalonWatcherStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const ctx = (key: string, fallback?: string): string => {
      const v = this.node.tryGetContext(key) as string | undefined;
      if (v === undefined && fallback === undefined) throw new Error(`missing CDK context: ${key}`);
      return v ?? fallback ?? '';
    };
    const ownerEmail = ctx('ownerEmail');
    const notifyFrom = ctx('notifyFrom');
    const notifyTo = ctx('notifyTo');
    const cognitoDomainPrefix = ctx('cognitoDomainPrefix');
    const sourcesDisabled = ctx('sourcesDisabled', '');

    // ---- Web hosting (S3 + CloudFront OAC) ----
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    // Next.js static export uses trailingSlash: map /foo and /foo/ to /foo/index.html.
    const rewrite = new cloudfront.Function(this, 'IndexRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) request.uri = uri + 'index.html';
  else if (uri.split('/').pop().indexOf('.') === -1) request.uri = uri + '/index.html';
  return request;
}`,
      ),
    });
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          { function: rewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html' },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html' },
      ],
    });
    const siteUrl = `https://${distribution.distributionDomainName}`;
    new s3deploy.BucketDeployment(this, 'SiteDeployment', {
      sources: [s3deploy.Source.asset(path.join(repoRoot, 'web/out'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ---- Lambdas ----
    const ssmArn = this.formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: `${SSM_PREFIX.slice(1)}*`,
    });
    const ssmRead = new iam.PolicyStatement({
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: [ssmArn],
    });
    const ssmKmsDecrypt = new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: [this.formatArn({ service: 'kms', resource: 'key', resourceName: '*' })],
      conditions: { StringEquals: { 'kms:RequestAlias': 'alias/aws/ssm' } },
    });

    const makeFn = (
      name: string,
      file: string,
      handler: string,
      opts: { timeout?: Duration; memory?: number; env?: Record<string, string> } = {},
    ): nodejs.NodejsFunction => {
      const fn = new nodejs.NodejsFunction(this, name, {
        entry: path.join(handlersDir, file),
        handler,
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        timeout: opts.timeout ?? Duration.seconds(60),
        memorySize: opts.memory ?? 512,
        depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
        projectRoot: repoRoot,
        environment: { SSM_PREFIX, ...opts.env },
        bundling: {
          format: nodejs.OutputFormat.ESM,
          target: 'node22',
          mainFields: ['module', 'main'],
          banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
        },
      });
      fn.addToRolePolicy(ssmRead);
      fn.addToRolePolicy(ssmKmsDecrypt);
      return fn;
    };

    const long = { timeout: Duration.minutes(15), memory: 1024 };
    const sourceEnv = { SOURCES_DISABLED: sourcesDisabled };
    const listShardsFn = makeFn('ListShardsFn', 'collect.ts', 'listShardsHandler', { env: sourceEnv });
    const collectFn = makeFn('CollectFn', 'collect.ts', 'collectHandler', { ...long, env: sourceEnv });
    const processFn = makeFn('ProcessFn', 'process.ts', 'processHandler', long);
    const hpbFn = makeFn('HpbFn', 'hpb.ts', 'hpbHandler', long);
    const notifyFn = makeFn('NotifyFn', 'notify.ts', 'notifyHandler', {
      timeout: Duration.minutes(5),
      env: { NOTIFY_FROM: notifyFrom, NOTIFY_TO: notifyTo, UI_URL: siteUrl },
    });
    notifyFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail', 'ses:SendRawEmail'], resources: ['*'] }));
    const refreshFn = makeFn('RefreshThreadsTokenFn', 'refreshThreadsToken.ts', 'refreshThreadsTokenHandler');
    refreshFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:PutParameter'],
        resources: [this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: `${SSM_PREFIX.slice(1)}THREADS_ACCESS_TOKEN` })],
      }),
    );
    const apiFn = makeFn('ApiFn', 'api.ts', 'handler', { timeout: Duration.seconds(30) });

    // ---- Step Functions pipeline ----
    const invoke = (id: string, fn: lambda.IFunction, extra: Partial<tasks.LambdaInvokeProps> = {}) =>
      new tasks.LambdaInvoke(this, id, { lambdaFunction: fn, payloadResponseOnly: true, ...extra });

    const listShards = invoke('ListShards', listShardsFn);
    const collectTask = invoke('Collect', collectFn, { resultSelector: { ok: true } });
    const collectFailed = new sfn.Pass(this, 'CollectFailed', {
      parameters: {
        ok: false,
        'source.$': '$.source',
        'shard.$': '$.shard',
        'error.$': '$.error',
      },
    });
    collectTask.addCatch(collectFailed, { errors: ['States.ALL'], resultPath: '$.error' });
    const collectMap = new sfn.Map(this, 'CollectShards', {
      itemsPath: '$.tasks',
      maxConcurrency: 6,
      resultPath: '$.collectResults',
    });
    collectMap.itemProcessor(collectTask);
    const processTask = invoke('Process', processFn, { payload: sfn.TaskInput.fromObject({}), resultPath: '$.processResult', payloadResponseOnly: true });
    const hpbTask = invoke('Hpb', hpbFn, { payload: sfn.TaskInput.fromObject({}), resultPath: '$.hpbResult', payloadResponseOnly: true });
    const shardsFailed = new sfn.Fail(this, 'ShardsFailed', {
      error: 'CollectShardsFailed',
      cause: 'One or more collect shards failed; see collectResults in the execution output.',
    });
    const anyFailed = sfn.Condition.jsonata('{% $count($states.input.collectResults[ok = false]) > 0 %}');

    const definition = listShards
      .next(collectMap)
      .next(processTask)
      .next(hpbTask)
      .next(new sfn.Choice(this, 'AnyShardFailed', { queryLanguage: sfn.QueryLanguage.JSONATA }).when(anyFailed, shardsFailed).otherwise(new sfn.Succeed(this, 'Done')));

    const pipeline = new sfn.StateMachine(this, 'Pipeline', {
      stateMachineName: 'salon-watcher-pipeline',
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(3),
    });

    // ---- Schedules (JST) ----
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    pipeline.grantStartExecution(schedulerRole);
    notifyFn.grantInvoke(schedulerRole);
    refreshFn.grantInvoke(schedulerRole);

    const addSchedule = (name: string, expression: string, targetArn: string, input: unknown) =>
      new scheduler.CfnSchedule(this, name, {
        scheduleExpression: expression,
        scheduleExpressionTimezone: 'Asia/Tokyo',
        flexibleTimeWindow: { mode: 'OFF' },
        target: { arn: targetArn, roleArn: schedulerRole.roleArn, input: JSON.stringify(input) },
      });
    addSchedule('ThreadsSchedule', 'cron(0 0,6,12,18 * * ? *)', pipeline.stateMachineArn, { sources: ['threads'] });
    addSchedule('GoogleMapsSchedule', 'cron(0 5 * * ? *)', pipeline.stateMachineArn, { sources: ['google_maps'] });
    addSchedule('NotifySchedule', 'cron(0 7 * * ? *)', notifyFn.functionArn, {});
    addSchedule('TokenRefreshSchedule', 'cron(0 4 ? * MON *)', refreshFn.functionArn, {});

    // ---- Alarms ----
    const alarmTopic = new sns.Topic(this, 'AlarmTopic');
    alarmTopic.addSubscription(new snsSubs.EmailSubscription(ownerEmail));
    const alarmAction = new cwActions.SnsAction(alarmTopic);
    const pipelineAlarm = new cw.Alarm(this, 'PipelineFailedAlarm', {
      metric: pipeline.metricFailed({ period: Duration.hours(1), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    const refreshAlarm = new cw.Alarm(this, 'RefreshTokenErrorsAlarm', {
      metric: refreshFn.metricErrors({ period: Duration.hours(1), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    pipelineAlarm.addAlarmAction(alarmAction);
    refreshAlarm.addAlarmAction(alarmAction);

    // ---- Cognito ----
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    userPool.addDomain('HostedUi', { cognitoDomain: { domainPrefix: cognitoDomainPrefix } });
    const userPoolClient = userPool.addClient('WebClient', {
      generateSecret: false,
      authFlows: {},
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`${siteUrl}/callback`, `${siteUrl}/callback/`],
        logoutUrls: [siteUrl],
      },
    });

    // ---- HTTP API ----
    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: [siteUrl],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.PUT, apigw.CorsHttpMethod.DELETE],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    });
    const authorizer = new apigwAuth.HttpJwtAuthorizer(
      'JwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );
    const integration = new apigwInt.HttpLambdaIntegration('ApiIntegration', apiFn);
    httpApi.addRoutes({ path: '/leads', methods: [apigw.HttpMethod.GET], integration, authorizer });
    httpApi.addRoutes({
      path: '/settings/threads-queries',
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.PUT, apigw.HttpMethod.DELETE],
      integration,
      authorizer,
    });

    // ---- SES ----
    new ses.EmailIdentity(this, 'NotifyFromIdentity', { identity: ses.Identity.email(notifyFrom) });

    new CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', {
      value: `${cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`,
    });
  }
}
