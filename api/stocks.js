// /api/stocks.js — Vercel Serverless Function
// Server-side Yahoo Finance proxy — CORS sorunu yok

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "symbols parameter required" });

  const symList = symbols.split(",").slice(0, 200).map(s => s.trim()).filter(Boolean);
  if (symList.length === 0) return res.status(400).json({ error: "no valid symbols" });

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
  };

  // Strategy 1: Yahoo Finance v7/quote (batch — up to 50 symbols)
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symList.join(",")}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketPreviousClose,shortName,currency,marketState`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const data = await response.json();
      if (data?.quoteResponse?.result?.length > 0) {
        return res.status(200).json(data);
      }
    }
  } catch (e) {
    console.log("v7 failed:", e.message);
  }

  // Strategy 2: Yahoo Finance v8/chart per symbol (slower but more reliable)
  try {
    const results = [];
    const toFetch = symList.slice(0, 30); // limit to 30 for v8

    for (let i = 0; i < toFetch.length; i += 5) {
      const batch = toFetch.slice(i, i + 5);
      const promises = batch.map(async (sym) => {
        try {
          const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`;
          const r = await fetch(chartUrl, { headers, signal: AbortSignal.timeout(8000) });
          if (!r.ok) return null;
          const d = await r.json();
          const meta = d?.chart?.result?.[0]?.meta;
          if (!meta) return null;
          const prevClose = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice;
          const price = meta.regularMarketPrice || 0;
          return {
            symbol: sym,
            regularMarketPrice: price,
            regularMarketChangePercent: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
            shortName: meta.shortName || sym,
            currency: meta.currency || "TRY",
          };
        } catch (e) { return null; }
      });
      const batchResults = await Promise.all(promises);
      results.push(...batchResults.filter(Boolean));
    }

    if (results.length > 0) {
      return res.status(200).json({ quoteResponse: { result: results } });
    }
  } catch (e) {
    console.log("v8 failed:", e.message);
  }

  // Strategy 3: Yahoo Finance v6/quote (another fallback)
  try {
    const url = `https://query2.finance.yahoo.com/v6/finance/quote?symbols=${symList.join(",")}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const data = await response.json();
      if (data?.quoteResponse?.result?.length > 0) {
        return res.status(200).json(data);
      }
    }
  } catch (e) {
    console.log("v6 failed:", e.message);
  }

  return res.status(502).json({ error: "All Yahoo Finance endpoints failed", quoteResponse: { result: [] } });
}
