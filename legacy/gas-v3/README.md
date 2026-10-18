# 新店サロンウォッチャー 設計書兼仕様書

| 項目 | 内容 |
|---|---|
| ドキュメントバージョン | v3.2 |
| 最終更新日 | 2026-07-06 |
| 対象システム | 新店サロンウォッチャー(GAS製 PoC) |
| 構成ファイル | `code.gs`(バッチ+API)/ `index.html`(ダッシュボードUI) |
| 実行基盤 | Google Apps Script(スプレッドシート紐付き)|

本書は2部構成です。**第1部は利用者向け**(専門知識不要)、**第2部は開発者向け**(保守・拡張のための技術仕様)です。

---

# 第1部 利用者向けガイド

## 1. このツールは何をするもの?

主要5駅の周辺で **新しくオープンした美容・健康系の店舗** を自動で見つけてリストにするツールです。特に **ホットペッパービューティー(HPB)にまだ載っていない店** を見つけることを目的にしています。

- **対象エリア**: 国分寺 / 立川 / 八王子 / 府中 / 調布(近隣の分倍河原・西国分寺などは各駅エリアに含めて検索)
- **対象ジャンル**: ネイルサロン / アイサロン / リラクゼーション / エステ / 整体 / 接骨院 / ジム・ピラティス
  - ※ ヘアサロンは社内に既存ツールがあるため対象外

## 2. 仕組み(かんたん版)

毎朝7時に、Googleマップを自動でくまなく検索します。**昨日までは無かったのに今日現れた店 = 新店** とみなして記録します。

大事なポイントが1つあります。ここでいう「新店」は **「Googleマップに新しく登録され、このツールが初めて見つけた店」** のことです。実際のオープン日そのものではありません(最近の新店はオープン前後にマップ登録するので、大きくはズレません)。マップに開業日が登録されている店だけは「開業日」欄に正確な日付が表示されます。

また、明らかに古くからある店を新店と誤検出しないよう、**口コミが多すぎる店(既定31件以上)や、閉業している店は自動的に除外**しています。

## 3. 画面の見方

ダッシュボード(WebアプリのURL)を開くと、画面上部に2つのタブがあります。

### タブ1「新店リスト」

**前日と当日に見つかった新店** が一覧表示されます。

| 画面の要素 | 意味 |
|---|---|
| 前日・当日の新店 | 昨日の0時以降に見つかった新店の件数 |
| うちHPB未掲載 | そのうちホットペッパービューティーに載っていない店の数(営業対象の候補)|
| 「すべて / HPB未掲載のみ」ボタン | 表の絞り込み切り替え |
| 店舗名 | クリックするとGoogleマップが開きます |
| ジャンル | どの検索ジャンルで見つかったか |
| エリア | 最寄りの検索駅と市 |
| サイトURL | 店の公式サイト(登録がなければ「—」)|
| 開業日 | マップに登録があれば表示(なければ「—」)|
| 口コミ | 口コミ件数。**0件は開店直後の有力サインとして赤字表示** |
| HPB | 掲載状況バッジ(下記参照)|
| 検出時刻 | このツールが見つけた日時 |

**HPBバッジの意味**

- **HPB未掲載**(ピンク): ホットペッパービューティーで見つからなかった店。営業候補
- **HPB掲載あり**(緑): すでに掲載されている店
- **未チェック**(グレー): チェック処理をスキップした店(1日の確認上限に達した場合など)

### タブ2「スイープログ」

直近の検索が **エリア×ジャンルごとに何件拾えたか** を確認できる画面です。検索精度のチューニングに使います(詳しくは第2部)。

- **飽和**(ピンク): 60件の取得上限に達したエリア×ジャンル。取りこぼしの可能性があり、要調整
- **過少**(グレー): 20件以下。検索の深さを浅くしてもよい余地あり
- **適正**(緑): その中間

## 4. 日々の使い方

基本は **何もしなくてOK** です。毎朝7時に自動実行され、HPB未掲載の新店が見つかった日だけメールが届きます。メールが来たらダッシュボードを開いて詳細を確認してください。

画面上部には「最終自動実行」(毎朝7時のトリガー分)と「最終手動実行」(ボタンを押した分)の2つの時刻が表示されます。自動実行が動いているかはここで確認できます。

