# salon-watcher v4 デプロイ手順（オーナー向け）

外部アカウント（AWS / Neon / Meta / Anthropic / Google Cloud）を操作する手順です。各ステップは上から順に、結果を確認しながら進めてください。リージョンは `ap-northeast-1`（東京）を前提にしています。

構成は Terraform（`infra/envs/prod`）+ ECS Fargate（バッチ）+ Lambda（APIのみ）です。以前の CDK + Step Functions + Lambda 構成から移行しました（経緯は [設計書](superpowers/specs/2026-10-18-dev-env-terraform-design.md)）。DB を VPC 外の Neon に置く理由は [README](../README.md) を参照してください。

## 0. 前提

- AWS CLI でデプロイ先アカウントにログイン済み（`aws sts get-caller-identity` で確認）
- Terraform（`>= 1.11`）、Docker、Node.js 22 以上。ホストに入れない場合は `docker compose run --rm tools ...`（Terraform / AWS CLI / jq 入り。AWS の認証情報は環境変数で渡す）でも実行できます。`docker compose` が使えない環境では `docker-compose` を使ってください
- リポジトリのルートで `npm install` 済み
- `infra/envs/prod/terraform.tfvars` を作る（git 管理外。`terraform.tfvars.example` を元にする）

  | 変数 | 内容 |
  |---|---|
  | `owner_email` | アラーム通知（SNS）を受け取るオーナーのアドレス |
  | `notify_from` | 日次メールの送信元アドレス |
  | `notify_to` | 日次メールの宛先（複数ならカンマ区切り） |
  | `cognito_domain_prefix` | Cognito ホスト UI のドメイン接頭辞（世界で一意。例 `salon-watcher-<自分の名前>`） |
  | `sources_disabled` | 収集をスキップするソース。Meta App Review 通過まで `"threads"` |
  | `batch_image_tag` | 省略可。既定は `latest` |

  サンプル値のメールには `*.invalid` を使います。`example.com` を含む値は Terraform の validation で拒否されます。メールアドレスなど個人情報はリポジトリに置かないでください。

## 1. データベース（Neon）

1. Neon でプロジェクトを作成（リージョンは AWS Tokyo に近いもの）。
2. ダッシュボードの「Connection string」で **Pooled connection** を選び、接続文字列をコピー（`postgresql://...-pooler...?sslmode=require`）。
3. マイグレーションを本番に適用:
   ```sh
   DATABASE_URL='<接続文字列>' npm -w backend run migrate
   ```
   `migrations applied successfully` が出れば完了。

## 2. SSM パラメータ（4つとも SecureString）

| 名前 | 内容 |
|---|---|
| `/salon-watcher/DATABASE_URL` | Neon の pooled 接続文字列 |
| `/salon-watcher/PLACES_API_KEY` | Google Places API (New) のキー（v3 と同じキーで可） |
| `/salon-watcher/ANTHROPIC_API_KEY` | Anthropic API キー |
| `/salon-watcher/THREADS_ACCESS_TOKEN` | Threads の長期アクセストークン |

```sh
aws ssm put-parameter --name /salon-watcher/DATABASE_URL --type SecureString --value '<接続文字列>'
aws ssm put-parameter --name /salon-watcher/PLACES_API_KEY --type SecureString --value '<キー>'
aws ssm put-parameter --name /salon-watcher/ANTHROPIC_API_KEY --type SecureString --value '<キー>'
aws ssm put-parameter --name /salon-watcher/THREADS_ACCESS_TOKEN --type SecureString --value 'placeholder'
```

- Threads が使えるようになるまでは `THREADS_ACCESS_TOKEN` は仮の値（`placeholder`）で構いません。
- **注意:** 毎週月曜 4:00 の `refresh-threads-token` タスクは、仮の値のままだと失敗します。失敗タスクのアラーム（後述）メールが届きますが、本物のトークンを登録するまでは想定どおりの通知なので無視して構いません。

## 3. Threads（Meta App Review）

1. Meta 開発者ダッシュボードで Threads アプリを作成し、長期アクセストークンを発行。
2. `threads_keyword_search` 権限の App Review を申請。承認されるまでは自分の投稿しか検索できません。
3. **承認されるまでは `terraform.tfvars` で `sources_disabled = "threads"`** にしておきます（Threads の収集をスキップ）。
4. 承認後、`/salon-watcher/THREADS_ACCESS_TOKEN` を本物のトークンで上書き（`aws ssm put-parameter ... --overwrite`）し、`sources_disabled = ""` にして `terraform apply` し直します。

