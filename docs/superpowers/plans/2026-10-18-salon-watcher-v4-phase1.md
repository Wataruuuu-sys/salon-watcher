# 新店サロンウォッチャー v4 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Map（全多摩スイープ）と Threads 公式API から新店候補を自動収集し、LLM判定・名寄せ・HPB掲載判定を経て、根拠URL付きリードとして Web UI とメールで届ける。

**Architecture:** 各ソースは `Source` インターフェースを実装する独立モジュールで、共通形式の `RawItemInput` を `raw_items` テーブルに書くだけ。後段（判定 → 名寄せ → HPB判定 → 通知）は DB のステータスを見て動き、ソースを知らない。EventBridge Scheduler → Step Functions（collect を Map で並列 → process → hpb）→ Lambda。UI は Next.js 静的書き出し＋API Lambda（Cognito JWT）。

**Tech Stack:** TypeScript (Node.js 22), npm workspaces, Vitest, PostgreSQL 16 + pg_trgm (本番 Neon), Drizzle ORM + drizzle-kit + postgres.js, @anthropic-ai/sdk, AWS CDK v2, Step Functions, Lambda, EventBridge Scheduler, API Gateway HTTP API, Cognito, SES, SSM Parameter Store, Next.js (output: 'export'), oidc-client-ts, Docker Compose（テスト用DB）。

**Spec:** `docs/superpowers/specs/2026-10-18-salon-watcher-v4-design.md`

**スコープ:** 設計書 §9 の Phase 1 のみ。Instagram（Phase 2）、運用画面・対応済みフラグ・HPB再判定ジョブ・minimo（Phase 3）は含めない。

## Global Constraints

- 対象ジャンル6つ: ヘア / ネイル / アイ（まつエク・まつげパーマ・眉） / リラクゼーション / エステ / 整体
- 対象エリア: 多摩地域26市（八王子・立川・武蔵野・三鷹・青梅・府中・昭島・調布・町田・小金井・小平・日野・東村山・国分寺・国立・福生・狛江・東大和・清瀬・東久留米・武蔵村山・多摩・稲城・羽村・あきる野・西東京）。西多摩郡は含めない
- 見逃し優先: 判定が曖昧なものは落とさず `maybe` として残す。`no` だけ落とす。落とした raw item も削除しない
- リードに連絡先（電話番号等）を載せない。各リードに根拠URLを必ず1件以上付ける
- HPB掲載ありの店も行を消さない（印を付けてデフォルト表示から外すだけ）
- Places 検索は IDs Only（FieldMask `places.id,nextPageToken`）のみ。詳細取得は新規IDのみ、Pro 以下のフィールドだけ（`websiteUri` `userRatingCount` は取らない）
- Threads は公式API `/keyword_search` のみ。スクレイピングしない。上限 2,200 クエリ / ローリング24時間
- Threads の検索ワードはハードコードしない。既定値は設定ファイル（`backend/src/config/threadsQueries.ts`）、ユーザーが Web 画面から上書きでき、上書き値は DB `settings` に保存される。保存時に「件数 × 1日4回 ≤ 2,200」を検証する
- 実行頻度: Threads 6時間ごと（0/6/12/18時 JST）、Google Map 1日1回（5時 JST）、メール通知 1日1回 7時 JST・新規0件の日は送らない
- メール: `yes` と Map 由来のリードを列挙、`maybe` は件数と UI リンクのみ
- UI: デフォルトタブ = `yes`＋Map 由来、`maybe` は別タブ。ログイン必須
- シークレットは SSM Parameter Store（SecureString）: `/salon-watcher/DATABASE_URL` `/salon-watcher/PLACES_API_KEY` `/salon-watcher/THREADS_ACCESS_TOKEN` `/salon-watcher/ANTHROPIC_API_KEY`
- LLM モデル: Claude Haiku 系の最新（この環境では `claude-haiku-5-5`）。実装前に `claude-api` スキルでモデルIDと構造化出力の書き方を確認する
- 時刻はすべて timestamptz で保存し、表示とスケジュールは Asia/Tokyo

## Review Focus

1. **Threads のアクセストークン（長期トークン60日）が切れる** → 週1回の自動更新があり、更新失敗や 401 は握りつぶさずオーナーに通知メールが飛ぶ。Task 7 にテスト。
2. **同じ店が Map と Threads で表記ゆれ付きで出る**（全角/半角、`Nail Salon ○○` と `ネイルサロン○○`、末尾の「立川店」）→ 1店舗に統合され根拠URLが2件並ぶ。Task 4 にテスト。
3. **LLM 呼び出しの失敗・壊れたJSON** → raw item は落ちずに再試行され、3回失敗したら `maybe`（理由「判定失敗」）として残る。Task 5 にテスト。
4. **HPB サイトの構造変更・タイムアウト・ブロック** → `not_listed` ではなく `unknown` になる（誤って営業対象から外さない／誤って「未掲載確定」にしない）。Task 8 にテスト。
5. **飽和セルを4分割した直後、新セルで初めて見えた既存店が「新店」として大量通知される** → 未シードのセルで見つかった ID は既知として記録するだけでリードにしない。Task 6 にテスト。

---

## File Structure

