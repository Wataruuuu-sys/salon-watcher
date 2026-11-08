# 開発環境の Docker 化・バッチの ECS 化・Terraform 移行・frontend 改名 設計書

| 項目 | 内容 |
|---|---|
| 作成日 | 2026-10-18 |
| 状態 | ドラフト（オーナー承認待ち） |
| 改訂 | 2026-11-08: LocalStack を廃止（オーナー判断）。AWS 上の通し確認は、アカウント発行後に本番環境で行う（§3.12） |
| 前提 | v4 Phase 1（PR #1）がマージ済みであること。本書はその上に積む改訂 |
| 親設計書 | `docs/superpowers/specs/2026-10-18-salon-watcher-v4-design.md`（§8 技術構成のうちバッチ実行基盤と IaC は本書で置き換える） |

「(作者判断)」の項目は会話で合意したものではなく設計者の判断。ビルダーが根拠を持って変えてよい。

## 1. 目的

Phase 1 は動くコードとテストがあるが、開発には「ローカルに PostgreSQL を入れる」「AWS アカウントが無いと通しで動かせない」という壁がある。また IaC は CDK で書いたが、オーナーは Terraform で管理したい。バッチは Lambda + Step Functions で組んだが、Lambda の15分上限に合わせた分割・打ち切りが設計を複雑にしている。AWS アカウントはまだ発行されていない。

本改訂で次の4つを行う（オーナー要望）:
1. **Docker でアプリ全体を動かせる開発環境**（DB・バックエンド・フロントエンド。AWS の機能はアプリ側の差し替えで代替。2026-11-08 改訂で LocalStack は廃止）
2. **バッチを Lambda + Step Functions から ECS（Fargate）の run-task に移す**
3. **インフラを CDK から Terraform に置き換える**
4. **`web/` を `frontend/` に改名する**

## 2. ゴール / 非ゴール / アンチゴール

### ゴール
- `docker compose up` で、DB・ローカル API・フロントエンド開発サーバーが立ち上がる
- AWS アカウント・外部 API キーなしで、収集 → 判定 → 名寄せ → HPB 判定 → 通知 の流れを手元で通しで動かせる
- **本番と同じバッチ用コンテナイメージ**を手元でも動かせる（開発と本番で同じものが動く）
- スケジュール起動からバッチ実行・DB 書き込みまでの本番経路は、AWS アカウント発行後に本番環境で一度通しで確認する（§3.12。2026-11-08 オーナー判断で LocalStack から変更）
- 全テスト（backend / frontend / infra）を Docker 内で実行できる。ホストに Node や PostgreSQL が無くてもよい
- Terraform で本番の AWS 構成を定義し、AWS アカウント発行後にそのまま適用できる
- `web/` → `frontend/` に改名し、参照箇所をすべて追従

### 非ゴール
- AWS アカウントの作成、本番への適用（アカウント発行後に `docs/deploy.md` で実施）
- CI の整備
- 判定・名寄せ・HPB 判定などのロジックの変更（実行基盤の都合で入れた上限・打ち切りの緩和は除く。§3.2）
- Neon の Terraform 管理（DB は引き続き Neon を手動作成。作者判断）

### アンチゴール
- 開発用の切り替え（モック・フェイク・認証省略）が本番で有効になってしまうこと
- Gmail 等の個人情報や秘密情報がリポジトリに入ること（CLAUDE.md 遵守。`.env`・`*.tfvars` はコミットしない）
- 常時稼働のリソース（NAT ゲートウェイ、常時起動の ECS サービス等）で固定費が発生すること

## 3. 決定事項

### 3.1 実行基盤の構成（オーナー判断）

| 役割 | Phase 1 | 本改訂 |
|---|---|---|
| バッチ（収集・判定・HPB 判定・通知・トークン更新） | Lambda 6本 + Step Functions | **ECS Fargate の run-task**（1つのコンテナイメージ、コマンドで処理を切り替え） |
| 起動 | EventBridge Scheduler → Step Functions / Lambda | **EventBridge Scheduler → ECS RunTask** |
| API（Web 画面の裏側） | Lambda + HTTP API | **変更なし（Lambda のまま）**。リクエスト時だけ動けばよく、常時起動の ECS サービスは固定費がかかるため |
| IaC | CDK | **Terraform** |

