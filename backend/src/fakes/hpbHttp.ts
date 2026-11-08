const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

// Minimal pages in the shapes src/hpb/parse.ts reads (hair section layout).
const LISTED_HTML = page(`<ul class="slnCassetteList"><li>
<h3 class="slnName"><a href="/strJ000000001/?cstt=1">Hair Salon Sakura</a></h3>
<dl><dt>アクセス</dt><dd class="access">JR八王子駅 徒歩5分（東京都八王子市旭町）</dd></dl>
</li></ul>`);

const EMPTY_HTML = page('<p class="searchResultZeroText">条件に一致するサロンが見つかりませんでした。</p>');

/** Searches containing "Sakura" are listed (Hair Salon Sakura, 八王子市); everything else has no results. */
export const fakeHpbHttp: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const listed = decodeURIComponent(url).includes('Sakura');
  return new Response(listed ? LISTED_HTML : EMPTY_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};