```
/                         リポジトリルート（npm workspaces）
  package.json            workspaces: ["backend","infra","web"]
  tsconfig.base.json
  docker-compose.yml      テスト用 Postgres 16（port 5433）
  legacy/gas-v3/          既存 code.js / index.html / README.md を移動（Phase 1 安定まで並行稼働の参照用）
  backend/
    package.json  vitest.config.ts  drizzle.config.ts
    drizzle/              生成マイグレーション
    src/
      config/areas.ts     26市・多摩グリッド範囲
      config/genres.ts    6ジャンルと各ソースの検索語
      domain/types.ts     共有型
      db/schema.ts        Drizzle スキーマ
      db/client.ts        createDb(url)
      sources/types.ts    Source / SourceContext
      sources/registry.ts
      sources/ingest.ts   ingestRawItems
      sources/googleMaps/{grid.ts,places.ts,sweep.ts,source.ts}
      sources/threads/{queries.ts,client.ts,source.ts,tokenRefresh.ts}
      resolve/normalize.ts  resolve/resolveStore.ts
      classify/{prefilter.ts,llm.ts,classify.ts}
      hpb/{parse.ts,check.ts}
      notify/{compose.ts,send.ts}
      handlers/{collect.ts,process.ts,hpb.ts,notify.ts,refreshThreadsToken.ts,api.ts}
      lib/{secrets.ts,log.ts}
      cli/importV3.ts
    test/                 src と同じ構造で *.test.ts、test/helpers/db.ts
  infra/
    bin/app.ts  lib/salonWatcherStack.ts  test/stack.test.ts
  web/
    next.config.mjs  src/app/page.tsx  src/app/callback/page.tsx
    src/lib/{auth.ts,api.ts}  src/components/{LeadTable.tsx,Filters.tsx}
    test/LeadTable.test.tsx
```

---

### Task 1: リポジトリ初期化・ワークスペース・設定データ

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `docker-compose.yml`, `backend/package.json`, `backend/tsconfig.json`, `backend/vitest.config.ts`, `backend/src/config/areas.ts`, `backend/src/config/genres.ts`, `backend/src/domain/types.ts`
- Move: `code.js` `index.html` `README.md` → `legacy/gas-v3/`
- Test: `backend/test/config/config.test.ts`

**Interfaces:**
- Produces:
  - `domain/types.ts`:
    ```ts
    export type Genre = 'hair'|'nail'|'eye'|'relax'|'esthe'|'seitai';
    export type SourceId = 'google_maps'|'threads';
    export type Verdict = 'yes'|'maybe'|'no';
    export type Confidence = 'yes'|'map'|'maybe';   // 強い順 yes > map > maybe
    export type HpbStatus = 'unchecked'|'listed'|'not_listed'|'unknown';
    export interface Classification {
      verdict: Verdict; storeName: string|null; genre: Genre|null; city: string|null;
      openingDate: string|null; reason: string; signals: string[];
    }
    export interface RawItemInput {
      source: SourceId; externalId: string; url: string; authorHandle: string|null;
      text: string; postedAt: Date|null; payload: unknown;
      placeId?: string; preclassified?: Classification;   // Map 由来は LLM を通さない
    }
    ```
  - `config/areas.ts`: `export const TAMA_CITIES: readonly string[]`（26市を「八王子市」形式で）, `export const TAMA_BBOX = { south: 35.57, north: 35.84, west: 139.02, east: 139.60 }`, `export function cityFromAddress(address: string): string|null`（「東京都」を含み26市のどれかを含めばその市名、なければ null）
  - `config/genres.ts`: `export const GENRES: { id: Genre; label: string; mapsQueries: string[]; threadsWords: string[] }[]`
    - hair: 'ヘア', maps ['美容院'], threads ['美容室']
    - nail: 'ネイル', ['ネイルサロン'], ['ネイル']
    - eye: 'アイ', ['マツエク','眉毛サロン'], ['マツエク']
    - relax: 'リラクゼーション', ['リラクゼーションサロン'], ['リラク']
    - esthe: 'エステ', ['エステサロン'], ['エステ']
    - seitai: '整体', ['整体'], ['整体']
  - `OPEN_WORDS = ['オープン','OPEN','新店','開業','グランドオープン','プレオープン','NEW OPEN']`（prefilter 用、genres.ts に置く）

- [ ] **Step 1:** `git init`、現状をそのままコミット（`chore: snapshot v3 GAS`）、`git mv` で v3 の3ファイルを `legacy/gas-v3/` へ移しコミット
- [ ] **Step 2:** ルート `package.json`（workspaces, scripts: `test`=`npm -w backend test`）、`tsconfig.base.json`（strict, ES2022, moduleResolution bundler）、`docker-compose.yml`（postgres:16, port 5433:5432, POSTGRES_PASSWORD=test, DB `salon_test`）、backend の vitest 設定を作る
- [ ] **Step 3: 失敗するテストを書く** `config.test.ts`
  ```ts
  expect(TAMA_CITIES).toHaveLength(26);
  expect(TAMA_CITIES).toContain('西東京市');
  expect(TAMA_CITIES).not.toContain('瑞穂町');
  expect(GENRES.map(g => g.id)).toEqual(['hair','nail','eye','relax','esthe','seitai']);
  expect(cityFromAddress('日本、〒190-0012 東京都立川市曙町2丁目')).toBe('立川市');
  expect(cityFromAddress('広島県府中市府川町')).toBeNull();
  expect(cityFromAddress('東京都西東京市田無町')).toBe('西東京市');   // 「東京都」部分一致で誤判定しない
  ```
- [ ] **Step 4:** `npm test` → FAIL（モジュールなし）
- [ ] **Step 5:** 実装。`cityFromAddress` は長い市名から順に照合する（「東京都」除去後の文字列で）
- [ ] **Step 6:** `npm test` → PASS
- [ ] **Step 7:** コミット `feat: workspace scaffold and area/genre config`

---

### Task 2: DB スキーマとマイグレーション

**Files:**
- Create: `backend/src/db/schema.ts`, `backend/src/db/client.ts`, `backend/drizzle.config.ts`, `backend/drizzle/*`（生成物）, `backend/test/helpers/db.ts`
- Test: `backend/test/db/schema.test.ts`

