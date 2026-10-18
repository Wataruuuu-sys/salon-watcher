# Docker 開発環境・ECS バッチ・Terraform・frontend 改名 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** バッチを ECS Fargate run-task 用の単一 CLI に作り直し、全サービスを Docker で動かせる開発環境（LocalStack 含む）を用意し、CDK を Terraform に置き換え、`web/` を `frontend/` に改名する。

**Architecture:** バッチは `backend/src/batch/main.ts` の CLI（`run` / `notify` / `refresh-threads-token`）。収集はプロセス内並列、判定・HPB 判定は順次。実行環境の差し替え（秘密情報・メール・外部 API・認証）は `backend/src/runtime/` に集約し、`APP_ENV=local` のときだけ有効。インフラは `infra/modules/salon_watcher` を `infra/envs/{local,prod}` から使う Terraform。

**Tech Stack:** TypeScript (Node.js 22), Vitest, Docker / Docker Compose, PostgreSQL 16, LocalStack（2026.03 以降、認証トークン）, Terraform（AWS provider 5.x）+ `tflocal`, AWS CLI, esbuild, Next.js（既存）。

**Spec:** `docs/superpowers/specs/2026-10-18-dev-env-terraform-design.md`（親: `docs/superpowers/specs/2026-10-18-salon-watcher-v4-design.md`）

## Global Constraints

- CLAUDE.md 遵守: 個人メールアドレス・秘密情報をコミットしない。`.env`・`*.tfvars` はコミットせず `.env.example`・`*.tfvars.example` を置く。サンプルのメールは `*.invalid`
- `APP_ENV=local` のときだけ: 秘密情報は環境変数、メールはログ出力のみのモック、認証省略。`FAKE_EXTERNAL=1` は `APP_ENV=local` のときだけ有効。本番は `APP_ENV` 未設定
- バッチのスケジュール（Asia/Tokyo）: `run --sources threads` = `cron(0 0,6,12,18 * * ? *)`、`run --sources google_maps` = `cron(0 5 * * ? *)`、`notify` = `cron(0 7 * * ? *)`、`refresh-threads-token` = `cron(0 4 ? * MON *)`
- バッチの失敗の意味: シャード失敗があっても他シャード・判定・HPB 判定は実行し、最後に終了コード 1。全体の上限時間 2時間（超えたら終了コード 1）
- HPB 判定の1回上限 300、判定（process）は pending が無くなるまで繰り返す（12分打ち切りは撤廃）。Google Map 詳細取得の上限（MAPS_DETAILS_PER_RUN 既定 25/ジャンル）は維持
- Fargate: 0.5 vCPU / 1GB、公開サブネット 2 AZ、パブリック IP あり、セキュリティグループは内向きルールなし。NAT ゲートウェイは作らない
- API は Lambda（timeout 30秒、memory 512）のまま。CORS は CloudFront のサイト URL のみ、Cognito コールバックは `${siteUrl}/callback` と `${siteUrl}/callback/`
- IAM: タスクロール = SSM 読み取り `/salon-watcher/*`、PutParameter は `/salon-watcher/THREADS_ACCESS_TOKEN` のみ、`ses:SendEmail`。実行ロール = ECR 取得・ログ出力のみ
- ログ保持 30 日
- Terraform 入力変数 `owner_email` `notify_from` `notify_to` `cognito_domain_prefix` `sources_disabled`、`example.com` を含む値は validation で拒否
- CDK は完全削除（コード・依存・workspace 登録・テスト）。`infra/` は npm workspace ではない
- 本番 DB の接続文字列は SSM に手動登録（Terraform で作らない）

## Review Focus

1. **本番でローカル用の差し替えが効いてしまう**（`APP_ENV` 未設定なのに `FAKE_EXTERNAL=1` がある、`NEXT_PUBLIC_AUTH_MODE=none` で本番ビルドした）→ 本番の実物（SSM・SES・本物の API・Cognito）が使われる。Task 2・Task 5 にテスト。
2. **一部シャードの収集失敗** → 他シャード・判定・HPB 判定は最後まで実行され、終了コード 1 でアラームが鳴る。Task 4 にテスト。
3. **バッチが外部 API 待ちで止まり続ける** → 2時間で打ち切って終了コード 1（課金の暴走を防ぐ）。Task 4 にテスト（上限時間を注入して短くする）。
4. **公開 IP を持つタスクに外から接続される** → セキュリティグループに内向きルールが無い。Task 7 にテスト。
5. **LocalStack のトークンが無い** → `docker compose up` で db・api・frontend は起動する（それらが localstack に依存しない）。Task 6 にテスト。

