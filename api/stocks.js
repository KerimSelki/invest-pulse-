// /api/stocks.js — Vercel Serverless Function
// BIST hisseleri için Yahoo Finance proxy (v8/chart daha güvenilir)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "symbols parameter required" });

  const symList = symbols.split(",").slice(0, 100).map(s => s.trim()).filter(Boolean);
  if (symList.length === 0) return res.status(400).json({ error: "no valid symbols" });

  const userAgents = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  ];
  const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

  const headers = {
    "User-Agent": randomUA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
  };

  const results = [];
  const errors = [];

  // Strateji A: Yahoo v7 batch (en hızlı)
  const fetchBatchV7 = async (batch, domain = "query1") => {
    try {
      const url = `https://${domain}.finance.yahoo.com/v7/finance/quote?symbols=${batch.join(",")}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketPreviousClose,shortName,currency,marketState`;
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return data?.quoteResponse?.result || [];
    } catch (e) {
      return [];
    }
  };

  // Strateji B: Yahoo v8/chart (sembol başına, daha güvenilir)
  const fetchSingleV8 = async (sym) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      if (!meta || !meta.regularMarketPrice) throw new Error("No price data");
      const price = meta.regularMarketPrice;
      const prevClose = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPreviousClose || price;
      return {
        symbol: sym,
        regularMarketPrice: price,
        regularMarketChangePercent: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
        regularMarketPreviousClose: prevClose,
        shortName: meta.shortName || meta.longName || sym,
        currency: meta.currency || "TRY",
        marketState: meta.marketState || "CLOSED",
      };
    } catch (e) {
      return null;
    }
  };

  let batchSuccess = false;

  for (let i = 0; i < symList.length; i += 50) {
    const batch = symList.slice(i, i + 50);

    // Önce query1 dene
    let batchResults = await fetchBatchV7(batch, "query1");
    // Başarısız olursa query2 dene
    if (batchResults.length === 0) {
      batchResults = await fetchBatchV7(batch, "query2");
    }

    if (batchResults.length > 0) {
      results.push(...batchResults);
      batchSuccess = true;
    } else {
      // Batch başarısız → sembol başına v8 dene
      const individualResults = await Promise.allSettled(batch.map(sym => fetchSingleV8(sym)));
      individualResults.forEach((r, idx) => {
        if (r.status === "fulfilled" && r.value) {
          results.push(r.value);
        } else {
          errors.push(batch[idx]);
        }
      });
    }
  }

  if (results.length > 0) {
    return res.status(200).json({
      quoteResponse: { result: results },
      meta: { total: results.length, errors: errors.length, strategy: batchSuccess ? "batch_v7" : "individual_v8" }
    });
  }

  return res.status(502).json({
    error: "All Yahoo Finance endpoints failed",
    quoteResponse: { result: [] },
    failedSymbols: errors,
  });
}
