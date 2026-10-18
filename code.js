/**
 * ============================================================
 *  新店サロンウォッチャー v3.1 (PoC)
 *
 *  対象: 主要5駅 (国分寺 / 立川 / 八王子 / 府中 / 調布) × 7ジャンル
 *  実行: 1日1回 (毎朝7時) + Webアプリから手動実行
 *
 *  v3.1の変更点 (セルあたり60件枠の精度向上):
 *   - スイープを距離順 (rankPreference: DISTANCE) に変更。
 *     関連度順は人気店優先で新店が押し出されるため、距離順にして
 *     セル内をほぼ全件列挙する (セル内該当店が60件以下なら網羅)
 *   - 詳細取得に businessStatus / userRatingCount を追加 (同一SKUのため
 *     コスト増なし)。閉業店 (CLOSED_PERMANENTLY) を記録から除外
 *   - 口コミ数が maxReviewCountForNew を超える「新規検出」は
 *     seed取りこぼしの既存店とみなして記録から除外し、口コミ数を
 *     new_stores のK列 (review_count) に記録
 *   ※ 適用後は必ず seedBaseline を3〜4回再実行すること
 *     (並び順の変更で今まで拾えていなかった既存店が大量に出現するため)
 *
 *  v3の設計思想: 「セル分割」による精度向上
 *   Text Search は1クエリ最大60件しか返さないため、広い矩形1つより
 *   小さな矩形(セル)を複数並べた方が取りこぼしが減る。
 *   v2の13駅×8ジャンル分の予算を、5駅の細分化(13セル×7ジャンル)に
 *   再配分している。近接駅圏は同一エリアグループに吸収
 *   (分倍河原→府中、西国分寺→国分寺 など)。
 *
 *  コスト試算: 13セル × 7ジャンル × 最大3ページ × 30日 ≈ 8,190req/月
 *   (Text Search IDs Only の無料枠 10,000/月 に対し 約1,800 の余裕
 *    = 手動実行 月6回程度まで安全)
 * ============================================================
 *
 * 【v2からの移行手順】
 * 1. コードを全文置き換え (シートの列構成は変更なし。シート削除は不要)
 * 2. seedBaseline() を3〜4回実行
 *    ※ 必須。検索範囲が変わり、新たにカバーされる場所の既存店を
 *      台帳に取り込まないと、翌日以降「新店」として誤検出される
 * 3. デプロイ > デプロイを管理 > 新バージョンで再デプロイ
 *    (トリガーは変更なし。setupTriggers の再実行は不要)
 *
 * 【スクリプト プロパティ】
 *   PLACES_API_KEY (必須) / NOTIFY_EMAIL (任意)
 *   ※ CSE_API_KEY / CSE_CX は廃止。Custom Search JSON API は新規プロジェクトでは
 *     利用不可 (Googleが新規顧客受付を終了) のため、HPB掲載は「HPBで検索」リンクによる
 *     手動確認方式に変更した。旧プロパティは削除してよい。
 */