## 前提（実行前にオーナーが用意）

- ホストに Docker が無い（Phase 1 実行時点）。Docker Desktop か colima（`brew install colima docker docker-compose` → `colima start`）を入れる。Task 6 以降で必要
- LocalStack の無料 Hobby アカウントを登録し、認証トークンを `.env` の `LOCALSTACK_AUTH_TOKEN` に入れる。Task 8 で必要

---

## File Structure

```
frontend/                         ← web/ を改名
backend/
  src/runtime/
    mode.ts                       isLocal / fakesEnabled / authBypassed
    secrets.ts                    envSecretStore（ローカル用）, secretStoreFor(env)
    mailer.ts                     logMailer（モック）, mailerFor(env)
    external.ts                   externalDepsFor(env): Places/Threads/LLM/HPB http の実物 or フェイク
  src/fakes/                      places.ts threads.ts llm.ts hpbHttp.ts（決まったデータ）
  src/pipeline/                   collect.ts process.ts hpb.ts notify.ts tokenRefresh.ts（旧 handlers の純粋関数を移動）
  src/batch/
    main.ts                       CLI 入口（引数解析・終了コード）
    run.ts                        runPipeline
    context.ts                    buildBatchContext(env)
  src/handlers/api.ts             残す（context は runtime 経由に変更）
  src/local/apiServer.ts          ローカル HTTP サーバー
  scripts/bundle-api.mjs          esbuild で API Lambda の zip
Dockerfile                        ステージ: deps / dev / batch（本番）
docker-compose.yml                db / localstack / batch / api / frontend / tools(profile)
docker/db/init.sql                salon_dev, salon_test, pg_trgm
docker/tools/Dockerfile           Node 22 + Terraform + tflocal + AWS CLI
.env.example
infra/
  modules/salon_watcher/          *.tf
  envs/local/  envs/prod/         main.tf, variables.tf, *.tfvars.example
  tests/                          *.tftest.hcl
  scripts/deploy-frontend.sh  scripts/push-batch-image.sh
README.md  docs/development.md  docs/deploy.md(書き直し)  CLAUDE.md(更新)
```

---

### Task 1: web → frontend 改名

**Files:** Move `web/` → `frontend/`. Modify: ルート `package.json`（workspaces, scripts）、`frontend/package.json`（name `@salon-watcher/frontend`）、`.gitignore`（`web/out` → `frontend/out` 等）、`infra/lib/salonWatcherStack.ts` と `infra/test/stack.test.ts` の `web/out` 参照（CDK は Task 7 で消すが、それまで緑を保つ）、`docs/deploy.md`、`CLAUDE.md`

- [ ] **Step 1:** `git mv web frontend`、上記参照を一括置換（`grep -rn "web/" --exclude-dir=node_modules` で残りが無いこと。`legacy/` と過去の plans/specs は除外）
- [ ] **Step 2:** `npm install` → `npm -w frontend test`・`npm -w frontend run build`（`frontend/out` 生成）・`npm -w backend test`・`npm -w infra test` が PASS
- [ ] **Step 3:** コミット `refactor: rename web to frontend`

---

### Task 2: 実行モードの切り替え（runtime）

**Files:**
- Create: `backend/src/runtime/mode.ts`, `secrets.ts`, `mailer.ts`
- Test: `backend/test/runtime/mode.test.ts`, `secrets.test.ts`, `mailer.test.ts`