**表示が古いと感じたら**: このダッシュボードは開いた時点のデータを表示します。最新にするには**ブラウザの再読み込み**をしてください。

**「今すぐ実行」ボタンについて**: 待たずに最新をチェックしたいときに使えますが、1回押すごとにGoogleの無料利用枠を消費します。**1日1〜2回まで** を目安にしてください。

## 5. よくある質問

**Q. 明らかに前からある店が「新店」として出てくる**
運用開始直後の数日はこれが起こります(初期登録の取りこぼしが後から見つかるため)。一度リストに出た店は二度と出ないので、無視していれば数日で収まります。

**Q. 「◯件は翌日処理」と表示された**
一度に処理できる新店の上限(30件)を超えたサインです。あふれた分は翌日の実行で自動的に処理されるので、何もする必要はありません。

**Q. known_placesは増えているのに新店リストが0件**
台帳(known_places)には市外・閉業・口コミ多数の店も一度は登録されます。それらは新店リストには出ないため、台帳だけ増えて新店0件は正常な状態です。

**Q. 開業日や口コミがほとんど「—」になっている**
Googleマップに情報が登録されていない店では空欄になります。正常です。

**Q. メールが来ない日がある**
HPB未掲載の新店が0件だった日はメールを送りません(正常動作です)。

---

# 第2部 開発者向け仕様

## 1. システム構成

```
[時間トリガー 毎朝7時] ─┐
[Webアプリ 手動実行]   ─┴─> runBatch()
                             │
                             ├─ [1段階目] Places API Text Search (IDs Only)
                             │     5エリア(全13セル)× 7ジャンル × 複数ページ を
                             │     fetchAll 並列実行、距離順(DISTANCE)で取得
                             │     → place_id の集合 + スイープ統計を取得
                             │
                             ├─ 差分検出: known_places シートに無い id = 新規候補
                             │
                             ├─ [2段階目] Places API Place Details (新規候補のみ・上限30件/回)
                             │     → 店名 / 住所 / サイトURL / マップURL / 開業日
                             │       / 営業状態 / 口コミ数
                             │
                             ├─ 除外判定: 閉業(CLOSED_PERMANENTLY) / 市外 / 口コミ超過
                             ├─ Custom Search API で HPB 掲載チェック
                             │
                             ├─ known_places / new_stores / sweep_stats へ書き込み
                             └─ HPB未掲載があれば MailApp でメール通知

[doGet] ─> index.html ─ google.script.run ─> getRecentStores()
                                            ├─ getSweepStats()
                                            └─ runBatchManual()
```

2段階取得の目的はコスト最適化。スイープ(大量リクエスト)を最安SKUに落とし、高額SKUとなる詳細取得を新規分(少数)に限定する。

## 2. 検索エリア設計(セル分割)

### 2.1 なぜセル分割か

Text Search は1クエリ(1つの locationRestriction × 1ジャンル)が返す件数に上限がある。この上限を回避する唯一の手段が、検索範囲を小さなセルに分割し、セルごとに上限枠を使うこと。広い矩形1つでは上限で頭打ちになり、密集エリアの無名店(=新店)を取りこぼす。

**エリア = 記録・表示上の単位(駅名)。セル = 実際の検索単位(小さな矩形)。** 1エリアは複数セルを持ち、近接駅圏は同一エリアに吸収している(分倍河原→府中、西国分寺→国分寺)。

### 2.2 現在のセル構成(全13セル)

| エリア | セル数 | 各セル半径 | カバー概要 |
|---|---|---|---|
| 立川 | 4 | 1100m | 駅を囲む北西・北東・南西・南東 |
| 八王子 | 3 | 1100〜1200m | 中心街・西(追分)・南 |
| 調布 | 2 | 1100〜1200m | 駅周辺・布田国領方面 |
| 府中 | 2 | 1100〜1200m | 駅周辺・分倍河原方面 |
| 国分寺 | 2 | 1100〜1200m | 駅周辺・西国分寺方面 |

セルの矩形は中心座標 ± radius をメートル→度換算して生成(緯度: r/111320、経度: r/(111320·cos(lat)))。セル同士は意図的に一部重複させ、境界の穴を防いでいる(重複店舗は place_id で排除)。

### 2.3 「60件上限」に関する重要な注意(未確定事項)

