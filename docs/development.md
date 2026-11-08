# 開発ガイド

ローカルでは外部アカウント（AWS・Google・Anthropic・Meta）なしで、すべて Docker 上で動かせます。

## 1. 前提

- Docker（このリポジトリのオーナー環境は Mac + colima）
- Compose のコマンドは `docker compose`（プラグイン）を基本とします。プラグインがリンクされていない環境（colima など）では、単体の `docker-compose` を同じ引数で使ってください。以降は `docker compose` で表記します。
- ホストの Node.js は不要です（テスト等はコンテナ内でも実行できます）。

## 2. 準備

```sh
cp .env.example .env
```

`.env` は git 管理外です。既定では `FAKE_EXTERNAL=1`（外部 API の偽実装）が有効で、キーは空のままで動きます。

## 3. 起動

```sh
docker compose up -d db api frontend
```

| サービス | 内容 | URL / ポート（すべて 127.0.0.1 にのみ公開） |
|---|---|---|
| `db` | PostgreSQL 16。`salon_dev` と `salon_test` を作成し、`pg_trgm` を有効化 | ホスト 5433（`DB_PORT` で変更可。5432 は手元の PostgreSQL と衝突しやすいため） |
| `api` | 起動時に `salon_dev` へマイグレーションを適用し、固定の開発用ユーザーで API を提供（`api:local`、ソース変更で再読込） | http://localhost:8080 |
| `frontend` | `next dev`。`NEXT_PUBLIC_AUTH_MODE=none` で Cognito をバイパス | http://localhost:3000 |
| `batch` | 本番と同じイメージ（profile `batch`）。`docker compose run` で使う | - |
| `tools` | Node 22 / Terraform 1.16.7 / AWS CLI v2 / jq（profile `tools`） | - |

colima ではバインドマウントに inotify が届かないため、`CHOKIDAR_USEPOLLING` / `WATCHPACK_POLLING` を設定済みです。

## 4. バッチのローカル実行

バッチは `salon_dev` がマイグレーション済みであることが前提です。`api` を一度起動していれば適用済みです。そうでなければ:

```sh
docker compose up -d db
docker compose run --rm -e DATABASE_URL=postgres://postgres:postgres@db:5432/salon_dev tools npm -w backend run migrate
```

実行:

```sh
docker compose run --rm batch run --sources google_maps
docker compose run --rm batch run --sources threads
docker compose run --rm batch notify
```

### 偽モードの流れ

`APP_ENV=local` かつ `FAKE_EXTERNAL=1` の間、Places / Threads / Claude / HPB の取得は偽実装になります。

1. `google_maps` は**2回**実行します。1回目はグリッドのシード（既知化）のみで、2回目に「ネイルサロン Lily」がリードとして現れます。
2. 続けて `threads` を実行すると Threads 由来の候補が入ります。
3. UI（http://localhost:3000）で確認できます。

メール（SES）はローカルでは常にログ出力のモックで、実際には送信されません。

### 本物の API への切り替え

`.env` に `PLACES_API_KEY` / `ANTHROPIC_API_KEY` / `THREADS_ACCESS_TOKEN` を書き、`FAKE_EXTERNAL=` を空（または `0`）にします。バッチを再実行すれば反映されます（`api` は `docker compose up -d --force-recreate api`）。実 API は課金・レート制限があるので、まず `--sources google_maps` 単体で小さく試してください。

## 5. テスト

```sh
docker compose up -d db
npm -w backend test                                # ホストの Node から（db は localhost:5433）
docker compose run --rm tools npm -w backend test  # コンテナ内で
npm -w frontend test
npm run check:compose                              # docker-compose.yml の設定チェック
```

バックエンドのテストは既定で `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/salon_test` に接続します（`tools` コンテナ内では `db:5432`）。

### インフラ（Terraform）

AWS アカウントなしで、モックしたプロバイダに対する plan のみのテストが走ります。

```sh
docker compose run --rm tools sh -c '
  terraform fmt -check -recursive infra &&
  terraform -chdir=infra init -backend=false &&
  terraform -chdir=infra test &&
  terraform -chdir=infra/envs/prod init -backend=false &&
  terraform -chdir=infra/envs/prod validate'
```

## 6. 依存関係を変えたとき

`node_modules` は Compose のボリューム（`node_modules`, `backend_node_modules`, `frontend_node_modules`）に入っています。`package.json` / `package-lock.json` を変えたら、イメージを作り直してボリュームを消します。

```sh
docker compose down
docker volume rm salon-watcher_node_modules salon-watcher_backend_node_modules salon-watcher_frontend_node_modules
docker compose build
```

（ボリューム名は `docker volume ls` で確認。プロジェクト名がディレクトリ名と違う場合は接頭辞が変わります。）

## 7. 後片付け

```sh
docker compose down        # 停止（DB データは残る）
docker compose down -v     # DB データとボリュームも削除
```