**Interfaces:**
- Produces:
  - `createDb(url: string): Db`（Drizzle インスタンス、`Db` 型を export）
  - `test/helpers/db.ts`: `getTestDb(): Promise<Db>`（`TEST_DATABASE_URL` 既定 `postgres://postgres:test@localhost:5433/salon_test`、マイグレーション適用済み）, `resetDb(db): Promise<void>`（全テーブル TRUNCATE ... RESTART IDENTITY CASCADE）
  - テーブル（列名は snake_case、Drizzle 側は camelCase）:
    - `raw_items`: id bigserial PK, source text, external_id text, url text, author_handle text null, text text, posted_at timestamptz null, payload jsonb, place_id text null, preclassified jsonb null, classification jsonb null, status text not null default 'pending'（'pending'|'resolved'|'rejected'）, attempts int default 0, fetched_at timestamptz default now()。UNIQUE(source, external_id)、INDEX(status)
    - `stores`: id bigserial PK, name text, name_norm text, genre text null, city text null, place_id text UNIQUE null, sns_handle text UNIQUE null（`threads:<username>` 形式）, confidence text, opening_date text null, hpb_status text default 'unchecked', hpb_url text null, hpb_checked_at timestamptz null, first_seen_at timestamptz default now(), notified_at timestamptz null。GIN(name_norm gin_trgm_ops)
    - `evidence`: id bigserial PK, store_id → stores, raw_item_id → raw_items UNIQUE, source text, url text, confidence text, reason text, observed_at timestamptz default now()
    - `places_seen`: place_id text PK, genre text, first_seen_at timestamptz default now(), details_fetched boolean default false, is_lead_candidate boolean default false
    - `map_cells`: id bigserial PK, genre text, lat double, lng double, radius_m int, parent_id bigint null, seeded boolean default false, active boolean default true, last_count int null, last_run_at timestamptz null。INDEX(genre, active)
    - `settings`: key text PK, value jsonb not null, updated_at timestamptz default now(), updated_by text null（ユーザーが画面から変える設定。Phase 1 はキー `threads.queries` のみ）
  - 最初のマイグレーションの先頭に `CREATE EXTENSION IF NOT EXISTS pg_trgm;`

- [ ] **Step 1: 失敗するテスト** `schema.test.ts`: `getTestDb()` 後に `select extname from pg_extension` に `pg_trgm` が含まれる / `raw_items` に同じ (source, external_id) を2回 insert すると2回目が unique 違反
- [ ] **Step 2:** `docker compose up -d db && npm -w backend test` → FAIL
- [ ] **Step 3:** スキーマ実装、`npx drizzle-kit generate` でマイグレーション生成、先頭に拡張を追記。`getTestDb` は drizzle-orm の `migrate()` を使う
- [ ] **Step 4:** テスト → PASS
- [ ] **Step 5:** コミット `feat: postgres schema`

---

### Task 3: ソース契約と raw item 取り込み

**Files:**
- Create: `backend/src/sources/types.ts`, `backend/src/sources/registry.ts`, `backend/src/sources/ingest.ts`, `backend/src/lib/secrets.ts`, `backend/src/lib/log.ts`
- Test: `backend/test/sources/ingest.test.ts`, `backend/test/sources/registry.test.ts`

**Interfaces:**
- Consumes: `Db`, `RawItemInput`, `SourceId`
- Produces:
  ```ts
  export interface SecretStore { get(name: string): Promise<string>; put(name: string, value: string): Promise<void>; }
  export interface SourceContext { db: Db; http: typeof fetch; secrets: SecretStore; now: Date; log: Logger; }
  export interface Source {
    id: SourceId;
    listShards(ctx: SourceContext): Promise<string[]>;          // Step Functions Map の単位
    collect(shard: string, ctx: SourceContext): Promise<RawItemInput[]>;
  }
  ingestRawItems(db: Db, items: RawItemInput[]): Promise<{ inserted: number; skipped: number }>
  getSource(id: SourceId): Source               // 未知IDは throw
  ENABLED_SOURCES: SourceId[]                    // 既定 ['google_maps','threads']、env SOURCES_DISABLED(カンマ区切り)で除外
  ssmSecretStore(prefix = '/salon-watcher/'): SecretStore   // @aws-sdk/client-ssm, WithDecryption, put は Overwrite
  ```
  `ingestRawItems` は `ON CONFLICT (source, external_id) DO NOTHING`。`preclassified` は jsonb に保存。
  registry は Task 6/7 のソースを登録する（このタスクではスタブ用テスト Source を受け取れる `registerSource(s)` を export しておく）。

- [ ] **Step 1: 失敗するテスト** `ingest.test.ts`: 同じ externalId を含む2回の ingest → 1回目 `{inserted:2, skipped:0}`、2回目 `{inserted:0, skipped:2}`、行の status は 'pending'。`registry.test.ts`: `SOURCES_DISABLED=threads` のとき `ENABLED_SOURCES` は `['google_maps']`（評価関数 `enabledSources(env)` として export しテスト）
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3:** 実装
- [ ] **Step 4:** PASS を確認
- [ ] **Step 5:** コミット `feat: source contract and raw item ingest`

---

### Task 4: 名寄せ（正規化と店舗解決）

**Files:**
- Create: `backend/src/resolve/normalize.ts`, `backend/src/resolve/resolveStore.ts`
- Test: `backend/test/resolve/normalize.test.ts`, `backend/test/resolve/resolveStore.test.ts`

**Interfaces:**
- Consumes: `Db`, `Classification`, `Confidence`
- Produces:
  ```ts
  normalizeName(name: string): string
  interface ResolveInput { rawItemId: number; source: SourceId; url: string; placeId: string|null;
    snsHandle: string|null; classification: Classification; confidence: Confidence; }
  resolveStore(db: Db, input: ResolveInput): Promise<{ storeId: number; created: boolean }>
  ```
- `normalizeName`: NFKC → 小文字 → 記号・空白除去 → 接頭/接尾の汎用語除去（`ネイルサロン` `nailsalon` `ヘアサロン` `hairsalon` `美容室` `美容院` `salon` `サロン` `エステサロン` `アイラッシュ` `eyelash`）→ 末尾の `○○店` 除去
- 照合順: ① placeId 一致 ② snsHandle 一致 ③ `similarity(name_norm, $n) >= 0.6` かつ city が一致（どちらかの city が null なら city 条件なし）で最も高い1件 ④ なければ新規作成
- 一致時: evidence 追加、`confidence` は強い方に更新、null の placeId / snsHandle / genre / city / openingDate を埋める
- 名前が null（LLM が店名を抽出できない）の場合は ③ を飛ばす。新規作成時の name は snsHandle（なければ「店名不明」）