- **ページあたり最大20件**は公式ドキュメントで確認済み(`pageSize` の上限)。
- **「最大3ページ=合計60件」はレガシー版(旧 Text Search)の制限**。New版(`places:searchText`)のドキュメントには **ページ数の固定上限が明記されていない**。`nextPageToken` が続く限り3ページ超も取得できる可能性がある。
- 現状コードは `maxPagesPerQuery: 3` で運用しているが、これは安全側の暫定値であり、New版の真の打ち止め点は **実測で確認すべき**。飽和セルで `maxPagesPerQuery` を一時的に上げてページ数と累計件数をログ確認するのが確実。
- スイープログ(第2部6章)の「飽和」判定は、この暫定3ページ上限を前提にしている点に留意。
- ページング仕様の最新の記述は3章の参考URL(Text Search / Place Details)で確認すること。

## 3. 外部API仕様

> **⚠️ 本章の記載内容と参考URLに関する注記**
> 以下のAPI仕様・パラメータ名・SKU区分・無料枠は、本ドキュメント作成時点の理解に基づく。**Google/各社のAPIは仕様改定が頻繁**であり、記載内容が最新と異なる場合がある。特に SKU区分・無料枠・ページング上限(2.3参照)は変更されやすい。**実装・改修時は必ず下記の公式ドキュメントで最新仕様を確認すること。** 参考URLも移転・改称されている可能性があるため、リンク切れの場合は各サービス名で再検索すること。

### 参考ドキュメントURL(要・最新確認)

| API | 公式ドキュメント(参考)|
|---|---|
| Places API Text Search (New) | https://developers.google.com/maps/documentation/places/web-service/text-search |
| Places API Place Details (New) | https://developers.google.com/maps/documentation/places/web-service/place-details |
| Places API 料金・SKU | https://developers.google.com/maps/documentation/places/web-service/usage-and-billing |
| Places API データフィールド(FieldMask)| https://developers.google.com/maps/documentation/places/web-service/place-data-fields |
| Custom Search JSON API | https://developers.google.com/custom-search/v1/overview |
| Custom Search API リファレンス | https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list |
| プログラム可能な検索エンジン(管理)| https://programmablesearchengine.google.com/ |
| GAS UrlFetchApp | https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app |
| GAS 実行時間などの制限(Quotas)| https://developers.google.com/apps-script/guides/services/quotas |

### 3.1 Places API Text Search (New) — スイープ用

| 項目 | 値 |
|---|---|
| エンドポイント | `POST https://places.googleapis.com/v1/places:searchText` |
| 認証 | ヘッダー `X-Goog-Api-Key`(スクリプトプロパティ `PLACES_API_KEY`)|
| FieldMask | `places.id,nextPageToken` **(厳守。フィールド追加でSKUが昇格する)** |
| 課金SKU | Text Search **(IDs Only)** = Essentialsカテゴリ |
| ボディ主要項目 | `textQuery`(ジャンル検索語), `languageCode: "ja"`, `pageSize: 20`, `rankPreference: "DISTANCE"`, `locationRestriction.rectangle`, `pageToken`(2ページ目以降)|
| 任意項目 | `includedType` + `strictTypeFiltering: true`(ジャンルに `includedType` を設定した場合のみ付与)|
| ページング | `nextPageToken` を同一パラメータで再送。現状 `maxPagesPerQuery`(既定3)で打ち切り |
| 並列化 | `UrlFetchApp.fetchAll` を40件ずつのチャンクで実行(GAS 6分制限対策)|

**`rankPreference: DISTANCE` の意図**: 既定の関連度順は人気店優先のため、口コミの無い新店が上限枠から押し出される。距離順にすればセル中心から近い順に列挙され、セル内該当店が上限以下なら全件取得できる。ただし飽和セルでは「セル中心から遠い店」が切り捨てられるため、セルの縁の店が不利になる副作用がある。

### 3.2 Places API Place Details (New) — 詳細取得用