**Interfaces:**
- Consumes: `SecretStore`（`lib/secrets.ts`）, `ssmSecretStore`, `SendMail`（`notify/send.ts`）, `sesSender`, `Logger`
- Produces:
  ```ts
  type Env = Record<string, string | undefined>;
  isLocal(env: Env): boolean                    // env.APP_ENV === 'local'
  fakesEnabled(env: Env): boolean               // isLocal(env) && env.FAKE_EXTERNAL === '1'
  envSecretStore(env: Env): SecretStore         // get(name) = env[name] ?? throw; put(name,v) は env オブジェクトに書く（メモリ上のみ）
  secretStoreFor(env: Env): SecretStore         // local → envSecretStore、それ以外 → ssmSecretStore()
  logMailer(log: Logger): SendMail              // log.info('mail (mock)', { subject, body }) のみ
  mailerFor(env: Env, log: Logger): SendMail    // local → logMailer、それ以外 → sesSender(NOTIFY_FROM, NOTIFY_TO.split(','))。本番で NOTIFY_FROM/TO 未設定は throw
  ```

- [ ] **Step 1: 失敗するテスト**
  - `isLocal({APP_ENV:'local'})` true / `isLocal({})` false / `isLocal({APP_ENV:'LOCAL'})` false
  - `fakesEnabled({FAKE_EXTERNAL:'1'})` **false**（Review Focus 1）/ `fakesEnabled({APP_ENV:'local',FAKE_EXTERNAL:'1'})` true
  - `secretStoreFor({})` は SSM ストア（`envSecretStore` ではない。種別を判別できる `kind: 'ssm'|'env'` プロパティを両ストアに持たせて検査）/ local では `get('DATABASE_URL')` が env の値、未設定は `secret not found` で throw
  - `mailerFor({APP_ENV:'local'}, log)` で送ると SES は呼ばれず log に subject が出る / `mailerFor({}, log)` は NOTIFY_FROM 未設定で throw
- [ ] **Step 2:** FAIL を確認 → **Step 3:** 実装 → **Step 4:** PASS を確認
- [ ] **Step 5:** コミット `feat: runtime mode switches for local development`

---

### Task 3: 外部 API のフェイク

**Files:**
- Create: `backend/src/fakes/{places.ts,threads.ts,llm.ts,hpbHttp.ts}`, `backend/src/runtime/external.ts`
- Modify: `backend/src/sources/registry.ts`（ソースを実物/フェイクで作り分けられるようにする）
- Test: `backend/test/runtime/external.test.ts`

**Interfaces:**
- Consumes: `createGoogleMapsSource(makeClient)`, `createThreadsSource(makeClient)`, `placesClient`, `threadsClient`, `LlmClassifier`, `anthropicClassifier`, `fakesEnabled`
- Produces:
  ```ts
  interface ExternalDeps { sources: Source[]; llm(apiKey: string): LlmClassifier; hpbHttp: typeof fetch; }
  externalDepsFor(env: Env): ExternalDeps       // fakesEnabled → フェイク一式、それ以外 → 実物
  buildRegistry(sources: Source[]): { getSource(id: SourceId): Source }   // registry.ts。既存の getSource/registerSource は buildRegistry(既定の実物) のラッパーとして残す
  ```
- フェイクのデータ（固定）: Places = 立川市のセルで新規 ID `fake-place-lily`（name 'ネイルサロン Lily'、住所 '東京都立川市曙町2丁目'、FUTURE_OPENING）と `fake-place-hpb`（'Hair Salon Sakura'、'東京都八王子市旭町'）。Threads = `threads:lily_nail` の投稿「11/1 立川駅北口に Nail Salon Lily 立川店 OPEN」と、エリア不明の投稿「来月新店オープンします！」（`threads:unknown_shop`）。LLM = 本文に「立川」を含めば yes / city '立川市' / genre 'nail'、それ以外で OPEN 語があれば maybe、なければ no。HPB http = 'Sakura' を含む検索には「掲載あり」HTML（`backend/test/hpb/fixtures` の掲載ありページを流用し、店名を差し替え）、それ以外は該当なし HTML

- [ ] **Step 1: 失敗するテスト**: `externalDepsFor({FAKE_EXTERNAL:'1'})` の llm は `anthropicClassifier` 由来（フェイクではない。`kind` プロパティで判別）/ `externalDepsFor({APP_ENV:'local',FAKE_EXTERNAL:'1'})` は fake / フェイク Places 経由で google_maps ソースを collect すると 'ネイルサロン Lily' が出る（2回目の sweep 以降。初回はシード）
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → **Step 4:** PASS
- [ ] **Step 5:** コミット `feat: fake external clients for local development`

---

### Task 4: バッチ CLI（Lambda ハンドラからの移行）