## 4. デプロイ（2段階）

初回はコンテナイメージが ECR にまだ無く、Web UI に埋め込む API URL や Cognito の値も `terraform apply` の後でないと分かりません。そのため次の順で進めます。

### 4-1. インフラを作る

```sh
npm -w backend run bundle:api           # backend/dist/api.zip（API Lambda）を作る
terraform -chdir=infra/envs/prod init
terraform -chdir=infra/envs/prod apply
```

ローカル state のまま進めて構いません（S3 への移行は 9 章）。ECS タスク定義はこの時点で作られますが、イメージが無いのでバッチはまだ動きません（スケジュールは動き出すので、5 章までを続けて行うか、先にスケジュールを無効化してください）。

### 4-2. バッチイメージを push

```sh
infra/scripts/push-batch-image.sh          # タグは git の短縮 SHA（引数で変更可）。:latest も付く
```

Docker と AWS の認証情報が必要です。ECR のリポジトリ URL は `terraform output` から取得されます。タスク定義は `batch_image_tag`（既定 `latest`）を参照します。特定タグに固定する場合は `terraform.tfvars` で `batch_image_tag` を指定して再度 apply します。

### 4-3. フロントエンドをビルドして配信

```sh
infra/scripts/deploy-frontend.sh
```

`terraform output` の値（`api_url` など）を `NEXT_PUBLIC_*` に設定して `frontend/out` をビルドし、S3 へ同期して CloudFront を無効化します。`terraform output site_url` が UI の URL です。出力が変わる apply の後や、フロントエンドを変更した後は毎回実行してください。

## 5. メール（SES / SNS）

- SES がサンドボックスの間は、**送信元 `notify_from` と、`notify_to` の全アドレス**を SES で検証する必要があります。apply で `notify_from` の検証メールが届くのでリンクを踏み、宛先は SES コンソールの「Verified identities」から追加して検証します。宛先を検証したくない場合は SES の本番アクセス（サンドボックス解除）を申請します。
- `owner_email` に SNS の「Subscription Confirmation」メールが届くので、**Confirm subscription** を押します（押さないとアラームが届きません）。

## 6. Cognito ユーザー

セルフサインアップは無効です。オーナーと友人を管理者作成します（`user_pool_id` は `terraform -chdir=infra/envs/prod output -raw user_pool_id`）:

```sh
aws cognito-idp admin-create-user --user-pool-id <user_pool_id> --username <オーナーのメール> \
  --user-attributes Name=email,Value=<オーナーのメール> Name=email_verified,Value=true
aws cognito-idp admin-create-user --user-pool-id <user_pool_id> --username <友人のメール> \
  --user-attributes Name=email,Value=<友人のメール> Name=email_verified,Value=true
```

仮パスワードがメールで届き、初回ログイン時に変更を求められます。

## 7. v3 の既知店舗を取り込む

v3 のスプレッドシート `known_places` シートを CSV（ヘッダー `place_id,first_seen`）でエクスポートし、本番 DB に取り込みます。取り込んだ店舗は「既存店」として扱われ、リードになりません。

```sh
DATABASE_URL='<接続文字列>' npm -w backend run import-v3 -- ./known_places.csv
```

## 8. 動作確認

### 8-1. AWS 上の通し確認（アカウント発行後に最初に行う）

ローカルでは確認できない経路（Scheduler → ECS 起動、IAM 権限、SSM 読み取り、ネットワーク）を、手動起動で確かめます。

```sh
infra/scripts/run-task.sh --wait run --sources google_maps
```

（`run-task.sh` は Fargate タスクを 1 回起動します。`--wait` を付けるとタスク停止まで待ち、コンテナの終了コードで終了します。`jq` と AWS CLI、terraform が必要です。）

確認すること:

1. **終了コード 0**: 出力の最後が `exitCode=0`。非 0 なら失敗（失敗アラームのメールも届く）。
2. **CloudWatch Logs**: ロググループ `/salon-watcher/batch` にエラーが無く、`run done` などが出ている。
3. **Neon への書き込み**: `map_cells` や `raw_items` に行が増えている。初回はシードのみで、`map_cells` の全行が `seeded = true` になりリードは 0 件が正常。
4. **画面表示**: 2 回目以降の実行後、UI にリードが表示される。

注意: `--wait` が使う `aws ecs wait` は約 10 分で待つのをやめます。長時間かかる実行（初回スイープなど）は、コンソールや CloudWatch Logs でタスクの状態を確認してください。バッチ自体は 2 時間で打ち切られます。

