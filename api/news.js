// /api/news.js — Vercel Serverless
// Çoklu kaynak: CryptoPanic → CryptoCompare → CoinGecko

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=300");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { currencies = "", category = "all", limit = "40" } = req.query;
  const lim = Math.min(parseInt(limit) || 40, 60);

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
  };

  const normalize = (articles) => articles.filter(Boolean).slice(0, lim);

  // ── Kaynak 1: CryptoPanic (ücretsiz, coin filtresi var) ──
  try {
    const curParam = currencies ? `&currencies=${encodeURIComponent(currencies)}` : "";
    const kindParam = category !== "all" ? `&filter=${encodeURIComponent(category)}` : "";
    const url = `https://cryptopanic.com/api/free/v1/posts/?auth_token=FREE&public=true&kind=news${curParam}${kindParam}`;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const d = await r.json();
      if (d?.results?.length > 0) {
        const articles = d.results.map(a => ({
          id: String(a.id),
          title: a.title,
          body: a.metadata?.description?.slice(0, 280) || "",
          url: a.url,
          imageUrl: a.metadata?.image || "",
          source: a.source?.title || a.domain || "CryptoPanic",
          publishedAt: new Date(a.published_at).getTime(),
          currencies: (a.currencies || []).map(c => c.code),
          sentiment: a.votes?.positive > a.votes?.negative ? "bullish"
                   : a.votes?.negative > a.votes?.positive ? "bearish" : "neutral",
          provider: "cryptopanic",
        }));
        return res.status(200).json({ articles: normalize(articles), source: "cryptopanic" });
      }
    }
  } catch(e) { console.log("CryptoPanic:", e.message); }

  // ── Kaynak 2: CryptoCompare ──
  try {
    const catParam = (currencies || category !== "all")
      ? `&categories=${encodeURIComponent(currencies || category)}`
      : "";
    const url = `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest${catParam}`;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const d = await r.json();
      if (d?.Data?.length > 0) {
        const articles = d.Data.map(a => ({
          id: String(a.id),
          title: a.title,
          body: a.body?.slice(0, 280) || "",
          url: a.url,
          imageUrl: a.imageurl || "",
          source: a.source_info?.name || a.source || "CryptoCompare",
          publishedAt: (a.published_on || 0) * 1000,
          currencies: (a.categories || "").split("|").map(s => s.trim()).filter(Boolean),
          sentiment: a.body?.toLowerCase().includes("bullish") ? "bullish"
                   : a.body?.toLowerCase().includes("bearish") ? "bearish" : "neutral",
          provider: "cryptocompare",
        }));
        return res.status(200).json({ articles: normalize(articles), source: "cryptocompare" });
      }
    }
  } catch(e) { console.log("CryptoCompare:", e.message); }

  // ── Kaynak 3: CoinGecko News ──
  try {
    const url = `https://api.coingecko.com/api/v3/news?per_page=${lim}`;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d) && d.length > 0) {
        const articles = d.map(a => ({
          id: String(a.id || Math.random()),
          title: a.title,
          body: a.description?.slice(0, 280) || "",
          url: a.url,
          imageUrl: a.thumb_2x || a.thumb || "",
          source: a.author || "CoinGecko",
          publishedAt: new Date(a.updated_at || a.created_at || Date.now()).getTime(),
          currencies: [],
          sentiment: "neutral",
          provider: "coingecko",
        }));
        return res.status(200).json({ articles: normalize(articles), source: "coingecko" });
      }
    }
  } catch(e) { console.log("CoinGecko:", e.message); }

  return res.status(200).json({ articles: [], source: "none", error: "All sources failed" });
}