**Files:**
- Create: `backend/src/batch/{main.ts,run.ts,context.ts}`、`backend/src/pipeline/{collect.ts,process.ts,hpb.ts,notify.ts,tokenRefresh.ts}`（旧 `handlers/{collect,process,hpb,notify,refreshThreadsToken}.ts` の純粋関数を移動）
- Delete: `backend/src/handlers/{collect,process,hpb,notify,refreshThreadsToken}.ts`（対応テストは `backend/test/pipeline/` へ移動）
- Modify: `backend/src/handlers/context.ts` → `buildContext(env = process.env)` を runtime 経由に（`secretStoreFor`・`externalDepsFor`）。`lightContext` は削除。`backend/package.json` に `"batch": "tsx src/batch/main.ts"`
- Test: `backend/test/batch/run.test.ts`, `backend/test/batch/main.test.ts`, `backend/test/batch/e2e.test.ts`

**Interfaces:**
- Consumes: `runCollect(ctx, source, shard)`, `processPending(db, llm, limit, deps)`, `checkPendingStores(db, http, limit)`, `runNotify(db, send, opts)`, `refreshThreadsToken(secrets, http)`, `enabledSources(env)`, Task 2/3 の runtime
- Produces:
  ```ts
  // batch/context.ts
  interface BatchContext extends HandlerContext { getSource(id: SourceId): Source; hpbHttp: typeof fetch; mail: SendMail; env: Env; }
  buildBatchContext(env: Env): Promise<BatchContext>
  // batch/run.ts
  interface RunResult { collected: { source: SourceId; shard: string; ok: boolean; error?: string }[]; processed: number; hpbChecked: number; ok: boolean; }
  runPipeline(ctx: BatchContext, sources: SourceId[], opts?: { hpbLimit?: number /*300*/; shardConcurrency?: number /*7*/ }): Promise<RunResult>
  // batch/main.ts
  main(argv: string[], env: Env, deps?: { build?: typeof buildBatchContext; timeoutMs?: number /*2h*/ }): Promise<number>   // 終了コード
  ```
- `buildBatchContext`: `fakesEnabled(env)` のときは外部 API キー（`PLACES_API_KEY` `THREADS_ACCESS_TOKEN` `ANTHROPIC_API_KEY`）が未設定でも動くよう、secrets を「未設定なら `'fake'` を返す」ラッパーで包む（`DATABASE_URL` は必須のまま）。テスト: `APP_ENV=local FAKE_EXTERNAL=1 DATABASE_URL=…` だけで e2e が通る
- `runPipeline`: `enabledSources(env)` と sources の積集合 → 各ソースの listShards → 全シャードを並列（上限 shardConcurrency）で runCollect、失敗は記録して続行 → processPending を pending が 0 件になるまで繰り返す（1回 500 件）→ checkPendingStores(hpbLimit) → `ok = 全シャード成功 && 判定で例外なし`
- `main`: `run --sources a,b` / `notify` / `refresh-threads-token`。不明なコマンド・引数は使い方を出して 2。`run` は `ok` なら 0、そうでなければ 1。全体を `timeoutMs` で打ち切り、超えたら log.error して 1。終了前に DB 接続を閉じる（`createDb` に `close()` を追加してよい）

- [ ] **Step 1: 失敗するテスト**
  - run（実DB＋フェイク Source）: 2シャード中1つが throw → もう1つの raw item は保存・process・hpb まで実行され、`ok:false`、`collected` に error 付きで記録（Review Focus 2）
  - run: pending が 1,200 件 → processPending が3回呼ばれて 0 件になる（フェイク LLM）
  - main: `run --sources google_maps` が ok → 0 / ok:false → 1 / `bogus` → 2 / `timeoutMs: 50` で永遠に終わらない build → 1 を 1 秒以内に返す（Review Focus 3）
  - e2e（実DB、`APP_ENV=local FAKE_EXTERNAL=1` の env を渡す）: `run --sources google_maps` を2回（1回目シード）→ `run --sources threads` → stores に 'Lily' が1店舗（evidence 2件、Map と Threads）、エリア不明投稿が maybe で1店舗、'Sakura' は hpb_status 'listed'。`notify` → logMailer の出力に 'Lily' を含む