// ---------------- 設定 ----------------
const CONFIG = {
  // エリアグループ。name が記録・表示に使われる「エリア」名。
  // cells は検索セル (小さい矩形ほど60件上限の取りこぼしが減る)
  areas: [
    {
      name: '立川',
      // 中心コアに集中。周辺の低密度セル(旧1,2,3,4,9,10=公園/川/住宅)は削除。
      //   中央南(旧7,8=密度ピーク)は175mの2×2に再分割。南東ポケットは維持。
      cells: [
        { lat: 35.7011, lng: 139.4100, radius: 350 }, // 中央北西
        { lat: 35.7011, lng: 139.4178, radius: 350 }, // 中央北東
        // 中央南西 → 175m 2×2
        { lat: 35.6965, lng: 139.4081, radius: 175 }, // 中央南西-北西
        { lat: 35.6965, lng: 139.4119, radius: 175 }, // 中央南西-北東
        { lat: 35.6933, lng: 139.4081, radius: 175 }, // 中央南西-南西
        { lat: 35.6933, lng: 139.4119, radius: 175 }, // 中央南西-南東
        // 中央南東 → 175m 2×2
        { lat: 35.6965, lng: 139.4159, radius: 175 }, // 中央南東-北西
        { lat: 35.6965, lng: 139.4197, radius: 175 }, // 中央南東-北東
        { lat: 35.6933, lng: 139.4159, radius: 175 }, // 中央南東-南西
        { lat: 35.6933, lng: 139.4197, radius: 175 }, // 中央南東-南東
        { lat: 35.6861, lng: 139.4287, radius: 700 }, // 南東ポケット
      ],
    },
    {
      name: '八王子',
      // 南側セル(旧3)を削除。中心街(旧1=飽和)を600mの2×2に分割。西・追分は維持。
      cells: [
        { lat: 35.6634, lng: 139.3334, radius: 600 },  // 中心街 北西
        { lat: 35.6634, lng: 139.3466, radius: 600 },  // 中心街 北東
        { lat: 35.6526, lng: 139.3334, radius: 600 },  // 中心街 南西
        { lat: 35.6526, lng: 139.3466, radius: 600 },  // 中心街 南東
        { lat: 35.6590, lng: 139.3170, radius: 1100 }, // 西・追分方面
      ],
    },
    {
      name: '調布',
      // 駅周辺(旧1=飽和)を600mの2×2に分割。布田・国領は維持。
      cells: [
        { lat: 35.6571, lng: 139.5379, radius: 600 },  // 駅周辺 北西
        { lat: 35.6571, lng: 139.5511, radius: 600 },  // 駅周辺 北東
        { lat: 35.6463, lng: 139.5379, radius: 600 },  // 駅周辺 南西
        { lat: 35.6463, lng: 139.5511, radius: 600 },  // 駅周辺 南東
        { lat: 35.6535, lng: 139.5620, radius: 1100 }, // 布田・国領方面
      ],
    },
    {
      name: '府中',
      // 駅周辺(旧1=飽和)を600mの2×2に分割。分倍河原は維持。
      cells: [
        { lat: 35.6775, lng: 139.4713, radius: 600 },  // 駅周辺 北西
        { lat: 35.6775, lng: 139.4845, radius: 600 },  // 駅周辺 北東
        { lat: 35.6667, lng: 139.4713, radius: 600 },  // 駅周辺 南西
        { lat: 35.6667, lng: 139.4845, radius: 600 },  // 駅周辺 南東
        { lat: 35.6683, lng: 139.4627, radius: 1100 }, // 分倍河原方面
      ],
    },
    {
      name: '国分寺',
      // 西国分寺セル(旧2)を削除。駅周辺(旧1=飽和)を600mの2×2に分割。
      cells: [
        { lat: 35.7057, lng: 139.4743, radius: 600 }, // 駅周辺 北西
        { lat: 35.7057, lng: 139.4875, radius: 600 }, // 駅周辺 北東
        { lat: 35.6949, lng: 139.4743, radius: 600 }, // 駅周辺 南西
        { lat: 35.6949, lng: 139.4875, radius: 600 }, // 駅周辺 南東
      ],
    },
    {
      name: '多摩',
      // ユーザー指定座標 (多摩市・永山駅周辺、多摩ニュータウン内) を中心に1セル追加。
      // 住宅地で低密度想定のため半径1000m。飽和/過少はヒートマップで確認して調整する。
      cells: [
        { lat: 35.6304, lng: 139.4371, radius: 1000 }, // 永山・貝取方面
      ],
    },
  ],
  // ジャンル。ヘアサロンは社内に既存ツールがあるため対象外 (v3で削除)
  // includedType(任意): Google公式カテゴリで厳密化したいときだけ設定する。
  //   飽和(60件到達)しているジャンルにだけ付けると、ジャンル外ノイズが
  //   60件枠を食うのを防げる。付けるとカテゴリ登録が変な新店を落とす副作用も
  //   あるため、ログを見て飽和した組み合わせにのみ有効化するのが安全。
  genres: [
    { label: 'ネイルサロン',     query: 'ネイルサロン' /*, includedType: 'nail_salon' */ },
    { label: 'アイサロン',       query: 'マツエク' },
    { label: 'リラクゼーション', query: 'リラクゼーションサロン' /*, includedType: 'massage' */ },
    { label: 'エステ',           query: 'エステサロン' /*, includedType: 'beauty_salon' */ },
    { label: '整体',             query: '整体' },
    // 接骨院(整体と重複が大)・ジム・ピラティス は運用判断で対象外に
  ],
  // 住所にこの文字列を含む店舗だけ記録する (セルはみ出しのノイズ除去)
  cityFilter: ['国分寺市', '立川市', '八王子市', '府中市', '調布市', '多摩市'],
  // Text Search (New) の合計取得上限は「全ページ合計60件」= 公式仕様の固定天井
  //   (docs: Text Search(New) の "responses" 節
  //    "returns a maximum of 60 results across all pages")。
  //   1ページ20件 × 3ページ = 60。これ以上に上げても効果は無い (60で必ず頭打ち)。
  //   密なセルの取りこぼしはセルを狭く分割する以外に解消できない。
  maxPagesPerQuery: 3,
  // スイープ1実行あたりのリクエスト目安 (無料枠10,000/月 ÷ 30日 ≒ 333)。
  //   UIの「リクエスト予算メーター」の基準値。飽和セルを分割して増やす際の判断に使う
  sweepRequestBudget: 333,
  // 1回の実行で詳細取得する新規店舗の上限 (Details Enterprise 無料枠の保護)
  // 上限を超えた分は台帳未登録のまま残り、翌日の実行で処理される
  maxDetailsPerRun: 30,
  // fetchAll の同時リクエスト数
  fetchChunkSize: 40,
};

