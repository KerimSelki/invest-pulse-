// /api/tefas.js — Vercel Serverless Function
// TEFAS fon fiyatlarını tefas.gov.tr'den çeker

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "symbols parameter required" });

  const symList = symbols.split(",").map(s => s.trim()).filter(Boolean);
  const results = [];

  // TEFAS API — her fon için ayrı çağrı
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0]; // 2026-02-27
  const yesterday = new Date(today - 86400000).toISOString().split("T")[0];

  for (const sym of symList.slice(0, 30)) {
    // sym format: "IPB.TEFAS" → fund code: "IPB"
    const fundCode = sym.replace(".TEFAS", "");
    
    try {
      // TEFAS public API
      const url = `https://www.tefas.gov.tr/api/DB/BindHistoryInfo`;
      const body = new URLSearchParams({
        fontip: "YAT",
        session: "true",
        fonkod: fundCode,
        baession: yesterday,
        bession: dateStr,
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Origin": "https://www.tefas.gov.tr",
          "Referer": "https://www.tefas.gov.tr/TarihselVeriler.aspx",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.data?.length > 0) {
          const latest = data.data[data.data.length - 1];
          const prev = data.data.length > 1 ? data.data[data.data.length - 2] : null;
          const price = latest?.ToplamDeger || 0;
          const prevPrice = prev?.ToplamDeger || price;
          const changePct = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;

          results.push({
            symbol: sym,
            fundCode,
            price,
            changesPercentage: changePct,
            currency: "TRY",
            name: latest?.FonUnvan || fundCode,
          });
        }
      }
    } catch (e) {
      console.log(`TEFAS ${fundCode} failed:`, e.message);
    }
  }

  // Fallback: FMP API for any that failed (some TEFAS funds might be on FMP)
  if (results.length < symList.length) {
    const fetched = new Set(results.map(r => r.symbol));
    const missing = symList.filter(s => !fetched.has(s));
    
    // Try alternative TEFAS endpoint
    for (const sym of missing.slice(0, 10)) {
      const fundCode = sym.replace(".TEFAS", "");
      try {
        const url = `https://www.tefas.gov.tr/api/DB/BindHistoryAllocation`;
        const body = new URLSearchParams({ fontip: "YAT", fonkod: fundCode });
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0",
            "Origin": "https://www.tefas.gov.tr",
            "Referer": "https://www.tefas.gov.tr/",
          },
          body: body.toString(),
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const data = await response.json();
          if (data?.data?.[0]) {
            results.push({
              symbol: sym,
              fundCode,
              price: data.data[0]?.ToplamDeger || 0,
              changesPercentage: 0,
              currency: "TRY",
              name: fundCode,
            });
          }
        }
      } catch (e) {}
    }
  }

  return res.status(200).json({ results, count: results.length });
}