- [ ] **Step 2:** FAIL → **Step 3:** 実装（移動したテストも緑に） → **Step 4:** `npm -w backend test` 全 PASS
- [ ] **Step 5:** コミット `feat: batch cli replacing pipeline lambdas`

---

### Task 5: ローカル API サーバーとフロントの認証省略

**Files:**
- Create: `backend/src/local/apiServer.ts`（`package.json` に `"api:local": "tsx src/local/apiServer.ts"`）
- Modify: `frontend/src/lib/auth.ts`, `frontend/src/lib/api.ts`
- Test: `backend/test/local/apiServer.test.ts`, `frontend/test/auth.test.ts`

**Interfaces:**
- Consumes: `handleApi(db, event, now)`（`handlers/api.ts`）, `ApiEvent`, `buildContext(env)`
- Produces:
  ```ts
  createApiServer(db: Db): http.Server    // HTTP → ApiEvent（routeKey = `${method} ${path}`、queryStringParameters、body、requestContext.authorizer.jwt.claims = { username: 'local-dev' }）→ handleApi → HTTP。CORS は http://localhost:3000 を許可
  // frontend/src/lib/auth.ts
  authBypassed(): boolean                  // process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_AUTH_MODE === 'none'
  ```
- `apiServer.ts` を直接実行したときは `APP_ENV=local` 必須（そうでなければ起動せず終了コード 1）、port は `PORT` 既定 8080

- [ ] **Step 1: 失敗するテスト**
  - apiServer（実DB）: `GET /leads?tab=main` が 200 で leads 配列 / `PUT /settings/threads-queries` 後に settings の updated_by が 'local-dev' / 未知パスは 404
  - frontend: `NODE_ENV=production` かつ `NEXT_PUBLIC_AUTH_MODE=none` で `authBypassed()` false（Review Focus 1）/ `NODE_ENV=development` かつ none で true。bypass 時 api.ts は Authorization ヘッダーを付けない
- [ ] **Step 2:** FAIL → **Step 3:** 実装 → **Step 4:** PASS
- [ ] **Step 5:** コミット `feat: local api server and dev auth bypass`

---

### Task 6: Docker 開発環境

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`（既存を置き換え）, `docker/db/init.sql`, `docker/tools/Dockerfile`, `.env.example`, `.dockerignore`
- Modify: `backend/test/helpers/db.ts`（既定 `TEST_DATABASE_URL` を `postgres://postgres:postgres@localhost:5432/salon_test` に。compose 内では `db` ホストを env で渡す）, `.gitignore`（`.env`）
- Test: `scripts/check-compose.mjs`（compose 設定の静的検査）または同等

**Interfaces:**
- compose サービス: `db`（postgres:16、5432、`init.sql` で `salon_dev`・`salon_test` と pg_trgm）、`localstack`（`localstack/localstack:<2026.03以降の固定タグ>`、4566、`LOCALSTACK_AUTH_TOKEN`、`/var/run/docker.sock` マウント＝ECS タスク起動用）、`batch`（Dockerfile `batch` ステージ、`APP_ENV=local`、`DATABASE_URL=postgres://postgres:postgres@db:5432/salon_dev`、`env_file: .env`、`profiles: [batch]`＝`docker compose run` 用）、`api`（dev ステージ、`npm -w backend run api:local`、8080）、`frontend`（dev ステージ、`next dev`、3000、`NEXT_PUBLIC_AUTH_MODE=none`、`NEXT_PUBLIC_API_URL=http://localhost:8080`）、`tools`（`docker/tools/Dockerfile`、`profiles: [tools]`、リポジトリをマウント）
- `api` と `frontend` は `localstack` に `depends_on` しない（Review Focus 5）。`api` は `db` の healthcheck を待つ
- Dockerfile `batch` ステージ: 本番用。`npm ci --omit=dev` 相当＋ビルド済み JS、`ENTRYPOINT ["node","dist/batch/main.js"]`（tsc で `dist/` に出す。backend に `build` スクリプト追加）
- `.env.example`: `LOCALSTACK_AUTH_TOKEN=` `FAKE_EXTERNAL=1` `PLACES_API_KEY=` `ANTHROPIC_API_KEY=` `THREADS_ACCESS_TOKEN=`（値は空）