Step Functions は使わない。並列実行・順序・失敗の切り分けはアプリケーション側で行う（§3.2）。

### 3.2 バッチ（作者判断を含む）

- バッチの入口は1つの CLI（例: `backend/src/batch/main.ts`）。コマンド:
  - `run --sources google_maps|threads|google_maps,threads`: 指定ソースの全シャード（Google Map は6ジャンル、Threads は1）を**プロセス内で並列に**収集し、全部終わってから 判定（process）→ HPB 判定 を順に実行する
  - `notify`: 毎朝の通知
  - `refresh-threads-token`: Threads トークンの更新
- 失敗の扱いは Phase 1 の Step Functions と同じ意味にする: あるシャードの収集が失敗しても他のシャードと後続の判定・HPB 判定は実行し、最後に**終了コード非0**で終わる（これがアラームの契機）。判定の失敗も同様
- 途中でタスクが落ちても、DB の状態（raw_items の pending、stores の unchecked）から次回に続きが処理される（Phase 1 の設計のまま）
- Lambda の15分上限に合わせて入れた制限を見直す:
  - 判定の12分打ち切り → 撤廃。代わりにバッチ全体に安全のための上限時間を設ける（例: 2時間。作者判断。暴走時の課金を防ぐため）
  - HPB 判定の1回40件 → 引き上げる（例: 300件。作者判断）
  - Google Map の詳細取得の1日上限（無料枠保護）は維持
- 既存の Lambda 用ハンドラ（collect / process / hpb / notify / refreshThreadsToken）は削除し、中の純粋な関数（runCollect, processPending, checkPendingStores, runNotify, refreshThreadsToken 等）をバッチ CLI から呼ぶ。api ハンドラは残す
- タスクのサイズ: 0.5 vCPU / 1GB から始める（作者判断。並列収集の余裕を見て）
- スケジュール（Phase 1 と同じ時刻、Asia/Tokyo）:
  - `run --sources threads`: 0/6/12/18時
  - `run --sources google_maps`: 5時
  - `notify`: 7時
  - `refresh-threads-token`: 毎週月曜4時

### 3.3 ネットワーク（作者判断）
- VPC を作り、**公開サブネット（2 AZ）に Fargate タスクを置き、パブリック IP を付ける**。NAT ゲートウェイは作らない（固定費回避。§3.8）
- セキュリティグループは**外向き通信のみ許可、内向きは全拒否**
- API の Lambda は VPC に入れない（Phase 1 と同じ）

### 3.4 監視
- ECS タスクが**終了コード非0で停止**したことを EventBridge のルール（ECS Task State Change）で検知し、SNS でオーナーにメール（Phase 1 のパイプライン失敗アラーム・通知 Lambda エラーアラーム・トークン更新エラーアラームの代わり）
- API Lambda のエラーは CloudWatch アラーム → 同じ SNS
- ログは CloudWatch Logs（保持期間は CDK 版に合わせる。未指定なら30日。作者判断）

### 3.5 Docker 開発環境（オーナー判断: 全部 Docker で動かす）

`docker-compose.yml`（ルート）のサービス:

| サービス | 中身 | 備考 |
|---|---|---|
| `db` | PostgreSQL 16 | pg_trgm 使用。開発用 DB とテスト用 DB を初期化スクリプトで作る |
| `batch` | **本番と同じバッチ用イメージ** | `docker compose run --rm batch run --sources google_maps` のように実行 |
| `api` | backend の API ハンドラをローカル HTTP サーバーで包んだもの（例: port 8080） | API Gateway の代わり |
| `frontend` | Next.js 開発サーバー（port 3000） | |
| `tools`（profile 指定時のみ） | Node 22 + Terraform + AWS CLI | テスト実行、Terraform 操作用 |