- [ ] **Step 1: 失敗するテスト** `normalize.test.ts`
  ```ts
  expect(normalizeName('Nail Salon Lily 立川店')).toBe(normalizeName('ネイルサロン　ｌｉｌｙ'));   // どちらも 'lily'
  expect(normalizeName('ｈａｉｒ　ｍａｋｅ　ＲＩＮ')).toBe('hairmakerin');
  ```
  `resolveStore.test.ts`:
  - Map 由来（placeId 'P1', name 'ネイルサロン Lily', city '立川市', confidence 'map'）→ created true
  - Threads 由来（placeId null, handle 'threads:lily_nail', name 'Nail Salon Lily 立川店', city '立川市', confidence 'yes'）→ 同じ storeId, created false、evidence 2件、stores.confidence = 'yes'、sns_handle が埋まる
  - 同名で city '八王子市' → 別店舗（created true）
  - 同じ handle で別名 → 既存店に統合
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3:** 実装（③ は `sql` テンプレートで `similarity()` を使う。トランザクション内で実行）
- [ ] **Step 4:** PASS を確認
- [ ] **Step 5:** コミット `feat: store resolution with fuzzy name matching`

---

### Task 5: 判定（プレフィルタ＋LLM＋後処理）

**Files:**
- Create: `backend/src/classify/prefilter.ts`, `backend/src/classify/llm.ts`, `backend/src/classify/classify.ts`
- Test: `backend/test/classify/prefilter.test.ts`, `backend/test/classify/classify.test.ts`

**Interfaces:**
- Consumes: `Classification`, `TAMA_CITIES`, `GENRES`, `OPEN_WORDS`
- Produces:
  ```ts
  passesPrefilter(text: string): boolean     // NFKC 後に OPEN_WORDS のいずれかを含む（大小無視）
  interface LlmClassifier { classify(input: { text: string; authorHandle: string|null; postedAt: Date|null }): Promise<Classification>; }
  anthropicClassifier(apiKey: string, model = 'claude-haiku-5-5'): LlmClassifier
  postProcess(c: Classification): Classification
  classifyItem(item: { text: string; authorHandle: string|null; postedAt: Date|null }, llm: LlmClassifier): Promise<Classification>
  ```
- LLM: ツール使用（単一ツール `record_classification`、input_schema = Classification、genre は enum、verdict は enum）で構造化出力を強制。システムプロンプトに含める事項: 対象26市の一覧、6ジャンル定義、「新店」の定義（オープン予定〜開業後おおむね3ヶ月、移転・自宅サロン含む、signals に `relocation` `home_salon` 等を入れる）、判定基準（yes=開業告知が明確・対象エリア内と分かる・対象ジャンル / maybe=どれかが不明確 / no=明らかに対象外: 他県・既存店のキャンペーン・美容以外）、迷ったら maybe
- `postProcess`: city が非 null かつ TAMA_CITIES 外 → verdict 'no'（reason に「エリア外」追記）。verdict 'yes' で city も genre も null → 'maybe' に下げる
- `classifyItem`: prefilter 不通過 → `{verdict:'no', reason:'prefilter', ...null}` を LLM を呼ばず返す

- [ ] **Step 1: 失敗するテスト**
  - prefilter: `'11/1 立川にネイルサロンOPEN'` → true、`'今日のネイルデザイン'` → false、`'ｏｐｅｎしました'` → true
  - classify（フェイク LlmClassifier）: city '横浜市' の yes → no / city null・genre null の yes → maybe / prefilter 不通過で LLM が呼ばれない（呼び出し回数0）
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3:** 実装（`anthropicClassifier` は単体テストしない。`claude-api` スキルで SDK の tool_choice 指定方法を確認）
- [ ] **Step 4:** PASS を確認
- [ ] **Step 5:** コミット `feat: post classification`

---

### Task 6: Google Map ソース（グリッド・自動分割・シード・詳細取得）

**Files:**
- Create: `backend/src/sources/googleMaps/grid.ts`, `places.ts`, `sweep.ts`, `source.ts`
- Modify: `backend/src/sources/registry.ts`（登録）
- Test: `backend/test/sources/googleMaps/grid.test.ts`, `sweep.test.ts`, `source.test.ts`

**Interfaces:**
- Consumes: `Source`, `SourceContext`, `RawItemInput`, `TAMA_BBOX`, `cityFromAddress`, `GENRES`, `Db`
- Produces:
  ```ts
  // grid.ts
  interface Cell { lat: number; lng: number; radiusM: number }
  cellBounds(c: Cell): { low: {lat:number;lng:number}; high: {lat:number;lng:number} }   // v3 cellBounds_ と同じ計算
  baseGrid(bbox = TAMA_BBOX, radiusM = 750): Cell[]      // 1.5km 角の格子
  subdivide(c: Cell): [Cell, Cell, Cell, Cell]             // 半径1/2、四象限の中心
  ensureCells(db: Db, genre: Genre): Promise<void>        // map_cells にそのジャンルの行が無ければ baseGrid を insert（seeded=false）
  // places.ts
  interface PlacesClient {
    searchIds(query: string, cell: Cell, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }>;
    details(placeId: string): Promise<PlaceDetails|null>;
  }
  interface PlaceDetails { id: string; name: string; address: string; mapsUrl: string; businessStatus: string; openingDate: string|null; types: string[] }
  placesClient(apiKey: string, http: typeof fetch): PlacesClient
  // sweep.ts
  sweepGenre(db: Db, client: PlacesClient, genre: Genre, opts?: { maxSubdivideDepth?: number /*既定3*/; concurrency?: number /*既定10*/ }): Promise<{ queried: number; newIds: number; subdivided: number }>
  // source.ts
  googleMapsSource: Source   // listShards = GENRES の id、collect(genre)
  ```