| 項目 | 値 |
|---|---|
| エンドポイント | `GET https://places.googleapis.com/v1/places/{place_id}` |
| FieldMask(第1候補)| `id,displayName,formattedAddress,websiteUri,googleMapsUri,businessStatus,userRatingCount,openingDate` |
| FieldMask(フォールバック)| 上記から `openingDate` を除いたもの(400応答時に自動リトライ)|
| 課金SKU | `websiteUri` を含むため **Enterprise**(最上位)。`businessStatus`/`userRatingCount`/`openingDate` は同一SKU内のため追加コストなし |
| 呼び出し条件 | 新規候補のみ。1実行あたり `maxDetailsPerRun`(既定30)件まで |
| 持ち越し仕様 | 上限超過分・取得失敗分は **台帳未登録のまま** にして翌日再処理させる |

`openingDate` は `{year, month, day}` を `YYYY-MM-DD` に整形。`userRatingCount` は数値、欠落時は0扱い。

### 3.3 Custom Search JSON API — HPB掲載チェック用

| 項目 | 値 |
|---|---|
| エンドポイント | `GET https://www.googleapis.com/customsearch/v1` |
| パラメータ | `key`(CSE_API_KEY), `cx`(CSE_CX), `num=1`, `q="店名"` |
| 検索エンジン設定 | **エンジン側で `beauty.hotpepper.jp/*` に限定済み**。クエリに `site:` 演算子は付けない |
| 判定 | `searchInformation.totalResults > 0` → `HPB掲載あり`、0 → `HPB未掲載`、APIエラー/キー未設定 → `未チェック` |
| 無料枠 | 100クエリ/日。`maxHpbChecksPerRun`(既定80)で保護 |

**既知の限界**: 店名の完全一致検索のため、HPB上の登録名が異なる店は誤って「未掲載」と判定されうる。精度が問題になったら店名正規化を検討。

## 4. シート仕様

スプレッドシートに3シート。存在しなければ `getOrCreateSheet_` が自動生成する。**列構成の変更時はマイグレーション機構が無い**ため、手動でヘッダー追記またはシート削除→再seedが必要。

### 4.1 `known_places`(既知店舗台帳)

| 列 | 名前 | 型 | 説明 |
|---|---|---|---|
| A | `place_id` | string | Google Placesの一意ID。差分検出のキー |
| B | `first_seen` | Date | 台帳に登録した日時 |

- 追記のみ。この台帳に **無い** IDが新規候補となる
- 通常実行では、詳細取得に成功したIDを **市内外・閉業・口コミ数を問わず** 登録する(二度と処理しないため)
- 台帳が空の状態で `runBatch` が呼ばれた場合は自動的にシーディングモードへフォールバック

### 4.2 `new_stores`(新規検出ログ)

| 列 | 名前 | 型 | 由来 | 説明 |
|---|---|---|---|---|
| A | `detected_at` | Date | 実行時刻 | 検出日時。UIの前日/当日フィルタのキー |
| B | `name` | string | Details `displayName.text` | 店舗名 |
| C | `genre` | string | CONFIG.genres.label | 最初にヒットした検索ジャンル |
| D | `area` | string | CONFIG.areas.name | 最初にヒットした検索エリア(駅)|
| E | `city` | string | 住所から正規表現抽出 | `東京都(.+?[市区])` の捕捉値 |
| F | `address` | string | Details `formattedAddress` | 住所全文 |
| G | `website` | string | Details `websiteUri` | 公式サイトURL |
| H | `maps_url` | string | Details `googleMapsUri` | Googleマップリンク |
| I | `opening_date` | string | Details `openingDate` | `YYYY-MM-DD`(無ければ空)|
| J | `hpb_status` | string | Custom Search判定 | `HPB未掲載`/`HPB掲載あり`/`未チェック` |
| K | `review_count` | number | Details `userRatingCount` | 口コミ件数 |

- **記録されない条件**: 閉業(`CLOSED_PERMANENTLY`)/ 市外(`cityFilter`不一致)/ 口コミ数が `maxReviewCountForNew` 超過。いずれも台帳には登録されるがこのシートには残さない
- `genre`/`area` は重複排除時の「最初にヒットした組み合わせ」の代表値1つのみ
- 全履歴が蓄積される。行数が数万を超えたら年次アーカイブを検討

### 4.3 `sweep_stats`(直近スイープ統計・毎回上書き)

