// /api/stocklist.js — Vercel Serverless Function
// FMP'den US hisse listesini çeker

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=172800");

  if (req.method === "OPTIONS") return res.status(200).end();

  const FMP_KEY = process.env.FMP_KEY || "00rEssEWw276o3NRJY1BcLH1ACQGb1D6";

  try {
    // FMP stock screener — ücretsiz planda çalışır
    const exchanges = ["NYSE", "NASDAQ", "AMEX"];
    const allStocks = [];

    for (const ex of exchanges) {
      try {
        const url = `https://financialmodelingprep.com/api/v3/stock-screener?exchange=${ex}&limit=5000&apikey=${FMP_KEY}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            data.forEach(s => {
              if (s.symbol && s.companyName) {
                allStocks.push({
                  s: s.symbol,
                  n: s.companyName,
                  e: s.exchangeShortName || ex,
                  t: s.isEtf ? "etf" : "stock",
                  p: s.price || 0,
                });
              }
            });
          }
        }
      } catch (e) {}
    }

    return res.status(200).json({
      count: allStocks.length,
      updated: new Date().toISOString(),
      stocks: allStocks,
    });

  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
