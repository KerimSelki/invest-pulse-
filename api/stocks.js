// /api/stocks.js — Vercel Serverless Function
// Tüm hisseler için evrensel proxy: Yahoo Finance → Twelve Data → Finnhub

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "symbols parameter required" });

  const symList = symbols.split(",").slice(0, 150).map(s => s.trim()).filter(Boolean);
  if (symList.length === 0) return res.status(400).json({ error: "no valid symbols" });

  const TWELVE_KEY = process.env.TWELVE_DATA_KEY || "f70dda243c834a039facebc832169428";
  const FINNHUB_KEY = process.env.FINNHUB_KEY || "d6t6pb1r01qoqoisfar0d6t6pb1r01qoqoisfarg";

  const results = [];
  const foundSyms = new Set();

  // ── Yahoo Finance headers ──
  const UAs = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  ];
  const yhHeaders = {
    "User-Agent": UAs[Math.floor(Math.random() * UAs.length)],
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
  };

  // ── KAYNAK 1: Yahoo Finance batch v7 ──
  const yahooV7 = async (batch, domain = "query1") => {
    try {
      const url = `https://${domain}.finance.yahoo.com/v7/finance/quote?symbols=${batch.join(",")}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketPreviousClose,shortName,currency,marketState,marketCap`;
      const r = await fetch(url, { headers: yhHeaders, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return data?.quoteResponse?.result || [];
    } catch (e) { return []; }
  };

  // ── KAYNAK 1b: Yahoo v8/chart (tek sembol, daha güvenilir) ──
  const yahooV8 = async (sym) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
      const r = await fetch(url, { headers: yhHeaders, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) throw new Error("no price");
      const price = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose || meta.previousClose || price;
      return {
        symbol: sym,
        regularMarketPrice: price,
        regularMarketChangePercent: prev > 0 ? ((price - prev) / prev) * 100 : 0,
        shortName: meta.shortName || meta.longName || sym,
        currency: meta.currency || "USD",
        marketState: meta.marketState || "CLOSED",
      };
    } catch (e) { return null; }
  };

  // Try Yahoo batch first
  for (let i = 0; i < symList.length; i += 50) {
    const batch = symList.slice(i, i + 50);
    let batchRes = await yahooV7(batch, "query1");
    if (batchRes.length === 0) batchRes = await yahooV7(batch, "query2");

    if (batchRes.length > 0) {
      batchRes.forEach(q => { results.push(q); foundSyms.add(q.symbol); });
    } else {
      // Fallback: individual v8
      const settled = await Promise.allSettled(batch.map(s => yahooV8(s)));
      settled.forEach((r, idx) => {
        if (r.status === "fulfilled" && r.value) {
          results.push(r.value);
          foundSyms.add(batch[idx]);
        }
      });
    }
  }

  // ── KAYNAK 2: Twelve Data (Yahoo'dan gelemeyen US hisseleri için) ──
  const missingUS = symList.filter(s => !foundSyms.has(s) && !s.endsWith(".IS") && !s.endsWith(".TEFAS"));
  if (missingUS.length > 0 && TWELVE_KEY) {
    for (let i = 0; i < missingUS.length; i += 120) {
      const batch = missingUS.slice(i, i + 120);
      try {
        const url = `https://api.twelvedata.com/quote?symbol=${batch.join(",")}&apikey=${TWELVE_KEY}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (r.ok) {
          const data = await r.json();
          const processQ = (sym, q) => {
            if (!q || q.code || !q.close) return;
            const price = parseFloat(q.close);
            const prev = parseFloat(q.previous_close || q.close);
            results.push({
              symbol: sym,
              regularMarketPrice: price,
              regularMarketChangePercent: parseFloat(q.percent_change || 0),
              regularMarketPreviousClose: prev,
              shortName: q.name || sym,
              currency: q.currency || "USD",
              marketState: "CLOSED",
            });
            foundSyms.add(sym);
          };
          if (batch.length === 1) processQ(batch[0], data);
          else batch.forEach(sym => processQ(sym, data[sym]));
        }
      } catch (e) {}
    }
  }

  // ── KAYNAK 3: Finnhub (hâlâ eksik olanlar için) ──
  const stillMissing = symList.filter(s => !foundSyms.has(s) && !s.endsWith(".IS") && !s.endsWith(".TEFAS"));
  if (stillMissing.length > 0 && FINNHUB_KEY) {
    // Paralel çek ama rate limit için 100ms aralık
    const chunks = [];
    for (let i = 0; i < stillMissing.length; i += 10) chunks.push(stillMissing.slice(i, i + 10));
    for (const chunk of chunks) {
      await Promise.allSettled(chunk.map(async sym => {
        try {
          const url = `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (r.ok) {
            const d = await r.json();
            if (d.c > 0) {
              results.push({
                symbol: sym,
                regularMarketPrice: d.c,
                regularMarketChangePercent: d.pc > 0 ? ((d.c - d.pc) / d.pc) * 100 : 0,
                regularMarketPreviousClose: d.pc,
                shortName: sym,
                currency: "USD",
                marketState: "CLOSED",
              });
              foundSyms.add(sym);
            }
          }
        } catch (e) {}
      }));
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (results.length > 0) {
    return res.status(200).json({
      quoteResponse: { result: results },
      meta: {
        total: results.length,
        requested: symList.length,
        missing: symList.filter(s => !foundSyms.has(s)),
      }
    });
  }

  return res.status(502).json({ error: "All sources failed", quoteResponse: { result: [] } });
}