| 列 | 名前 | 型 | 説明 |
|---|---|---|---|
| A | `ran_at` | Date | スイープ実行時刻 |
| B | `area` | string | エリア名 |
| C | `genre` | string | ジャンル名 |
| D | `count` | number | エリア内全セル合算の取得件数 |
| E | `pages_used` | number | 使用した最大ページ数 |
| F | `cells` | number | このエリアのセル数 |
| G | `saturated_cells` | number | 飽和(最終ページまで満杯)したセル数 |
| H | `status` | string | `saturated`(飽和セルあり)/ `low`(count≤20)/ `ok` |

- **毎実行でヘッダー以外をクリアして最新1回分だけ保持**(履歴は残さない仕様)
- 飽和判定: 「最終ページ(maxPagesPerQuery目)まで取得し、かつ最終ページも20件満杯」または「最終ページ時点でまだ `nextPageToken` を保持」のセルをカウント

## 5. 設定仕様(CONFIG / スクリプトプロパティ / トリガー)

### 5.1 CONFIG(code.gs 冒頭)

| キー | 既定値 | 影響 |
|---|---|---|
| `areas` | 5エリア(各 name + cells[])| 検索範囲。cellは`{lat,lng,radius}` |
| `genres` | 7ジャンル(label + query + 任意 includedType)| queryがAPI検索語、labelが記録名。includedTypeで厳密化(既定は全てコメントアウト)|
| `cityFilter` | 5市 | 詳細取得後の住所フィルタ。空配列で無効化 |
| `maxReviewCountForNew` | 30 | この値を超える口コミ数の店を既存店とみなし記録除外。-1で無効化 |
| `maxPagesPerQuery` | 3 | ページ打ち切り数。真の上限は要実測(2.3参照)|
| `maxDetailsPerRun` | 30 | Details(Enterprise SKU)の安全弁。超過分は翌日持ち越し |
| `maxHpbChecksPerRun` | 80 | CSE無料枠(100/日)の安全弁 |
| `fetchChunkSize` | 40 | fetchAll同時実行数。エラー多発時は下げる |

### 5.2 スクリプトプロパティ

| キー | 必須 | 内容 |
|---|---|---|
| `PLACES_API_KEY` | ○ | Places API (New) を有効化したAPIキー |
| `CSE_API_KEY` | ○ | Custom Search API のAPIキー |
| `CSE_CX` | ○ | HPB限定のプログラム可能な検索エンジンID |
| `NOTIFY_EMAIL` | — | 通知先。未設定時は実行者のアカウント宛 |
| `LAST_RUN` | (自動)| **手動実行**時刻。UIの「最終手動実行」表示用 |
| `LAST_RUN_AUTO` | (自動)| 自動・手動を問わない**最終実行**時刻。UIの「最終自動実行」表示用 |

### 5.3 トリガー / 実行系関数

| 関数 | 用途 |
|---|---|
| `runBatch()` | 本番実行(トリガー・手動共通)。実行時に `LAST_RUN_AUTO` を更新 |
| `runBatchManual()` | UIからの手動実行。`runBatch` を呼び、加えて `LAST_RUN` を更新 |
| `seedBaseline()` | 初期台帳作成。**導入時・検索条件変更時に3〜4回実行**。通知・詳細取得なし |
| `setupTriggers()` | 既存の`runBatch`トリガーを全削除し、毎朝7時(atHour(7))を再登録 |

前提: GASプロジェクトのタイムゾーンは `Asia/Tokyo`(前日/当日判定と7時実行の基準)。

## 6. UI仕様(Webアプリ)

### 6.1 サーバーサイドAPI

| 関数 | 戻り値 | 仕様 |
|---|---|---|
| `doGet()` | HtmlOutput | `index.html` を配信。ファイル名は `index` 固定 |
| `getRecentStores()` | `{stores, lastRun, lastAuto}` | `new_stores` から `detected_at >= 前日0:00` を検出時刻降順で返す |
| `getSweepStats()` | `{rows, ranAt}` | `sweep_stats` の全行を area→genre 順で返す |
| `runBatchManual()` | summaryオブジェクト | `runBatch()` 実行 + `LAST_RUN` 更新 |

**Store オブジェクト**:
```json
{
  "detectedAt": "7/5 07:02", "ts": 1751666520000,
  "name": "...", "genre": "...", "area": "...", "city": "...",
  "address": "...", "website": "...", "mapsUrl": "...",
  "openingDate": "2026-07-01", "hpbStatus": "HPB未掲載",
  "reviewCount": 0
}
```