- `searchIds` の body は v3 `buildSearchRequest_` と同じ（`languageCode:'ja'`, `pageSize:20`, `includeFutureOpeningBusinesses:true`, `rankPreference:'DISTANCE'`, `locationRestriction.rectangle`）。FieldMask `places.id,nextPageToken`。最大3ページ
- `details` の FieldMask: `id,displayName,formattedAddress,googleMapsUri,businessStatus,openingDate,types`（Pro）。400 なら `openingDate` を外して再試行（v3 と同じフォールバック）
- `sweepGenre` のアルゴリズム:
  1. そのジャンルの active なセルごとに、`mapsQueries` の各語で全ページ検索。ID を集合に集める
  2. 合計60件到達（3ページ目が20件 or 3ページ目後に token が残る）かつ depth < max → セルを inactive にし、4子セルを seeded=false で insert し、子セルを同じ run 内で即検索（再帰）
  3. 見つかった ID のうち `places_seen` に無いもの: セルが seeded=true なら `is_lead_candidate=true`、seeded=false なら false で insert
  4. run の最後に、この run で検索した seeded=false のセルを seeded=true に更新。`last_count` `last_run_at` を更新
- `collect(genre)`:
  1. `ensureCells` → `sweepGenre`
  2. `places_seen` の `is_lead_candidate=true AND details_fetched=false` を古い順に最大 `MAPS_DETAILS_PER_RUN`（既定 25 = 6ジャンル×25×30日 ≈ 4,500/月 < Pro 無料枠 5,000）件 details 取得、取れたら details_fetched=true
  3. `businessStatus !== 'CLOSED_PERMANENTLY'` かつ `cityFromAddress(address)` が非 null のものだけ RawItemInput にする: source 'google_maps', externalId = placeId, url = mapsUrl, text = name+address, placeId, preclassified = `{verdict:'yes', storeName:name, genre, city, openingDate, reason:'Google Mapに新規出現', signals: businessStatus==='FUTURE_OPENING' ? ['FUTURE_OPENING'] : []}`
  - preclassified の確度は Task 9 で `confidence:'map'` として扱う

- [ ] **Step 1: 失敗するテスト**
  - grid: `subdivide({lat:35.7,lng:139.4,radiusM:600})` の4子は radiusM 300、子の bounds の和が親の bounds と一致（誤差1e-9）。`baseGrid()` の全セル中心が TAMA_BBOX 内
  - sweep（フェイク PlacesClient、セル座標→ID 配列のマップで応答）:
    - **初回 run**: すべて seeded=false → `places_seen` は全件 `is_lead_candidate=false`、run 後全セル seeded=true
    - **2回目 run** で新 ID 'NEW1' が1件増える → 'NEW1' だけ is_lead_candidate=true
    - **飽和**: あるセルが60件返す → そのセルは inactive、子4セル追加。子セルで初めて見えた ID 'HIDDEN1' は is_lead_candidate=false（Review Focus 5）
    - 同じ ID が2ジャンルで出ても places_seen は1行（PK）、genre は先に見つけた方
  - source: details が `CLOSED_PERMANENTLY` → 出力に含まれない / 住所が `神奈川県相模原市` → 含まれない / `FUTURE_OPENING` → signals に 'FUTURE_OPENING' / details 上限 25 を超える候補は次回に残る（details_fetched=false のまま）
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3:** 実装（concurrency は単純な Promise プールで。HTTP 429 は指数バックオフ3回）
- [ ] **Step 4:** PASS を確認
- [ ] **Step 5:** コミット `feat: google maps source with adaptive grid`

---

### Task 7: Threads ソースとトークン更新

**Files:**
- Create: `backend/src/config/threadsQueries.ts`, `backend/src/sources/threads/queries.ts`, `client.ts`, `source.ts`, `tokenRefresh.ts`
- Modify: `backend/src/sources/registry.ts`
- Test: `backend/test/sources/threads/queries.test.ts`, `source.test.ts`, `tokenRefresh.test.ts`

**Interfaces:**
- Consumes: `Source`, `SourceContext`, `SecretStore`, `TAMA_CITIES`, `GENRES`, `Db`（`settings` テーブル）
- Produces:
  ```ts
  // config/threadsQueries.ts（既定値の設定ファイル。コードの他の場所に検索語を書かない）
  export const THREADS_QUERY_DEFAULTS = { areas: string[] /*26市から「市」を除いた名*/, words: string[] /*GENRES の threadsWords*/, openWords: ['オープン','新店'] }
  export const THREADS_RUNS_PER_DAY = 4; export const THREADS_DAILY_QUOTA = 2200;
  // sources/threads/queries.ts
  defaultThreadsQueries(): string[]        // areas × words × openWords を `${area} ${word} ${open}` で展開
  validateThreadsQueries(input: string[]): { ok: true; queries: string[] } | { ok: false; error: string }
      // trim・空行除去・重複除去後、1件以上かつ 件数 × THREADS_RUNS_PER_DAY <= THREADS_DAILY_QUOTA、1件100文字以内
  loadThreadsQueries(db: Db): Promise<{ queries: string[]; source: 'default'|'custom' }>   // settings 'threads.queries' があればそれ、なければ既定
  saveThreadsQueries(db: Db, input: string[], updatedBy: string): Promise<ReturnType<typeof validateThreadsQueries>>   // 検証 NG なら保存しない
  resetThreadsQueries(db: Db): Promise<void>   // 上書きを削除して既定に戻す
  interface ThreadsPost { id: string; text: string; permalink: string; username: string; timestamp: string }
  interface ThreadsClient { keywordSearch(q: string): Promise<ThreadsPost[]> }
  threadsClient(token: string, http: typeof fetch): ThreadsClient
  threadsSource: Source             // listShards = ['all']
  refreshThreadsToken(secrets: SecretStore, http: typeof fetch): Promise<{ expiresInSec: number }>
  class ThreadsAuthError extends Error {}
  ```
