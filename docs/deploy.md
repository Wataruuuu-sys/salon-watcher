# salon-watcher v4 デプロイ手順（オーナー向け）

外部アカウント（AWS / Neon / Meta / Anthropic / Google Cloud）を操作する手順です。各ステップは上から順に、結果を確認しながら進めてください。リージョンは `ap-northeast-1`（東京）を前提にしています。

## 0. 前提

- AWS CLI でデプロイ先アカウントにログイン済み（`aws sts get-caller-identity` で確認）
- 初回のみ `npx cdk bootstrap`（`infra/` で実行）
- リポジトリのルートで `npm install` 済み
- 以下の値を決めておく（以降 `<...>` で表記）
  - `<ownerEmail>`: アラーム通知（SNS）を受け取るオーナーのアドレス
  - `<notifyFrom>`: 日次メールの送信元アドレス
  - `<notifyTo>`: 日次メールの宛先（複数ならカンマ区切り。例 `a@x.jp,b@y.jp`）
  - `<cognitoDomainPrefix>`: Cognito ホストUIのドメイン接頭辞（世界で一意。例 `salon-watcher-<自分の名前>`）

`infra/cdk.json` にはこれらの既定値を置いていません。`cdk synth` / `cdk deploy` には毎回 `-c` で渡します（`example.com` を含む値は拒否されます）。

## 1. データベース（Neon）

1. Neon でプロジェクトを作成（リージョンは AWS Tokyo に近いもの）。
2. ダッシュボードの「Connection string」で **Pooled connection** を選び、接続文字列をコピー（`postgresql://...-pooler...?sslmode=require`）。
3. SSM に登録（次章でまとめて登録してもよい）:
   ```sh
   aws ssm put-parameter --name /salon-watcher/DATABASE_URL --type SecureString --value '<接続文字列>'
   ```
4. マイグレーションを本番に適用:
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
aws ssm put-parameter --name /salon-watcher/PLACES_API_KEY --type SecureString --value '<キー>'
aws ssm put-parameter --name /salon-watcher/ANTHROPIC_API_KEY --type SecureString --value '<キー>'
aws ssm put-parameter --name /salon-watcher/THREADS_ACCESS_TOKEN --type SecureString --value 'placeholder'
```

- Threads が使えるようになるまでは `THREADS_ACCESS_TOKEN` は仮の値（`placeholder`）で構いません。
- **注意:** 仮の値のままだと、毎週月曜 4:00 のトークン更新 Lambda が失敗し、`RefreshTokenErrorsAlarm` のメールが届きます。本物のトークンを登録するまでは想定どおりの通知なので無視して構いません。

## 3. Threads（Meta App Review）

1. Meta 開発者ダッシュボードで Threads アプリを作成し、長期アクセストークンを発行。
2. `threads_keyword_search` 権限の App Review を申請。承認されるまでは自分の投稿しか検索できません。
3. **承認されるまでは `-c sourcesDisabled=threads` を付けてデプロイ**します（Threads の収集をスキップ）。
4. 承認後、`/salon-watcher/THREADS_ACCESS_TOKEN` を本物のトークンで上書き（`--overwrite`）し、`sourcesDisabled` を外して（`-c sourcesDisabled=` または指定なし）再デプロイ。

## 4. デプロイ（2段階）

Web UI は API の URL や Cognito の値をビルド時に埋め込むため、1回目のデプロイで値を作り、2回目で正しい値を入れた UI を配信します。

> **毎回のデプロイ前に必ず `npm -w web run build` で `web/out` を作り直してください。** インフラのテスト（`npm -w infra test`）は `web/out` が無いと仮の `index.html` だけを置くため、そのままデプロイすると空のページが配信されます。

### 4-1. 1回目（仮の環境変数で）

```sh
npm -w web run build
cd infra
npx cdk deploy \
  -c ownerEmail=<ownerEmail> \
  -c notifyFrom=<notifyFrom> \
  -c notifyTo=<notifyTo> \
  -c cognitoDomainPrefix=<cognitoDomainPrefix> \
  -c sourcesDisabled=threads