- ソースはボリュームでマウントし、ホットリロードが効く（作者判断）。`node_modules` はコンテナ側のボリュームに置く（作者判断）
- バッチ用イメージは本番用ビルド（`Dockerfile` の本番ステージ）と同じ内容。開発時はソースマウントで上書きできるステージを別に持ってよい

### 3.6 ローカル実行モード（作者判断）

環境変数 `APP_ENV=local` のときだけ次を差し替える。本番では `APP_ENV` を設定しない（未設定 = 本番動作）。

| 本番 | ローカル |
|---|---|
| SSM から秘密情報を読む | 環境変数から読む（`.env`） |
| SES でメール送信 | **モック**: 件名・本文をログに出すだけ（オーナー判断） |
| Cognito ログイン | 省略。ローカル API サーバーが固定クレーム（`username: 'local-dev'`）を付けてハンドラに渡す。フロントは `NEXT_PUBLIC_AUTH_MODE=none` でログインを省略するが、`next dev` のときだけ有効で本番ビルドでは無視する |

- **外部 API のフェイク**: `FAKE_EXTERNAL=1` のとき、Places / Threads / Claude / HPB の各クライアントを決まったデータを返すフェイクに差し替える。`APP_ENV=local` のときだけ有効。フェイクのデータには、Map と Threads で同じ店が出る例・maybe の例・HPB 掲載ありの例を含める
- キーを `.env` に入れて `FAKE_EXTERNAL` を外せば、本物の外部 API を叩ける（メールはローカルでは常にモック）
- `APP_ENV=local` 以外でフェイク・認証省略・メールモックが有効にならないことをテストで保証する

### 3.7 Terraform（オーナー判断: CDK から置き換え）

- **CDK を完全に削除**: コード・依存パッケージ・`infra` の npm workspace 登録・CDK のテスト（作者判断）。`infra/` は Node のワークスペースではなくなり、Terraform のテストは `tools` コンテナから実行する
- 構成（作者判断）:
  ```
  infra/
    modules/salon_watcher/   ← 本番の AWS 構成すべて
    envs/prod/               ← 本番向け。アカウント発行までは local state、発行後に S3 backend へ切り替え
  ```
- 作るもの: ECR、ECS クラスター・タスク定義（タスクロール / 実行ロール）、VPC・公開サブネット・セキュリティグループ、EventBridge Scheduler 4本（§3.2 の時刻、コマンドを上書きして RunTask）、タスク異常終了の EventBridge ルール → SNS（メール購読）、API Lambda + HTTP API + JWT オーソライザー、Cognito、S3 + CloudFront（OAC・index.html 書き換え関数）、SES 送信元 ID、CloudWatch Logs、API Lambda エラーアラーム
- IAM の範囲: タスクロールは SSM 読み取りを `/salon-watcher/*` のみ、PutParameter は Threads トークンのみ、SES 送信。実行ロールは ECR 取得とログ出力のみ
- 設定値（cron 式、Cognito、CORS、コールバック URL、CloudFront 関数、アラームのしきい値など、Phase 1 と共通のもの）は、レビュー済みの CDK スタック `infra/lib/salonWatcherStack.ts` の値をそのまま写す。親設計書と食い違う場合も CDK スタックを優先する
- 出力: サイト URL・API URL・CognitoAuthority・クライアント ID・ECR リポジトリ URL 等
- 入力変数: `owner_email` `notify_from` `notify_to` `cognito_domain_prefix` `sources_disabled`。`example.com` を含む値は validation で拒否。実値は `terraform.tfvars`（コミットしない。`*.tfvars.example` を置く）
- ビルドと配信: バッチは `docker build` → ECR に push。API Lambda は esbuild で zip。フロントは `terraform apply` 後にビルドして `aws s3 sync`（スクリプトにまとめる。作者判断）
- 本番の DB 接続文字列は Phase 1 と同じく SSM に手動登録（Terraform では作らない）
- 確認方法: `terraform fmt -check`・`terraform validate`、自動テスト（`terraform test` 等、ビルダー判断）でスケジュール式とタイムゾーン、IAM の範囲、セキュリティグループに内向きルールが無いこと、Cognito の管理者のみ作成 を確認