- `keywordSearch`: `GET https://graph.threads.net/v1.0/keyword_search?q=..&search_type=RECENT&fields=id,text,permalink,username,timestamp&access_token=..`（実装前に Meta 公式ドキュメント https://developers.facebook.com/documentation/threads/keyword-search でパラメータ名・フィールド名を確認）。401/190 エラーは `ThreadsAuthError` を throw
- 既定のクエリ数: 26市 × 6ジャンル(threadsWords は各1語) × 2 = 312 クエリ/run、1日4 run = 1,248 < 2,200
- collect: `loadThreadsQueries` の全クエリを直列〜並列4で実行、post id で重複除去 → RawItemInput（source 'threads', externalId = id, url = permalink, authorHandle = `threads:${username}`, text, postedAt）。`ThreadsAuthError` は握りつぶさず再 throw（Step Functions を失敗させ、Task 13 のアラームでオーナーに通知）
- `refreshThreadsToken`: `GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=..` → 新トークンを `secrets.put('THREADS_ACCESS_TOKEN', ...)`

- [ ] **Step 1: 失敗するテスト**
  - queries（実DB）: `defaultThreadsQueries()` は長さ 312 で `'立川 ネイル オープン'` を含み、312×4 ≤ 2200 / settings 無し → `source:'default'` / `saveThreadsQueries(db, [' 立川 新規オープン ', '', '立川 新規オープン'], 'u')` → ok、load すると `['立川 新規オープン']`・`source:'custom'` / 551件の保存 → ok:false、既存の上書きは変わらない / `resetThreadsQueries` 後は default
  - source（フェイク client）: 2クエリが同じ post を返す → RawItemInput 1件、authorHandle は 'threads:lily_nail'。client が ThreadsAuthError → collect が reject
  - tokenRefresh（フェイク http と SecretStore）: 成功時に put が新トークンで呼ばれる / HTTP 400 → throw し put は呼ばれない（Review Focus 1）
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3:** 実装
- [ ] **Step 4:** PASS を確認
- [ ] **Step 5:** コミット `feat: threads keyword search source`

---

### Task 8: HPB 掲載判定

**Files:**
- Create: `backend/src/hpb/parse.ts`, `backend/src/hpb/check.ts`
- Create: `backend/test/hpb/fixtures/`（実ページを1回取得して保存した HTML: 該当あり・該当なし）
- Test: `backend/test/hpb/parse.test.ts`, `check.test.ts`

**Interfaces:**
- Consumes: `normalizeName`, `HpbStatus`, `Db`
- Produces:
  ```ts
  interface HpbHit { name: string; address: string; url: string }
  parseSearchResults(html: string): HpbHit[] | null        // 結果リスト要素が見つからない（構造変化）なら null、0件なら []
  matchHit(store: { name: string; city: string|null }, hits: HpbHit[]): HpbHit | null   // similarity 相当: normalizeName 同士の一致 or 包含、かつ city があれば address に含む
  checkHpb(store: { name: string; city: string|null }, http: typeof fetch): Promise<{ status: HpbStatus; url: string|null }>
  checkPendingStores(db: Db, http: typeof fetch, limit = 100): Promise<number>   // hpb_status='unchecked' を検査し更新
  ```
- 検索URL: HPB のフリーワード検索ページ（実装前にブラウザで実際の検索URLとクエリパラメータを確認し、定数 `HPB_SEARCH_URL` に記録する）。HTML パースは `cheerio`
- 判定: hits から match あり → `listed`（url 付き）/ hits が [] or match なし → `not_listed` / fetch 失敗・非200・タイムアウト(10秒)・parse が null → `unknown`
- アクセス間隔 2 秒（直列）。店名が「店名不明」の店は検査せず `unknown`

- [ ] **Step 1:** フィクスチャ HTML を2つ保存（該当あり / なし）
- [ ] **Step 2: 失敗するテスト**
  - parse: 該当ありフィクスチャで1件以上、該当なしで []、`'<html><body>maintenance</body></html>'` で null
  - check（フェイク http）: 500 → unknown / AbortError → unknown / 構造変化 HTML → unknown（Review Focus 4） / 該当ありで店名表記ゆれ（`ネイルサロン Lily` vs ヒット `Nail Salon Lily 立川店`、address に '立川市'）→ listed
- [ ] **Step 3:** FAIL を確認
- [ ] **Step 4:** 実装
- [ ] **Step 5:** PASS を確認
- [ ] **Step 6:** コミット `feat: hot pepper beauty listing check`

---

### Task 9: パイプライン・ハンドラ（collect / process / hpb）

**Files:**
- Create: `backend/src/handlers/collect.ts`, `process.ts`, `hpb.ts`, `backend/src/handlers/context.ts`
- Test: `backend/test/handlers/process.test.ts`, `collect.test.ts`

**Interfaces:**
- Consumes: `getSource`, `ingestRawItems`, `classifyItem`, `resolveStore`, `checkPendingStores`, `ssmSecretStore`, `createDb`
- Produces（Lambda ハンドラ。Step Functions から呼ばれる）:
  ```ts
  // collect.ts
  listShardsHandler(e: { sources: SourceId[] }): Promise<{ tasks: { source: SourceId; shard: string }[] }>   // ENABLED_SOURCES との積集合
  collectHandler(e: { source: SourceId; shard: string }): Promise<{ inserted: number; skipped: number }>
  // process.ts
  processPending(db: Db, llm: LlmClassifier, limit = 500): Promise<{ resolved: number; rejected: number; retried: number }>
  processHandler(): Promise<ReturnType<typeof processPending>>
  // hpb.ts
  hpbHandler(): Promise<{ checked: number }>
  // context.ts
  buildContext(): Promise<SourceContext & { llm: LlmClassifier }>   // SSM から秘密を読み、DB 接続は Lambda コンテナで使い回す
  ```
- `processPending`: status='pending' を fetched_at 順に limit 件
  - preclassified あり → classification = preclassified、confidence 'map'
  - なし → `classifyItem`。例外時は attempts+1 して pending のまま（retried）。attempts が3に達したら classification = `{verdict:'maybe', reason:'判定失敗', 他 null}`
  - verdict 'no' → status 'rejected'（classification 保存、行は残す）
  - yes/maybe → `resolveStore`（snsHandle = authorHandle、placeId = place_id、confidence = verdict）→ status 'resolved'