- [ ] **Step 1: 失敗する検査**: `docker compose config --format json` を読み、`api`/`frontend` の depends_on に localstack が無い・`batch` に `APP_ENV=local`・`.env` が `.gitignore` 済み、を検査するスクリプト `npm run check:compose` を書いて FAIL を確認
- [ ] **Step 2:** 実装 → `npm run check:compose` PASS
- [ ] **Step 3: 実地確認**: `cp .env.example .env`（トークン空）→ `docker compose up -d db api frontend` → `curl localhost:8080/leads?tab=main` が 200、`localhost:3000` が表示される → `docker compose run --rm batch run --sources google_maps` を2回と `run --sources threads` → `curl` で 'Lily' を含む → `docker compose run --rm tools npm -w backend test` が全 PASS。結果を報告に記録
- [ ] **Step 4:** コミット `feat: docker development environment`

---

### Task 7: Terraform（本番構成）と CDK 削除

**Files:**
- Create: `infra/modules/salon_watcher/{versions.tf,variables.tf,network.tf,ecr.tf,ecs.tf,schedules.tf,alarms.tf,api.tf,auth.tf,site.tf,ses.tf,iam.tf,logs.tf,outputs.tf}`、`infra/modules/salon_watcher/cloudfront-index.js`（CDK 版の書き換え関数をそのまま移す）、`infra/envs/prod/{main.tf,variables.tf,terraform.tfvars.example}`、`infra/tests/prod.tftest.hcl`、`backend/scripts/bundle-api.mjs`（`npm -w backend run bundle:api` → `backend/dist/api.zip`）、`infra/scripts/{push-batch-image.sh,deploy-frontend.sh}`
- Delete: `infra/bin`, `infra/lib`, `infra/test`, `infra/package.json`, `infra/cdk.json`, `infra/tsconfig.json`、ルート workspaces の "infra"
- Test: `infra/tests/prod.tftest.hcl`（`command = plan`、mock provider で AWS 不要）

**Interfaces:**
- module 変数: `owner_email` `notify_from` `notify_to` `cognito_domain_prefix` `sources_disabled`（既定 ""）`batch_image_tag`（既定 "latest"）`api_zip_path`、`create_cognito`/`create_api`/`create_site`/`create_scheduler`（既定 true。Task 8 の LocalStack 用）
- module 出力: `site_url` `api_url` `cognito_authority` `cognito_client_id` `user_pool_id` `ecr_repository_url` `cluster_name` `task_definition_arn` `subnet_ids` `security_group_id`
- Scheduler 4本: ECS RunTask ターゲット、`containerOverrides.command` = `["run","--sources","threads"]` / `["run","--sources","google_maps"]` / `["notify"]` / `["refresh-threads-token"]`、`schedule_expression_timezone = "Asia/Tokyo"`、`assign_public_ip = true`
- タスク定義: Fargate、cpu 512 / memory 1024、環境変数 `SOURCES_DISABLED` `NOTIFY_FROM` `NOTIFY_TO` `UI_URL`、`APP_ENV` は**設定しない**
- アラーム: EventBridge ルール（ECS Task State Change、`lastStatus = STOPPED`、クラスター一致、`containers[].exitCode` が 0 以外）→ SNS、API Lambda Errors ≥ 1（1時間）→ SNS

- [ ] **Step 1: 失敗するテスト** `prod.tftest.hcl`（`mock_provider "aws"`）: スケジュール4本の式とタイムゾーンが Global Constraints と一致 / どの `aws_security_group` にも ingress が無い（Review Focus 4）/ NAT ゲートウェイのリソースが 0 / タスク定義の環境変数に `APP_ENV` が無い / Cognito `allow_admin_create_user_only = true` / IAM ポリシーの SSM リソースが `/salon-watcher/*`、PutParameter は THREADS_ACCESS_TOKEN のみ / `owner_email = "a@example.com"` で validation エラー（`expect_failures`）
- [ ] **Step 2:** `docker compose run --rm tools terraform -chdir=infra/envs/prod init -backend=false && terraform test` で FAIL を確認
- [ ] **Step 3:** 実装（設定値は削除前の `infra/lib/salonWatcherStack.ts` から写す）、CDK 削除、`npm install` で lockfile 更新
- [ ] **Step 4:** `terraform fmt -check -recursive infra`・`validate`・`test` PASS、`npm -w backend test` PASS、`npm -w backend run bundle:api` で zip 生成
- [ ] **Step 5:** コミット `feat: terraform infrastructure replacing cdk`