### 3.8 DB を VPC の外（Neon）に置く理由（設計資料と README の両方に記載する）
- 本来は、DB を VPC 内（RDS 等）に置き、アプリも VPC 内からインターネットへは NAT ゲートウェイ経由で出る構成が望ましい（DB を外部に晒さない、通信経路を閉じられる）
- しかし NAT ゲートウェイは**常時課金で月 $35 程度以上**（概算）かかり、個人ツールで効果を見極めている**観察期間**の費用として見合わない
- そこで観察期間中は、DB を VPC 外のマネージド PostgreSQL（Neon、TLS 接続、無料枠）に置き、バッチは公開サブネットのパブリック IP から直接外部へ出る構成をとる
- **費用対効果が確認できたら**、VPC 内の RDS + プライベートサブネット + NAT の構成へ移行する（移行時の変更点: DB 接続文字列、タスクのサブネット、NAT の追加）
- この説明を親設計書（§8）と新規 `README.md` に記載する

### 3.9 web → frontend 改名（オーナー判断）
- ディレクトリ・npm workspace 名・スクリプト・ドキュメント・CLAUDE.md・Terraform の参照をすべて `frontend` に変更。振る舞いは変えない

### 3.10 ドキュメント
- 新規 `README.md`（ルート）: 何をするツールか、構成図（簡易）、DB を VPC 外に置く理由（§3.8）、開発・デプロイ手順書へのリンク
- 新規 `docs/development.md`: `.env` の作り方、`docker compose up`、テスト、バッチのローカル実行、本物の API への切り替え
- `docs/deploy.md` を Terraform + ECS 前提に書き直す（2段階デプロイ、イメージの push、SES サンドボックス、Cognito ユーザー作成などは維持）
- CLAUDE.md の構成・テストコマンドの記述を更新
- 親設計書 §8 に「バッチ実行基盤と IaC は本書で置き換え」の注記と §3.8 の DB の理由を追記

### 3.11 作業の土台
- PR #1 のマージ後、`master` から新しいブランチを切る。既存の `docker-compose.yml`（テスト専用、port 5433）は置き換え、テストの既定接続先も compose の `db` に合わせる

### 3.12 AWS 上の通し確認（2026-11-08 改訂、オーナー判断）
- LocalStack は使わない。理由: (1) アプリが使う外部 API と AWS 機能（SSM・SES）はアプリ側の差し替え（§3.6）で代替済み、(2) 設定値の誤りは `terraform test` で確認済み、(3) IAM 権限不足など本番特有の誤りは LocalStack では検出できず結局本物の AWS が要る、(4) LocalStack は AWS とは別のアカウント・トークンが必要でオーナーはアカウントを AWS に一本化したい
- AWS アカウント発行後、`docs/deploy.md` の手順で本番に適用し、スケジュールを待たずに RunTask を手動で1回起動して、バッチ実行 → Neon への書き込み → 画面表示までを確認する。手順（手動起動のコマンドと確認項目）を `docs/deploy.md` に書く

## 4. ビルダーに任せること
- Node のベースイメージ、Dockerfile のステージ構成、compose の細部（ヘルスチェック、ポート番号）
- ローカル API サーバーの実装方法
- バッチ CLI の引数解析の方法
- Terraform のファイル分割、`terraform test` か別手段か
- フェイクのデータの具体的な中身（上記の例を含むこと）

## 5. リスク
| 項目 | 内容 | 対応 |
|---|---|---|
| AWS 上の経路はアカウント発行まで未確認 | Scheduler → ECS 起動、IAM 権限不足などは本物の AWS でしか分からない | 設定値は `terraform test` で固定。発行後に §3.12 の手順で通し確認 |
| 実行基盤の書き換えで振る舞いが変わる | 失敗時の扱い・順序 | §3.2 の失敗の扱いを自動テストで固定 |
| Fargate のパブリック IP | タスクに公開 IP が付く | 内向き全拒否のセキュリティグループで受け付けない。Terraform のテストで内向きルールが無いことを確認 |