const SHEET_KNOWN = 'known_places'; // 既知店舗の台帳 (place_id, first_seen)
const SHEET_NEW = 'new_stores';     // 新規検出ログ
const SHEET_STATS = 'sweep_stats';  // 直近スイープの統計 (毎回上書き)

// ---------------- メイン処理 ----------------

/** 定期実行・手動実行の本体 */
function runBatch() {
  const summary = runCore_(false);
  // 自動実行(トリガー)・手動実行のどちらでもここを通るので実行時刻を記録
  PropertiesService.getScriptProperties()
    .setProperty('LAST_RUN_AUTO', new Date().toISOString());
  return summary;
}

/** 検索範囲・ジャンル変更後に数回実行: 現在の全店舗を「既知」として登録する */
function seedBaseline() {
  return runCore_(true);
}

function runCore_(isSeeding) {
  const props = PropertiesService.getScriptProperties();
  const placesKey = props.getProperty('PLACES_API_KEY');
  if (!placesKey) throw new Error('スクリプト プロパティ PLACES_API_KEY が未設定です');

  const knownSheet = getOrCreateSheet_(SHEET_KNOWN, ['place_id', 'first_seen']);
  const newSheet = getOrCreateSheet_(SHEET_NEW, [
    'detected_at', 'name', 'genre', 'area', 'city', 'address',
    'website', 'maps_url', 'opening_date', 'business_status', 'review_count',
  ]);

  // 既知IDの読み込み
  const knownIds = new Set(
    knownSheet.getLastRow() > 1
      ? knownSheet.getRange(2, 1, knownSheet.getLastRow() - 1, 1).getValues().flat()
      : []
  );
  if (knownIds.size === 0) isSeeding = true; // 台帳が空なら安全のためシーディング扱い

  // [1段階目] IDのみで全域スイープ
  const found = sweepPlaceIds_(placesKey); // Map<placeId, {genre, station}>
  const newcomerIds = [...found.keys()].filter(id => !knownIds.has(id));
  const now = new Date();

  // シーディング: 全IDを台帳登録して終了
  if (isSeeding) {
    if (newcomerIds.length > 0) {
      knownSheet.getRange(knownSheet.getLastRow() + 1, 1, newcomerIds.length, 2)
        .setValues(newcomerIds.map(id => [id, now]));
    }
    const summary = {
      ranAt: now.toISOString(), mode: 'seeding',
      sweptCount: found.size, seededCount: newcomerIds.length,
      newCount: 0, zeroReviewCount: 0, futureOpeningCount: 0, deferredCount: 0,
    };
    Logger.log(JSON.stringify(summary));
    return summary;
  }

  // [2段階目] 新規IDだけ詳細取得 (上限あり、超過分は翌日に持ち越し)
  const toProcess = newcomerIds.slice(0, CONFIG.maxDetailsPerRun);
  const deferredCount = newcomerIds.length - toProcess.length;

  const knownRows = [];
  const recordRows = [];

  toProcess.forEach(id => {
    const meta = found.get(id) || {};
    const d = fetchDetails_(placesKey, id);
    if (!d) return; // 詳細取得に失敗 → 台帳未登録のまま翌日リトライ

    knownRows.push([id, now]); // 台帳登録 (除外対象でも二度と処理しないよう登録する)

    // 閉業店は記録しない
    if (d.businessStatus === 'CLOSED_PERMANENTLY') return;

    const inArea = CONFIG.cityFilter.length === 0
      || CONFIG.cityFilter.some(c => (d.address || '').includes(c));
    if (!inArea) return;

    // 口コミ数による自動除外は撤廃 (口コミ数はK列に記録し、UIで目視判断する方針)。
    // J列は businessStatus を格納 (旧hpb_status。HPB自動判定は廃止済み)。
    // FUTURE_OPENING = オープン予定。UI/メールで先回りリードとして強調する。
    recordRows.push([
      now, d.name, meta.genre || '', meta.station || '',
      extractCity_(d.address), d.address, d.website, d.mapsUrl,
      d.openingDate, d.businessStatus || '', d.reviewCount,
    ]);
  });

  if (knownRows.length > 0) {
    knownSheet.getRange(knownSheet.getLastRow() + 1, 1, knownRows.length, 2)
      .setValues(knownRows);
  }
  if (recordRows.length > 0) {
    newSheet.getRange(newSheet.getLastRow() + 1, 1, recordRows.length, 11)
      .setValues(recordRows);
  }

  if (recordRows.length > 0) sendNotification_(recordRows);

  // 口コミ0件 = 開店直後の有力サイン。FUTURE_OPENING = オープン予定 (先回りリード)
  const zeroReviewCount = recordRows.filter(r => r[10] === 0).length;
  const futureOpeningCount = recordRows.filter(r => r[9] === 'FUTURE_OPENING').length;
  const summary = {
    ranAt: now.toISOString(), mode: 'normal',
    sweptCount: found.size, newCount: recordRows.length,
    zeroReviewCount: zeroReviewCount, futureOpeningCount: futureOpeningCount,
    deferredCount: deferredCount,
  };
  Logger.log(JSON.stringify(summary));
  return summary;
}

