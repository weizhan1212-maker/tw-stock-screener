/**
 * 新聞列表：Google 新聞 RSS，只回傳標題、來源、時間、連結（不轉載內文）。快取 15 分鐘。
 * ?q=關鍵字（預設「台股」），例如個股頁用「台積電 2330」。
 */
const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "台股").slice(0, 40);
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  try {
    const res = await fetch(url, { next: { revalidate: 900 }, headers: { "User-Agent": "Mozilla/5.0 tw-stock-screener" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const it = m[1];
      const source = tag(it, "source");
      let title = tag(it, "title");
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const t = new Date(tag(it, "pubDate"));
      return { title, source, link: tag(it, "link"), time: Number.isNaN(t.getTime()) ? "" : t.toISOString() };
    }).filter((x) => x.time).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 20);  // 新的在前
    return Response.json({ q, items }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return Response.json({ q, items: [], error: String((e as Error).message) }, { status: 502 });
  }
}