### 8-2. スモークチェック

1. **初回スイープ（シード）:** 上記 8-1 の結果で、所要時間と Places リクエスト数（ログの `maps sweep done` の `queried` 合計）を記録します。
2. **LLM 呼び出し:** バッチのログにエラーが無いこと（モデル `claude-haiku-5-5` と `thinking: disabled` が受け付けられていること）を確認。Threads 承認前は判定対象がないため、ローカルから 1 件だけ実際に分類して確かめます:
   ```sh
   cd backend
   ANTHROPIC_API_KEY='<キー>' npx tsx -e "import('./src/classify/llm.ts').then(async (m) => console.log(await m.anthropicClassifier(process.env.ANTHROPIC_API_KEY).classify({ text: '11月1日 立川駅北口にネイルサロンをオープンします', authorHandle: null, postedAt: null, now: new Date() })))"
   ```
   `verdict` などが入ったオブジェクトが表示されれば OK。
3. **Places の日本語住所:** 取り込まれたリードの住所（`raw_items.text` / `payload.address`）が `東京都…` で始まる日本語になっていることを確認（英語住所だと市が判定できずリードが落ちます）。
4. **Threads（承認後）:** わざと無効なトークンで呼ぶと HTTP 401 または error code 190 が返り、`ThreadsAuthError` としてタスクが失敗しアラームが届くことを確認:
   ```sh
   curl -s 'https://graph.threads.net/v1.0/keyword_search?q=test&access_token=invalid'
   ```
5. **翌日:** 自動実行後に UI へログインしてリードが表示されること、7:00 に日次メールが届くこと（新規 0 件なら届かないこと）を確認。

## 9. 運用

### 監視（SNS でオーナーにメール）

- ECS タスクが非 0 の終了コードで停止した、または起動に失敗した（`TaskFailedToStart`）: EventBridge ルール
- Scheduler がタスクを起動できなかった: `TargetErrorCount` のアラーム
- API Lambda のエラー: `Errors` のアラーム

SNS の購読確認（5 章）が済んでいないと届きません。

### 諦めた raw_items を戻す

LLM 判定や名寄せが 3 回失敗した `raw_items` は、キューを詰まらせないよう `status = 'rejected'` になります（判定が `no` で棄却されたものと区別するため、`classification` の `verdict` が `no` 以外のものが「諦めた」対象）。原因（API キー、障害など）を直したあと、再処理したいものを戻します:

```sql
update raw_items
set status = 'pending', attempts = 0
where status = 'rejected' and classification->>'verdict' <> 'no';
```

件数が多い場合は、先に `select count(*)` で確認し、必要なら `source` や期間で絞ってください。

### state を S3 に移す

AWS アカウント発行後、ローカル state のままだと紛失・複数環境の競合の危険があります。バージョニングを有効にした S3 バケット（Terraform 管理外。手動作成）を用意し、`infra/envs/prod/main.tf` のコメントアウトされた `backend "s3"` ブロックを有効にして `<state bucket>` を実際の名前に置き換え、次を実行します:

```sh
terraform -chdir=infra/envs/prod init -migrate-state
```

確認プロンプトに `yes` と答えると、既存の state がバケットへ移ります。移行後、ローカルの `terraform.tfstate` は削除して構いません（バックアップは別途保管）。

### 止める / 戻す / 削除

- **止める:** EventBridge Scheduler コンソールで 4 つのスケジュール（threads / google-maps / notify / refresh-threads-token）を「無効化」します。データとインフラはそのまま残ります。
- **前の版に戻す:** 戻したいコミットを checkout し、4 章と同じ手順（`bundle:api` → `terraform apply` → `push-batch-image.sh` → `deploy-frontend.sh`）で再デプロイします。
- **完全に削除:** Cognito ユーザープールは `deletion_protection = ACTIVE` のため、`terraform destroy` の前に解除が必要です:
  ```sh
  aws cognito-idp update-user-pool --user-pool-id <user_pool_id> --deletion-protection INACTIVE
  ```
  ただし `update-user-pool` は未指定の設定を初期化することがあるため、削除目的に限って使ってください。そのうえで `terraform -chdir=infra/envs/prod destroy`。ECR リポジトリにイメージが残っていると削除に失敗するので、その場合はイメージを削除してから再実行します（サイト用 S3 バケットは中身ごと削除されます）。SSM パラメータと Neon のデータは別途削除します。