- [ ] **Step 1: 失敗するテスト** `process.test.ts`（実DB＋フェイク LLM）:
  - Map 由来 raw item → store 作成、confidence 'map'、LLM 呼ばれない
  - LLM が no → rejected、stores 0件、raw_items 行は残る
  - LLM が3回連続 throw → 1・2回目の run は retried、3回目の run で store が confidence 'maybe'・evidence.reason '判定失敗'（Review Focus 3）
  - Map と Threads の同一店（Task 4 のケース）を順に処理 → stores 1件 evidence 2件
  `collect.test.ts`: `listShardsHandler({sources:['google_maps','threads']})` を `SOURCES_DISABLED=threads` で呼ぶと google_maps の6シャードのみ
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3:** 実装
- [ ] **Step 4:** PASS を確認
- [ ] **Step 5:** コミット `feat: pipeline handlers`

---

### Task 10: メール通知

**Files:**
- Create: `backend/src/notify/compose.ts`, `backend/src/notify/send.ts`, `backend/src/handlers/notify.ts`
- Test: `backend/test/notify/compose.test.ts`, `backend/test/handlers/notify.test.ts`

**Interfaces:**
- Consumes: `Db`, stores/evidence テーブル
- Produces:
  ```ts
  interface LeadForMail { name: string; genreLabel: string; city: string|null; confidence: Confidence; openingDate: string|null; evidenceUrls: string[]; signals: string[] }
  composeDigest(main: LeadForMail[], maybeCount: number, uiUrl: string): { subject: string; body: string } | null   // main も maybe も0なら null
  notifyHandler(): Promise<{ sent: boolean; main: number; maybe: number }>
  ```
- 対象: `notified_at IS NULL AND hpb_status <> 'listed'`。main = confidence in ('yes','map')、maybe = 'maybe'。送信後、対象全件の notified_at を now に更新（listed は通知対象外のまま notified_at を付ける）
- 件名: `【新店検出】${main}件` ＋ maybe>0 なら ` (要確認 ${maybe}件)`
- 本文1件: `・${name}【${genreLabel} / ${city ?? 'エリア不明'}】` ＋ FUTURE_OPENING なら ` 🔜オープン予定` ＋ 改行 ＋ 開業日（あれば）＋ 根拠URLを1行ずつ。末尾に UI URL。連絡先は含めない
- 宛先: env `NOTIFY_TO`（カンマ区切り）、送信元 env `NOTIFY_FROM`。SES v2 SendEmail

- [ ] **Step 1: 失敗するテスト**
  - compose: main 0・maybe 0 → null / main 2・maybe 3 → subject `【新店検出】2件 (要確認 3件)`、本文に根拠URLが全部入る、maybe の店名は本文に入らない
  - handler（実DB＋フェイク送信）: listed の店は本文に含まれず notified_at は付く / 2回目の実行では送信しない（sent false）
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3:** 実装（SES クライアントは注入可能にする）
- [ ] **Step 4:** PASS を確認
- [ ] **Step 5:** コミット `feat: daily email digest`

---

### Task 11: v3 台帳の取り込み CLI

**Files:**
- Create: `backend/src/cli/importV3.ts`
- Test: `backend/test/cli/importV3.test.ts`

**Interfaces:**
- Produces: `importKnownPlaces(db: Db, csv: string): Promise<{ inserted: number }>`、CLI `npm -w backend run import-v3 -- <known_places.csv>`
- v3 `known_places` シートを CSV でエクスポートしたもの（ヘッダー `place_id,first_seen`）を `places_seen` に `is_lead_candidate=false, details_fetched=true` で insert（ON CONFLICT DO NOTHING）。genre は 'unknown'

- [ ] **Step 1: 失敗するテスト**: ヘッダー＋2行（うち1行は既存）→ inserted 1、空行は無視
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3:** 実装
- [ ] **Step 4:** PASS を確認
- [ ] **Step 5:** コミット `feat: import v3 known places`

---

### Task 12: API Lambda と Web UI

