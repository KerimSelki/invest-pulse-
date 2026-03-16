// /api/news.js — Vercel Serverless Function
// CryptoCompare ücretsiz haber API'si

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { category = "all", lang = "EN", limit = "30" } = req.query;

  const headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
  };

  try {
    const catParam = category !== "all" ? `&categories=${encodeURIComponent(category)}` : "";
    const url = `https://min-api.cryptocompare.com/data/v2/news/?lang=${lang}&sortOrder=latest${catParam}&extraParams=InvestPulse`;

    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`CryptoCompare HTTP ${r.status}`);
    const data = await r.json();

    const articles = (data.Data || []).slice(0, parseInt(limit)).map(a => ({
      id: String(a.id),
      title: a.title,
      body: a.body ? a.body.slice(0, 300) + (a.body.length > 300 ? "..." : "") : "",
      url: a.url,
      imageUrl: a.imageurl || "",
      source: a.source_info?.name || a.source || "Unknown",
      sourceLogo: a.source_info?.img || "",
      publishedAt: (a.published_on || 0) * 1000,
      categories: a.categories || "",
      tags: a.tags || "",
      sentiment: a.body?.toLowerCase().includes("bullish") || a.tags?.toLowerCase().includes("bullish")
        ? "bullish"
        : a.body?.toLowerCase().includes("bearish") || a.tags?.toLowerCase().includes("bearish")
        ? "bearish"
        : "neutral",
    }));

    return res.status(200).json({ articles, total: articles.length, ts: Date.now() });
  } catch (e) {
    // Fallback: CryptoPanic RSS benzeri public endpoint
    try {
      const r2 = await fetch(
        "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest",
        { headers, signal: AbortSignal.timeout(8000) }
      );
      if (r2.ok) {
        const data = await r2.json();
        const articles = (data.Data || []).slice(0, 20).map(a => ({
          id: String(a.id),
          title: a.title,
          body: a.body ? a.body.slice(0, 300) : "",
          url: a.url,
          imageUrl: a.imageurl || "",
          source: a.source_info?.name || a.source || "News",
          sourceLogo: "",
          publishedAt: (a.published_on || 0) * 1000,
          categories: a.categories || "",
          tags: "",
          sentiment: "neutral",
        }));
        return res.status(200).json({ articles, total: articles.length, ts: Date.now() });
      }
    } catch (e2) {}

    return res.status(502).json({ error: e.message, articles: [] });
  }
}
