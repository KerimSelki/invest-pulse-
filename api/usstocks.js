// /api/usstocks.js — US Hisse Proxy
// Kaynak 1: Twelve Data (ücretsiz, 800/gün, 120 sembol batch)
// Kaynak 2: Finnhub (ücretsiz, 60/dk, backup)
// API keyleri Vercel env variable'dan gelir

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "symbols required" });

  const symList = symbols.split(",").slice(0, 120).map(s => s.trim().toUpperCase()).filter(Boolean);
  if (symList.length === 0) return res.status(400).json({ error: "no valid symbols" });

  const TWELVE_KEY = process.env.TWELVE_DATA_KEY || "f70dda243c834a039facebc832169428";
  const FINNHUB_KEY = process.env.FINNHUB_KEY || "d6t6pb1r01qoqoisfar0d6t6pb1r01qoqoisfarg";
  const results = {};

  // ── KAYNAK 1: Twelve Data (/price endpoint, batch up to 120) ──
  if (TWELVE_KEY) {
    try {
      // Twelve Data /price supports comma-separated symbols
      const url = `https://api.twelvedata.com/price?symbol=${symList.join(",")}&apikey=${TWELVE_KEY}`;
      const priceRes = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        // If single symbol → {price:"123"}, if multiple → {AAPL:{price:"123"}, ...}
        if (symList.length === 1) {
          const sym = symList[0];
          if (priceData.price && !priceData.code) {
            results[sym] = { usd: parseFloat(priceData.price), usd_24h_change: 0, source: "twelvedata" };
          }
        } else {
          for (const sym of symList) {
            if (priceData[sym]?.price && !priceData[sym]?.code) {
              results[sym] = { usd: parseFloat(priceData[sym].price), usd_24h_change: 0, source: "twelvedata" };
            }
          }
        }

        // Get 24h change for symbols we got prices for (quote endpoint)
        const gotPrices = Object.keys(results);
        if (gotPrices.length > 0) {
          for (let i = 0; i < gotPrices.length; i += 120) {
            const batch = gotPrices.slice(i, i + 120);
            try {
              const qUrl = `https://api.twelvedata.com/quote?symbol=${batch.join(",")}&apikey=${TWELVE_KEY}`;
              const qRes = await fetch(qUrl, { signal: AbortSignal.timeout(10000) });
              if (qRes.ok) {
                const qData = await qRes.json();
                const processQuote = (sym, q) => {
                  if (q?.percent_change && !q?.code) {
                    if (results[sym]) results[sym].usd_24h_change = parseFloat(q.percent_change);
                  }
                };
                if (batch.length === 1) processQuote(batch[0], qData);
                else batch.forEach(sym => processQuote(sym, qData[sym]));
              }
            } catch(e) {}
          }
        }
      }
    } catch (e) {
      console.error("Twelve Data error:", e.message);
    }
  }

  // ── KAYNAK 2: Finnhub (eksik semboller için backup) ──
  if (FINNHUB_KEY) {
    const missing = symList.filter(s => !results[s]);
    for (const sym of missing) {
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const d = await r.json();
          if (d.c && d.c > 0) {
            results[sym] = {
              usd: d.c,
              usd_24h_change: d.pc > 0 ? ((d.c - d.pc) / d.pc) * 100 : 0,
              source: "finnhub"
            };
          }
        }
      } catch (e) {}
      // Finnhub rate limit: 60/dk → küçük bekleme
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // ── KAYNAK 3: FMP (son çare) ──
  const stillMissing = symList.filter(s => !results[s]);
  if (stillMissing.length > 0) {
    const FMP_KEY = process.env.FMP_KEY || "00rEssEWw276o3NRJY1BcLH1ACQGb1D6";
    for (let i = 0; i < stillMissing.length; i += 50) {
      const batch = stillMissing.slice(i, i + 50);
      try {
        const url = `https://financialmodelingprep.com/api/v3/quote/${batch.join(",")}?apikey=${FMP_KEY}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data)) {
            data.forEach(q => {
              if (q.symbol && q.price > 0) {
                results[q.symbol] = {
                  usd: q.price,
                  usd_24h_change: q.changesPercentage || 0,
                  usd_market_cap: q.marketCap || 0,
                  source: "fmp"
                };
              }
            });
          }
        }
      } catch (e) {}
    }
  }

  const found = Object.keys(results).length;
  const sources = [...new Set(Object.values(results).map(r => r.source))];

  return res.status(200).json({
    results,
    meta: { requested: symList.length, found, sources, missing: symList.filter(s => !results[s]) }
  });
}