**SweepStat行オブジェクト**: `{area, genre, count, pagesUsed, cells, saturatedCells, status}`

**summary オブジェクト**: `{ranAt, mode(normal|seeding), sweptCount, newCount, hpbUnlistedCount, deferredCount, seededCount?}`

### 6.2 クライアント(index.html)

- 純HTML/CSS/JS単一ファイル。フレームワーク・ビルド不要。フォントはGoogle Fonts(IBM Plex Sans JP)
- **タブ構成**: 「新店リスト」(`panelStores`)と「スイープログ」(`panelLog`)。スイープログは初回タブ切替時に遅延ロード、手動実行後に再ロード
- データ取得は `google.script.run` のみ。ポーリング・自動更新なし(手動リロードで最新化)
- 状態: `allStores`(全件キャッシュ)、`filter`(all|unlisted)、`statsLoaded`(統計ロード済みフラグ)
- 新店リストの表示ルール:
  - 店舗名は `mapsUrl` があればリンク化、住所をサブテキスト表示
  - `website`/`openingDate`/`genre` が空なら「—」
  - **口コミ0件はアクセント色(赤)で強調**(開店直後のサイン)
  - HPBステータスは3値をバッジ色分け
- スイープログの表示ルール:
  - 状態バッジ: `saturated`→「飽和」(赤)、`low`→「過少」(グレー)、`ok`→「適正」(緑)
  - 取得件数・飽和セル数は飽和時にアクセント色
- ヘッダーに「最終自動実行」「最終手動実行」を併記
- デザイントークンはCSS変数(`:root`)に集約

### 6.3 デプロイ

ウェブアプリとしてデプロイ。**実行ユーザー=自分 / アクセス=Googleアカウントを持つ全員**(個人アカウントでの共有時)。URL自体がアクセス鍵になるため取扱注意。**code.gs/index.html 変更後は「デプロイを管理 > 新バージョン」で再デプロイしないと反映されない**(頻出の落とし穴)。

## 7. コスト設計

### 7.1 課金の仕組み

Google Maps Platformは2025年3月以降、SKU(機能×フィールド階層)ごとに月間無料枠が設定される。**FieldMaskに含めたフィールドの最上位SKUで課金される**ため、フィールドマスク管理が実質的なコスト管理となる。