// ---------------- [1段階目] IDのみスイープ ----------------

/**
 * 全エリアの全セル × 全ジャンルを Text Search (IDのみ = 最安SKU) で検索し、
 * Map<placeId, {genre, station}> を返す。fetchAllで並列化。
 */
function sweepPlaceIds_(apiKey) {
  const found = new Map();

  // 統計は「セル×ジャンル」単位で保持する (UIのヒートマップ表・地図・リクエスト予算に使う)。
  //   キー: "エリア#セル番号||ジャンル"。座標も持たせて地図描画に使う
  const stats = {};
  const statKey = (cellId, g) => cellId + '||' + g;

  // 1ページ目の全タスク (セル×ジャンル) を組み立てつつ、統計の器を初期化
  let active = [];
  CONFIG.areas.forEach(area => {
    area.cells.forEach((cell, ci) => {
      const cellId = area.name + '#' + ci;
      CONFIG.genres.forEach(g => {
        stats[statKey(cellId, g.label)] = {
          area: area.name, cellIndex: ci,
          lat: cell.lat, lng: cell.lng, radius: cell.radius,
          genre: g.label, count: 0, pagesUsed: 0, saturated: false,
        };
        active.push({ areaName: area.name, cell: cell, cellId: cellId, g: g, pageToken: null });
      });
    });
  });

  // ページを進めながら並列取得。60件(3ページ)で必ず頭打ち = Text Search(New)の公式上限
  for (let page = 0; page < CONFIG.maxPagesPerQuery && active.length > 0; page++) {
    const requests = active.map(c => buildSearchRequest_(apiKey, c));
    const responses = fetchAllChunked_(requests);
    const next = [];

    responses.forEach((res, i) => {
      const c = active[i];
      const s = stats[statKey(c.cellId, c.g.label)];
      if (!res || res.getResponseCode() !== 200) {
        Logger.log(`Sweep失敗 [${c.cellId} × ${c.g.label}]: `
          + (res ? res.getContentText().slice(0, 300) : 'no response'));
        return;
      }
      const data = JSON.parse(res.getContentText());
      const pageCount = (data.places || []).length;
      if (s) {
        s.count += pageCount;      // このセル×ジャンルで返った件数を加算
        s.pagesUsed = page + 1;    // セル×ジャンルごとに逐次進むので = 到達ページ数
      }
      (data.places || []).forEach(p => {
        if (!found.has(p.id)) {
          found.set(p.id, { genre: c.g.label, station: c.areaName });
        }
      });

      const isLastPage = page === CONFIG.maxPagesPerQuery - 1;
      if (data.nextPageToken && !isLastPage) {
        next.push({ areaName: c.areaName, cell: c.cell, cellId: c.cellId, g: c.g, pageToken: data.nextPageToken });
      } else if (s && (data.nextPageToken || (isLastPage && pageCount === 20))) {
        // 最終ページ後もトークンが残る、または60件ちょうど到達 = 上限で取りこぼしの疑い
        s.saturated = true;
      }
    });

    active = next;
    if (active.length > 0) Utilities.sleep(400);
  }

  writeSweepStats_(stats);
  return found;
}