**Files:**
- Create: `backend/src/handlers/api.ts`, `web/*`（File Structure 参照）
- Test: `backend/test/handlers/api.test.ts`, `web/test/LeadTable.test.tsx`
- Create: `web/src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `Db`、Cognito の JWT（API Gateway JWT オーソライザーで検証済み。ハンドラは claims を見ない）
- Produces:
  - `GET /leads?tab=main|maybe&genre=&city=&source=&hpb=&days=`（days 既定 7）→
    ```ts
    { leads: { id: number; name: string; genre: Genre|null; city: string|null; confidence: Confidence;
               sources: SourceId[]; evidence: { source: SourceId; url: string; reason: string }[];
               openingDate: string|null; hpbStatus: HpbStatus; hpbUrl: string|null; firstSeenAt: string }[] }
    ```
    tab=main → confidence in (yes, map)、maybe → maybe。`hpb` 未指定時は listed を除外、`hpb=all` で含める。first_seen_at 降順
  - `listLeads(db: Db, q: LeadQuery)`（ハンドラと分離してテスト）
  - `GET /settings/threads-queries` → `{ queries: string[]; source: 'default'|'custom'; perDay: number; quota: 2200 }` / `PUT /settings/threads-queries` body `{ queries: string[] }` → 200 で GET と同形、検証 NG は 400 `{ error }` / `DELETE /settings/threads-queries` → 既定に戻す。updatedBy は JWT の `email` claim（API Gateway が渡す `requestContext.authorizer.jwt.claims`）
  - Web: `/` に一覧（タブ「新店」「要確認」、絞り込み: ジャンル・市・媒体・HPB・期間）、各行に根拠URLリンク（媒体名ラベル付き）、HPB バッジ（listed=掲載あり / not_listed=未掲載 / unknown=判定不能 / unchecked=未チェック）、FUTURE_OPENING バッジ。`/settings` に Threads 検索ワード編集（1行1ワードのテキストエリア、「1日あたり N / 2,200 クエリ」の表示、保存・既定に戻すボタン、400 のエラーメッセージ表示）。`/callback` で Cognito Hosted UI（PKCE, `oidc-client-ts`）から戻る。トークンは sessionStorage
  - web の環境変数（ビルド時）: `NEXT_PUBLIC_API_URL` `NEXT_PUBLIC_COGNITO_AUTHORITY` `NEXT_PUBLIC_COGNITO_CLIENT_ID` `NEXT_PUBLIC_REDIRECT_URI`

- [ ] **Step 1: 失敗するテスト**
  - api（実DB）: yes/map/maybe/listed の4店を用意 → tab=main で yes と map の2件（listed は除外）、tab=maybe で1件、`hpb=all` で listed も出る、evidence が各店に配列で付く
  - api（実DB）: PUT で551件 → 400、正常な PUT 後の GET が `source:'custom'`、DELETE 後は `'default'`
  - web（Vitest + Testing Library）: LeadTable に evidence 2件の lead を渡すと2つのリンクが `target=_blank` で出る / hpbStatus unknown で「判定不能」バッジ
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3:** 実装（Next.js `output: 'export'`、UI は素の CSS で可。v3 `index.html` の見た目を参考にしてよい）
- [ ] **Step 4:** PASS を確認、`npm -w web run build` が `web/out` を出力
- [ ] **Step 5:** コミット `feat: leads api and web ui`

---

### Task 13: インフラ（CDK）

**Files:**
- Create: `infra/package.json`, `infra/cdk.json`, `infra/bin/app.ts`, `infra/lib/salonWatcherStack.ts`
- Test: `infra/test/stack.test.ts`

**Interfaces:**
- Consumes: Task 9/10/12 のハンドラのエントリポイント（`NodejsFunction` の entry）、`web/out`
- Produces（1スタック `SalonWatcherStack`）:
  - Lambda（Node.js 22, arm64）: listShards / collect（timeout 15分, memory 1024）/ process（15分）/ hpb（15分）/ notify / refreshThreadsToken / api。共通 env: `SSM_PREFIX=/salon-watcher/`、SSM 読み取り権限、refreshThreadsToken のみ `THREADS_ACCESS_TOKEN` の PutParameter 権限
  - Step Functions `Pipeline`: listShards → Map(maxConcurrency 6, collect, 各要素失敗は Catch して続行し結果に記録) → process → hpb。Map 内でいずれかが失敗した場合は最後に Fail 状態へ（hpb までは実行する）
  - EventBridge Scheduler（timezone Asia/Tokyo）: `cron(0 0,6,12,18 * * ? *)` → Pipeline `{sources:['threads']}` / `cron(0 5 * * ? *)` → Pipeline `{sources:['google_maps']}` / `cron(0 7 * * ? *)` → notify / `cron(0 4 ? * MON *)` → refreshThreadsToken
  - CloudWatch アラーム: Pipeline の ExecutionsFailed ≥ 1、refreshThreadsToken の Errors ≥ 1 → SNS トピック → オーナーのメール購読（context `ownerEmail`）
  - Cognito User Pool（セルフサインアップ無効）＋ Hosted UI ドメイン＋ App Client（PKCE、callback = CloudFront URL `/callback`）
  - HTTP API（JWT オーソライザー = User Pool）`GET /leads`・`GET|PUT|DELETE /settings/threads-queries` → api Lambda、CORS は CloudFront ドメインのみ
  - S3（非公開）＋ CloudFront（OAC）で `web/out` を配信（`BucketDeployment`）
  - SES: 送信元アドレスの EmailIdentity（context `notifyFrom`）
  - context 値: `ownerEmail` `notifyFrom` `notifyTo` `cognitoDomainPrefix`

- [ ] **Step 1: 失敗するテスト** `stack.test.ts`（`aws-cdk-lib/assertions`）: Scheduler のスケジュールが4つで式が上記と一致、すべて `ScheduleExpressionTimezone: 'Asia/Tokyo'` / StateMachine が1つ / Cognito `AllowAdminCreateUserOnly: true` / CloudWatch Alarm 2つ
- [ ] **Step 2:** FAIL を確認
- [ ] **Step 3:** 実装
- [ ] **Step 4:** PASS、`npx cdk synth` が成功
- [ ] **Step 5:** コミット `feat: cdk stack`

---

### Task 14: デプロイと実地確認（オーナー同席）

外部アカウント操作を含むため、各手順はオーナーの確認を取ってから実行する。

- [ ] **Step 1:** Neon でプロジェクト作成、接続文字列を SSM `/salon-watcher/DATABASE_URL` に登録、`npx drizzle-kit migrate` を本番に適用
- [ ] **Step 2:** SSM に `PLACES_API_KEY`（v3 と同じキーで可）、`ANTHROPIC_API_KEY`、`THREADS_ACCESS_TOKEN`（Meta 開発者アプリで長期トークンを発行）を登録
- [ ] **Step 3:** Meta 開発者アプリで `threads_keyword_search` の App Review を申請（承認まで Threads は自分の投稿しか検索できない。承認前は `SOURCES_DISABLED=threads` にしておく）
- [ ] **Step 4:** `npx cdk deploy -c ownerEmail=... -c notifyFrom=... -c notifyTo=... -c cognitoDomainPrefix=...`。SES がサンドボックスなら宛先アドレスも検証する
- [ ] **Step 5:** Cognito にオーナーとユーザー（友人）を管理者作成
- [ ] **Step 6:** v3 の `known_places` を CSV エクスポートし `import-v3` を本番 DB に実行
- [ ] **Step 7:** Pipeline を `{sources:['google_maps']}` で手動実行 → 初回はシードのみでリード0件、`map_cells` 全行 seeded=true を確認。所要時間と Places リクエスト数（CloudWatch Logs の `queried` 合計）を記録
- [ ] **Step 8:** 翌日の自動実行後、UI にログインしてリードが表示されること、7時にメールが届くこと（新規0なら届かないこと）を確認
- [ ] **Step 9:** 結果（初回スイープ時間・リクエスト数・初週のリード件数）を設計書 §10 に追記してコミット `docs: phase1 rollout notes`