---

### Task 8: LocalStack 環境（envs/local）と通し実行

**Files:**
- Create: `infra/envs/local/{main.tf,variables.tf,terraform.tfvars.example}`、`infra/scripts/local-up.sh`（イメージを LocalStack の ECR に push → `tflocal apply` → SSM に `DATABASE_URL` 等を投入）、`infra/scripts/local-run-task.sh`（スケジュールを待たずに同じ RunTask を手動起動）
- Test: 実地確認の記録（`docs/development.md` に反映）

**Interfaces:**
- Consumes: Task 7 の module（`create_*` 変数）
- `envs/local`: provider endpoints を `http://localhost:4566`（tools コンテナからは `http://localstack:4566`）、タスク定義の環境変数に `APP_ENV=local`・`FAKE_EXTERNAL=1`・compose の `db` を指す `DATABASE_URL` を追加できる変数 `extra_task_env`（module に追加、既定 {}、prod では使わない）

- [ ] **Step 1: スパイク**: LocalStack（トークンあり）に対し、ECR・ECS（Fargate RunTask）・Scheduler・SNS・EventBridge・SSM・Cognito・API Gateway v2・CloudFront・Lambda を `tflocal apply` で作成できるか試し、可否を表にする
- [ ] **Step 2:** 作れないものは `envs/local` で `create_* = false`。`local-up.sh` を実装
- [ ] **Step 3: 実地確認**: `local-run-task.sh run --sources google_maps`（2回）→ LocalStack が起動したタスクが compose の `db` に書き込む → `curl localhost:8080/leads?tab=main` に 'Lily'。Scheduler が使える場合はスケジュールを1分後に設定して自動起動も確認
- [ ] **Step 4:** スパイクの表と手順を `docs/development.md` の LocalStack 節の下書きとして報告に残す
- [ ] **Step 5:** コミット `feat: localstack environment with end-to-end batch run`

---

### Task 9: ドキュメント

**Files:**
- Create: `README.md`, `docs/development.md`
- Modify: `docs/deploy.md`（Terraform + ECS 前提に全面改稿）, `CLAUDE.md`（構成・テストコマンド）, `docs/superpowers/specs/2026-10-18-salon-watcher-v4-design.md` §8（注記）

- `README.md`: 何をするツールか / 構成図（mermaid: Scheduler → ECS バッチ → Neon、CloudFront → S3、HTTP API → Lambda → Neon）/ **DB を VPC 外に置く理由**（spec §3.8 の4点: 本来は VPC 内＋NAT が望ましい、NAT は常時課金で月 $35 程度以上、観察期間はコストを優先して Neon、費用対効果確認後に RDS＋プライベートサブネット＋NAT へ移行）/ 開発・デプロイ手順書へのリンク
- `docs/development.md`: 前提（Docker、LocalStack トークン）、`.env`、`docker compose up`、テスト、バッチのローカル実行、LocalStack での通し実行（Task 8 の表）、本物の API への切り替え
- `docs/deploy.md`: Neon・SSM 4つ・Meta App Review・`sources_disabled = "threads"`・2段階デプロイ（`terraform apply` → `push-batch-image.sh` → 出力で frontend をビルド → `deploy-frontend.sh`）・SES サンドボックス・SNS 購読確認・Cognito ユーザー作成・v3 取り込み・スモークチェック（Phase 1 版の項目を維持し、Lambda/Step Functions の記述を ECS に置き換え）・state を S3 に移す手順
- 親設計書 §8: 「バッチ実行基盤と IaC は `2026-10-18-dev-env-terraform-design.md` で置き換え」と DB を VPC 外に置く理由の要約

- [ ] **Step 1:** 執筆。`grep -rn "Step Functions\|cdk \|CDK" README.md docs/development.md docs/deploy.md CLAUDE.md` で古い記述が残っていないこと（「CDK から移行した」旨の説明は可）、`grep -rn "@gmail" .` が 0 件
- [ ] **Step 2:** コミット `docs: readme, development guide, terraform deploy runbook`