/** 直近スイープ統計 (セル×ジャンル単位) を sweep_stats シートに上書き保存 */
function writeSweepStats_(stats) {
  const headers = ['ran_at', 'area', 'cell_index', 'lat', 'lng', 'radius', 'genre', 'count', 'pages_used', 'saturated'];
  const sheet = getOrCreateSheet_(SHEET_STATS, headers);
  // 列構成を変えたので、ヘッダーを毎回上書きして旧スキーマからでも追従する
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  // ヘッダー以外を全消し (旧スキーマの余剰列も含めてクリア)
  if (sheet.getLastRow() > 1) {
    const cols = Math.max(sheet.getLastColumn(), headers.length);
    sheet.getRange(2, 1, sheet.getLastRow() - 1, cols).clearContent();
  }
  const now = new Date();
  const rows = Object.keys(stats).map(k => {
    const s = stats[k];
    const saturated = s.saturated || s.count >= 60;
    return [now, s.area, s.cellIndex, s.lat, s.lng, s.radius, s.genre, s.count, s.pagesUsed, saturated];
  });
  // エリア→セル番号→ジャンル順に並べる
  rows.sort((a, b) =>
    (a[1] + '#' + a[2] + '||' + a[6]).localeCompare(b[1] + '#' + b[2] + '||' + b[6]));
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

/** セル {lat,lng,radius(m)} を検索矩形の緯度経度境界に変換 (地図描画とAPIリクエストで共用) */
function cellBounds_(cell) {
  const dLat = cell.radius / 111320;
  const dLng = cell.radius / (111320 * Math.cos(cell.lat * Math.PI / 180));
  return {
    low: { lat: cell.lat - dLat, lng: cell.lng - dLng },
    high: { lat: cell.lat + dLat, lng: cell.lng + dLng },
  };
}

function buildSearchRequest_(apiKey, combo) {
  const cell = combo.cell;
  // 半径(m) → 緯度経度の矩形境界に変換 (地図描画と同じ計算を共用)
  const b = cellBounds_(cell);

  const body = {
    textQuery: combo.g.query,
    languageCode: 'ja',
    pageSize: 20,
    // オープン予定(まだ開店していない)店も結果に含める。既定 false では丸ごと除外されるため、
    // businessStatus=FUTURE_OPENING の店を先回りで拾うにはこのフラグが必須 (SKUは IDs Only のまま)
    includeFutureOpeningBusinesses: true,
    // 距離順 = 人気度と無関係にセル中心から近い順に列挙する。
    // 既定の関連度順は人気店優先のため、口コミの無い新店が60件枠から
    // 押し出されやすい。距離順ならセル内該当店が60件以下のとき全件取れる
    rankPreference: 'DISTANCE',
    // locationRestriction = この範囲の外の結果を返さない (biasより厳密)
    locationRestriction: {
      rectangle: {
        low: { latitude: b.low.lat, longitude: b.low.lng },
        high: { latitude: b.high.lat, longitude: b.high.lng },
      },
    },
  };
  if (combo.pageToken) body.pageToken = combo.pageToken;
  // ジャンルに includedType が設定されていれば厳密カテゴリで絞る
  if (combo.g.includedType) {
    body.includedType = combo.g.includedType;
    body.strictTypeFiltering = true;
  }

  return {
    url: 'https://places.googleapis.com/v1/places:searchText',
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-Goog-Api-Key': apiKey,
      // IDのみ = Text Search (IDs Only) SKU。ここに他フィールドを足すと課金ランクが上がるので注意
      'X-Goog-FieldMask': 'places.id,nextPageToken',
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
}

/** fetchAll を安全なサイズに分割して実行 */
function fetchAllChunked_(requests) {
  const out = [];
  for (let i = 0; i < requests.length; i += CONFIG.fetchChunkSize) {
    const chunk = requests.slice(i, i + CONFIG.fetchChunkSize);
    const responses = UrlFetchApp.fetchAll(chunk);
    responses.forEach(r => out.push(r));
  }
  return out;
}

// ---------------- [2段階目] 詳細取得 ----------------

function fetchDetails_(apiKey, placeId) {
  // openingDate(開業日) が未対応環境で400になった場合に備えフォールバック
  // businessStatus / userRatingCount は websiteUri と同じく最上位SKUに
  // 含まれるため、追加してもコストは変わらない
  const masks = [
    'id,displayName,formattedAddress,websiteUri,googleMapsUri,businessStatus,userRatingCount,openingDate',
    'id,displayName,formattedAddress,websiteUri,googleMapsUri,businessStatus,userRatingCount',
  ];
  for (let m = 0; m < masks.length; m++) {
    const res = UrlFetchApp.fetch(
      'https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId),
      {
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': masks[m] },
        muteHttpExceptions: true,
      }
    );
    if (res.getResponseCode() === 200) {
      const p = JSON.parse(res.getContentText());
      return {
        name: p.displayName ? p.displayName.text : '',
        address: p.formattedAddress || '',
        website: p.websiteUri || '',
        mapsUrl: p.googleMapsUri || '',
        openingDate: formatOpeningDate_(p.openingDate),
        businessStatus: p.businessStatus || '',
        reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
      };
    }
    Logger.log('Details失敗 (' + placeId + ') mask=' + m + ': '
      + res.getContentText().slice(0, 200));
  }
  return null;
}

function formatOpeningDate_(d) {
  if (!d || !d.year) return '';
  const mm = ('0' + (d.month || 1)).slice(-2);
  const dd = ('0' + (d.day || 1)).slice(-2);
  return d.year + '-' + mm + '-' + dd;
}

// ---------------- ホットペッパー掲載チェック (手動) ----------------

/**
 * 店名からホットペッパービューティー掲載を手動確認するための Google site: 検索URL。
 * 旧: Custom Search JSON API で自動判定していたが、新規プロジェクトは利用不可のため、
 *     同じ site:beauty.hotpepper.jp クエリを検索リンクにして人が1クリックで確認する。
 */
function hpbSearchUrl_(name) {
  return 'https://www.google.com/search?q='
    + encodeURIComponent('site:beauty.hotpepper.jp "' + (name || '') + '"');
}

// ---------------- 通知 ----------------

function sendNotification_(rows) {
  const props = PropertiesService.getScriptProperties();
  const to = props.getProperty('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail();
  // rows: [detected_at, name, genre, area, city, address, website, maps_url, opening_date, hpb_status, review_count]
  const lines = rows.map(r =>
    '・' + r[1] + '【' + r[2] + ' / ' + r[3] + '】'
    + (r[9] === 'FUTURE_OPENING' ? ' 🔜オープン予定' : '')
    + (r[10] === 0 ? ' ★口コミ0件' : '') + '\n'
    + '  ' + r[5] + '\n'
    + (r[8] ? '  ' + (r[9] === 'FUTURE_OPENING' ? '開業予定日' : '開業日') + ': ' + r[8] + '\n' : '')
    + '  サイト: ' + (r[6] || 'なし') + '\n'
    + '  HPB確認: ' + hpbSearchUrl_(r[1]) + '\n'
    + '  地図: ' + r[7]
  );
  const futureCount = rows.filter(r => r[9] === 'FUTURE_OPENING').length;
  MailApp.sendEmail({
    to: to,
    subject: '【新店検出】' + rows.length + '件 (多摩エリア)'
      + (futureCount > 0 ? ' 🔜オープン予定' + futureCount + '件' : '') + ' — HPB要手動確認',
    body: '新店を検出しました。各店の「HPB確認」リンクでホットペッパービューティー掲載を確認してください。'
      + '（★口コミ0件は開店直後の有力サイン)\n\n'
      + lines.join('\n\n')
      + '\n\n※ 詳細はスプレッドシートまたはWebアプリで確認できます。',
  });
}

// ---------------- トリガー設定 ----------------

/** 1回実行すると毎朝7時の自動実行が登録される (既存のrunBatchトリガーは削除) */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runBatch') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runBatch').timeBased().atHour(7).everyDays(1).create();
  Logger.log('毎朝7時のトリガーを設定しました');
}

// ---------------- Webアプリ ----------------

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('新店サロンウォッチャー')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** UI用: 前日0時以降に検出した新店を返す */
function getRecentStores() {
  const sheet = getOrCreateSheet_(SHEET_NEW, [
    'detected_at', 'name', 'genre', 'area', 'city', 'address',
    'website', 'maps_url', 'opening_date', 'business_status', 'review_count',
  ]);
  if (sheet.getLastRow() < 2) return { stores: [], lastRun: getLastRunLabel_(), lastAuto: getRunLabel_('LAST_RUN_AUTO') };

  // 前日の0時 (プロジェクトのタイムゾーン基準)
  const from = new Date();
  from.setDate(from.getDate() - 1);
  from.setHours(0, 0, 0, 0);

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
  const stores = values
    .filter(r => r[0] instanceof Date && r[0].getTime() >= from.getTime())
    .map(r => ({
      detectedAt: Utilities.formatDate(r[0], 'Asia/Tokyo', 'M/d HH:mm'),
      ts: r[0].getTime(),
      name: r[1],
      genre: r[2],
      area: r[3],
      city: r[4],
      address: r[5],
      website: r[6],
      mapsUrl: r[7],
      openingDate: r[8],
      businessStatus: r[9],
      reviewCount: r[10] === '' || r[10] === undefined ? null : Number(r[10]),
    }))
    .sort((a, b) => b.ts - a.ts);

  return { stores: stores, lastRun: getLastRunLabel_(), lastAuto: getRunLabel_('LAST_RUN_AUTO') };
}

/** UI用: 直近スイープ統計 (セル×ジャンル) を座標・境界・状態つきで返す */
function getSweepStats() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_STATS);
  if (!sheet || sheet.getLastRow() < 2) {
    return { rows: [], ranAt: '', totalRequests: 0, budget: CONFIG.sweepRequestBudget };
  }
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
  let ranAt = '';
  let totalRequests = 0;
  const rows = values
    .filter(r => r[1]) // area が空でない行のみ
    .map(r => {
      if (!ranAt && r[0] instanceof Date) {
        ranAt = Utilities.formatDate(r[0], 'Asia/Tokyo', 'M/d HH:mm');
      }
      const cellIndex = Number(r[2]) || 0;
      const lat = Number(r[3]), lng = Number(r[4]), radius = Number(r[5]);
      const count = Number(r[7]) || 0;
      const pagesUsed = Number(r[8]) || 0;
      const saturated = r[9] === true || r[9] === 'true' || r[9] === 'TRUE';
      totalRequests += pagesUsed; // 実際に投げたページ数の合計 = リクエスト本数
      const b = cellBounds_({ lat: lat, lng: lng, radius: radius });
      // 状態: saturated(60到達=要分割) / tight(2ページ以上=余裕少) / low(過少) / ok
      let status = 'ok';
      if (saturated || count >= 60) status = 'saturated';
      else if (pagesUsed >= 2) status = 'tight';
      else if (count <= 10) status = 'low';
      return {
        area: r[1], cellIndex: cellIndex, cellId: r[1] + '#' + cellIndex,
        lat: lat, lng: lng, radius: radius,
        low: b.low, high: b.high,
        genre: r[6], count: count, pagesUsed: pagesUsed,
        saturated: saturated, status: status,
      };
    });
  return { rows: rows, ranAt: ranAt, totalRequests: totalRequests, budget: CONFIG.sweepRequestBudget };
}

/** UI用: 手動実行 */
function runBatchManual() {
  const summary = runBatch();
  PropertiesService.getScriptProperties()
    .setProperty('LAST_RUN', new Date().toISOString());
  return summary;
}

function getLastRunLabel_() {
  return getRunLabel_('LAST_RUN');
}

function getRunLabel_(propKey) {
  const iso = PropertiesService.getScriptProperties().getProperty(propKey);
  if (!iso) return '—';
  return Utilities.formatDate(new Date(iso), 'Asia/Tokyo', 'M/d HH:mm');
}

// ---------------- ユーティリティ ----------------

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function extractCity_(address) {
  const m = (address || '').match(/東京都(.+?[市区])/);
  return m ? m[1] : '';
}