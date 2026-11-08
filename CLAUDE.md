# CLAUDE.md

このリポジトリは **public** です。以下を必ず守ること。

## 個人情報・秘密情報の取り扱い（最優先）

- **オーナーの個人メールアドレス（Gmail 等）をリポジトリに載せない。** ファイル内容・コミットメッセージ・コミットの author/committer・PR/Issue 本文のいずれにも含めない。
- コミットの author/committer は GitHub の noreply アドレス `232617963+Wataruuuu-sys@users.noreply.github.com` を使う（このリポジトリの `git config user.email` に設定済み）。コミット前に `git config user.email` がこの値であることを確認する。
- 通知先などでメールアドレスが必要な場合は、コードや設定ファイルに書かず、Terraform の変数（`terraform.tfvars`。コミットしない）・環境変数・SSM パラメータで渡す。サンプル値は `*.invalid` ドメインを使う（`example.com` は Terraform の validation で拒否される）。
- API キー・トークン・接続文字列などの秘密情報はコミットしない。SSM Parameter Store（`/salon-watcher/*`）に置く。
- push・PR 作成の前に、追加差分と履歴に個人メールアドレスや秘密情報が含まれていないか確認する（例: `git log -p origin/master..HEAD | grep -nE "@gmail\.com|AIza|sk-ant-|AKIA"`）。

## プロジェクト概要

- 新店サロンウォッチャー v4: 多摩地域26市の新規美容サロンを Google Map / Threads から収集し、根拠URL付きリードとして通知する個人ツール。
- 設計書: `docs/superpowers/specs/2026-10-18-salon-watcher-v4-design.md`（判断の拠り所。最悪の失敗は「本当の新店を見逃すこと」）
- 構成: `backend/`（TypeScript, Vitest, Drizzle + PostgreSQL）、`frontend/`（Next.js 静的書き出し）、`infra/`（Terraform: `modules/salon_watcher`, `envs/prod`, `tests/`, `scripts/`。バッチは ECS Fargate、API のみ Lambda）、`legacy/gas-v3/`（旧GAS版、参照用）
- 開発環境は Docker（`docker compose`。プラグインが無い環境では `docker-compose`）。詳細は `docs/development.md`
- テスト（ローカル DB は `docker compose up -d db`、既定 `postgres://postgres:postgres@localhost:5433/salon_test`）:
  - `npm -w backend test`（または `docker compose run --rm tools npm -w backend test`）
  - `npm -w frontend test`、`npm run check:compose`
  - インフラ: `docker compose run --rm tools terraform -chdir=infra test`（事前に `terraform -chdir=infra init -backend=false`）、`terraform fmt -check -recursive infra`、`terraform -chdir=infra/envs/prod validate`
- デプロイ手順: `docs/deploy.md`（概要・DB を VPC 外に置く理由は `README.md`）