| 用途 | SKU | 無料枠(月)| 消費目安 |
|---|---|---|---|
| IDスイープ | Text Search (IDs Only) / Essentials | 10,000回 | 約8,190回/月(下記)|
| 詳細取得 | Place Details / Enterprise | 1,000回 | 新店数次第。定常時 数十〜百回/月 |
| HPBチェック | Custom Search JSON API | 100回/**日** | 上限80/実行 |

### 7.2 月間リクエスト試算(スイープ)

```
13セル × 7ジャンル = 91クエリ
91 × 最大3ページ = 273リクエスト/実行
273 × 30日(1日1回) = 8,190リクエスト/月 → 無料枠10,000回の約82%
残余 約1,800回 = 手動実行 月6回程度まで安全
```

**注意**: `maxPagesPerQuery` を上げて実測する場合(2.3参照)、リクエスト数が比例増する。ページを増やして飽和セルを追う検証は消費に留意。

### 7.3 コスト超過の防波堤(多層防御)

1. FieldMaskの最小化(スイープをIDs Onlyに固定)
2. `maxDetailsPerRun`(Enterprise SKUの呼び出し上限+翌日持ち越し)
3. `maxHpbChecksPerRun`(CSE無料枠保護)
4. Google Cloud側の**予算アラート**(少額で設定し、通知が来たら即調査)

### 7.4 スケール時の目安

スイープ試算式: `総セル数 × ジャンル数 × maxPagesPerQuery × 30`。無料枠超過時は (a)ページ数削減、(b)実行隔日化、(c)課金許容 から選択。1セル追加 = 月約630リクエスト増(7ジャンル×3ページ×30)。

## 8. 精度チューニング運用(PDCA)

スイープログを使った継続的改善フロー。

1. **計測**: 数日運用し、スイープログで飽和/過少のエリア×ジャンルを特定
2. **飽和への対処**(優先順):
   - a. 該当ジャンルの `includedType` を有効化(コメントアウト解除)。ジャンル外ノイズを排除。リクエスト数不変
   - b. 無店舗事業者の除去(`includePureServiceAreaBusinesses: false` 相当)※現状未実装、必要時に追加
   - c. それでも飽和 → 該当エリアにセルを追加分割(コスト増)
   - d. New版のページ上限を実測し、`maxPagesPerQuery` 引き上げで解消するか確認(2.3)
3. **過少への対処**: 大半が過少なら `maxPagesPerQuery` を下げてコスト削減
4. **飽和していない組み合わせは触らない**: フィルタ追加は「カテゴリ登録が変な新店」を落とすリスクを伴うため、必要箇所のみ

**ソート順論争について**: 飽和が解消すれば `rankPreference` は結果に影響しなくなる(上限以下なら全件取得のため)。ログで飽和ゼロを確認できれば関連度順への変更も検討可。

## 9. 制約・既知の課題

| 課題 | 内容 | 対応方針 |
|---|---|---|
| 検出≠開業 | 検出日はマップ登録〜検索網ヒットのタイミング | 仕様として許容。openingDate/review_countで補完 |
| ページ上限が未確定 | New版の真のページ打ち止め点が不明(2.3)| 実測で確定させる。現状は安全側の3ページ |
| 距離順の縁落ち | 飽和セルではセル中心から遠い店が切り捨てられる | セルを重複配置して緩和済み。穴が出たらセル追加 |
| seed取りこぼし | 初期台帳の漏れが後日「新店」誤検出 | 導入時seed複数回。数日で自己修復 |
| ジャンル精度 | キーワード検索で隣接業種混入(例:整体にマッサージ)| genres.query調整 or includedType導入 |
| アイサロン取りこぼし | `マツエク` ではアートメイク/眉毛サロンを拾えない | 必要なら `眉毛サロン` 等のジャンル追加(コスト増注意)|
| genre/area単一値 | 複数該当店も最初のヒットのみ記録 | PoCでは許容 |
| HPB判定精度 | 店名完全一致のため表記揺れで誤判定 | 店名正規化で改善余地 |
| 列構成変更 | シートのマイグレーション機構なし | ヘッダー手動追記 or シート削除→再seed |
| 表示の非リアルタイム性 | UIは開いた時点のスナップショット | 手動リロードで最新化 |

## 10. 拡張ガイド

- **エリア/セルの追加**: `CONFIG.areas` に `{name, cells:[{lat,lng,radius}]}` を追加。コスト試算(7.4)を確認
- **ジャンルの追加/厳密化**: `CONFIG.genres` に `{label, query}` 追加、または既存行に `includedType` 付与
- **実行頻度の変更**: `setupTriggers()` の `atHour` を編集。複数回/日は7.2を再計算
- **通知チャネル追加**: `sendNotification_` を差し替え。Slack/DiscordはWebhookへUrlFetchApp。LINEはMessaging API(旧LINE Notifyは2025年3月終了)
- **表示期間の変更**: `getRecentStores()` の `from` 計算を変更
- **スイープ統計の履歴化**: 現状は毎回上書き。追記式にすれば推移分析が可能(シート肥大に注意)
- **Instagram対応**: 公式APIの制約(ビジネスアカウント必須・ハッシュタグ検索 週30個)により自動化は非推奨。検出店舗名からInstagram検索URLを生成し手動確認導線を作るのが現実解

## 11. 変更履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-07 | 初版。西東京市、7時/19時2回実行、1段階取得、1週間表示 |
| v2.0 | 2026-07 | 多摩13駅×8ジャンル。2段階取得(IDs Onlyスイープ+Details)、毎朝7時1回、前日/当日表示、ジャンル・エリア・開業日カラム追加、fetchAll並列化、翌日持ち越し |
| v3.0 | 2026-07 | 主要5駅×7ジャンルへ再編。ヘアサロン除外。セル分割方式導入、cityFilter5市化 |
| v3.1 | 2026-07 | 距離順(DISTANCE)化、閉業店除外、口コミ数取得+閾値フィルタ(review_count列追加)|
| v3.2 | 2026-07 | スイープ統計(sweep_stats)+スイープログUIタブ追加、ジャンル別includedType対応、自動/手動の実行時刻を分離表示。60件上限の未確定事項を明記 |