```

完了時に表示される Outputs を控えます: `SiteUrl`, `ApiUrl`, `CognitoAuthority`, `UserPoolClientId`, `UserPoolId`, `CognitoDomain`。

### 4-2. 2回目（Outputs を埋め込んで）

```sh
export NEXT_PUBLIC_API_URL=<ApiUrl>
export NEXT_PUBLIC_COGNITO_AUTHORITY=<CognitoAuthority>
export NEXT_PUBLIC_COGNITO_CLIENT_ID=<UserPoolClientId>
export NEXT_PUBLIC_REDIRECT_URI=<SiteUrl>/callback/
npm -w web run build
cd infra
npx cdk deploy -c ownerEmail=<ownerEmail> -c notifyFrom=<notifyFrom> -c notifyTo=<notifyTo> \
  -c cognitoDomainPrefix=<cognitoDomainPrefix> -c sourcesDisabled=threads
```

以後の再デプロイも、同じ `NEXT_PUBLIC_*` を設定して `web/out` をビルドしてから行います。

## 5. メール（SES / SNS）

- SES がサンドボックスの間は、**送信元 `<notifyFrom>` と、`<notifyTo>` の全アドレス**を SES で検証する必要があります。デプロイで `<notifyFrom>` の検証メールが届くのでリンクを踏み、宛先は SES コンソールの「Verified identities」から追加して検証します。宛先を検証したくない場合は SES の本番アクセス（サンドボックス解除）を申請します。
- `<ownerEmail>` に SNS の「Subscription Confirmation」メールが届くので、**Confirm subscription** を押します（押さないとアラームが届きません）。

## 6. Cognito ユーザー

セルフサインアップは無効です。オーナーと友人を管理者作成します:

```sh
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username <オーナーのメール> \
  --user-attributes Name=email,Value=<オーナーのメール> Name=email_verified,Value=true
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username <友人のメール> \
  --user-attributes Name=email,Value=<友人のメール> Name=email_verified,Value=true
```

仮パスワードがメールで届き、初回ログイン時に変更を求められます。

## 7. v3 の既知店舗を取り込む

v3 のスプレッドシート `known_places` シートを CSV（ヘッダー `place_id,first_seen`）でエクスポートし、本番 DB に取り込みます。取り込んだ店舗は「既存店」として扱われ、リードになりません。

```sh
DATABASE_URL='<接続文字列>' npm -w backend run import-v3 -- ./known_places.csv
```

## 8. 動作確認（スモークチェック）

1. **初回スイープ（シード）:** Step Functions コンソールで `salon-watcher-pipeline` を入力 `{"sources":["google_maps"]}` で実行。初回はシードのみなのでリードは 0 件が正常です。`map_cells` の全行が `seeded = true` になっていることを確認し、所要時間と Places リクエスト数（CloudWatch Logs の `maps sweep done` の `queried` 合計）を記録します。
2. **LLM 呼び出し:** Process Lambda のログでエラーが無いこと（モデル `claude-haiku-5-5` と `thinking: disabled` が受け付けられていること）を確認。Threads 承認前は判定対象がないため、ローカルから 1 件だけ実際に分類して確かめます:
   ```sh
   cd backend
   ANTHROPIC_API_KEY='<キー>' npx tsx -e "import('./src/classify/llm.ts').then(async (m) => console.log(await m.anthropicClassifier(process.env.ANTHROPIC_API_KEY).classify({ text: '11月1日 立川駅北口にネイルサロンをオープンします', authorHandle: null, postedAt: null, now: new Date() })))"
   ```
   `verdict` などが入ったオブジェクトが表示されれば OK。
3. **Places の日本語住所:** 取り込まれたリードの住所（`raw_items.text` / `payload.address`）が `東京都…` で始まる日本語になっていることを確認（英語住所だと市が判定できずリードが落ちます）。
4. **Threads（承認後）:** わざと無効なトークンで呼ぶと HTTP 401 または error code 190 が返り、`ThreadsAuthError` としてシャードが失敗しアラームが届くことを確認:
   ```sh
   curl -s 'https://graph.threads.net/v1.0/keyword_search?q=test&access_token=invalid'
   ```
5. **翌日:** 自動実行後に UI（`<SiteUrl>`）へログインしてリードが表示されること、7:00 に日次メールが届くこと（新規 0 件なら届かないこと）を確認。

## 9. 停止・ロールバック

- **止める:** EventBridge Scheduler コンソールで 4 つのスケジュール（Threads / GoogleMaps / Notify / TokenRefresh）を「無効化」します。データとインフラはそのまま残ります。
- **前の版に戻す:** 戻したいコミットを checkout し、4 章と同じ手順（`web/out` をビルド → `cdk deploy`）で再デプロイします。
- **完全に削除:** `npx cdk destroy`（Cognito ユーザープールは保持設定のため手動削除が必要）。Neon のデータは別途削除します。
