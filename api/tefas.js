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

  // Tarih hesapla — haftasonu / tatil için 7 günlük aralık kullan
  const today = new Date();
  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 7); // Son 7 günlük veri

  // DD.MM.YYYY formatı (TEFAS bu formatı tercih eder)
  const fmtDate = (d) => {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  };

  // YYYY-MM-DD formatı (alternatif)
  const fmtDateISO = (d) => d.toISOString().split("T")[0];

  const tefasHeaders = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "tr-TR,tr;q=0.9",
    "Origin": "https://www.tefas.gov.tr",
    "Referer": "https://www.tefas.gov.tr/TarihselVeriler.aspx",
    "X-Requested-With": "XMLHttpRequest",
  };

  for (const sym of symList.slice(0, 30)) {
    const fundCode = sym.replace(".TEFAS", "").toUpperCase();

    // Yöntem 1: BindHistoryInfo (DD.MM.YYYY formatıyla)
    try {
      const body = new URLSearchParams({
        fontip: "YAT",
        session: "0",
        fonkod: fundCode,
        baession: fmtDate(startDate),
        bession: fmtDate(endDate),
      });

      const response = await fetch("https://www.tefas.gov.tr/api/DB/BindHistoryInfo", {
        method: "POST",
        headers: tefasHeaders,
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.data?.length > 0) {
          // En son değeri al
          const entries = data.data.sort((a, b) => {
            const parseDate = (s) => {
              if (!s) return 0;
              // DD.MM.YYYY or YYYY-MM-DD
              if (s.includes(".")) {
                const [dd, mm, yyyy] = s.split(".");
                return new Date(`${yyyy}-${mm}-${dd}`).getTime();
              }
              return new Date(s).getTime();
            };
            return parseDate(a.TARIH || a.Tarih) - parseDate(b.TARIH || b.Tarih);
          });

          const latest = entries[entries.length - 1];
          const prev = entries.length > 1 ? entries[entries.length - 2] : null;

          const price = parseFloat(latest?.FIYAT || latest?.ToplamDeger || latest?.BirimPayDegeri || 0);
          const prevPrice = prev ? parseFloat(prev?.FIYAT || prev?.ToplamDeger || prev?.BirimPayDegeri || price) : price;
          const changePct = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;

          if (price > 0) {
            results.push({
              symbol: sym,
              fundCode,
              price,
              changesPercentage: changePct,
              currency: "TRY",
              name: latest?.FONUNVAN || latest?.FonUnvan || fundCode,
            });
            continue; // Bu sembol başarılı, sonrakine geç
          }
        }
      }
    } catch (e) {
      console.log(`TEFAS BindHistoryInfo ${fundCode} failed:`, e.message);
    }

    // Yöntem 2: ISO tarih formatıyla dene
    try {
      const body = new URLSearchParams({
        fontip: "YAT",
        session: "0",
        fonkod: fundCode,
        baession: fmtDateISO(startDate),
        bession: fmtDateISO(endDate),
      });

      const response = await fetch("https://www.tefas.gov.tr/api/DB/BindHistoryInfo", {
        method: "POST",
        headers: tefasHeaders,
        body: body.toString(),
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.data?.length > 0) {
          const latest = data.data[data.data.length - 1];
          const prev = data.data.length > 1 ? data.data[data.data.length - 2] : null;
          const price = parseFloat(latest?.FIYAT || latest?.ToplamDeger || latest?.BirimPayDegeri || 0);
          const prevPrice = prev ? parseFloat(prev?.FIYAT || prev?.ToplamDeger || prev?.BirimPayDegeri || price) : price;
          const changePct = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;

          if (price > 0) {
            results.push({
              symbol: sym,
              fundCode,
              price,
              changesPercentage: changePct,
              currency: "TRY",
              name: latest?.FONUNVAN || latest?.FonUnvan || fundCode,
            });
            continue;
          }
        }
      }
    } catch (e) {
      console.log(`TEFAS ISO ${fundCode} failed:`, e.message);
    }

    // Yöntem 3: BindHistoryAllocation (fon dağılımı endpoint'i)
    try {
      const body = new URLSearchParams({ fontip: "YAT", fonkod: fundCode });
      const response = await fetch("https://www.tefas.gov.tr/api/DB/BindHistoryAllocation", {
        method: "POST",
        headers: tefasHeaders,
        body: body.toString(),
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = await response.json();
        const d = data?.data?.[0];
        if (d) {
          const price = parseFloat(d?.ToplamDeger || d?.FIYAT || 0);
          if (price > 0) {
            results.push({
              symbol: sym,
              fundCode,
              price,
              changesPercentage: 0,
              currency: "TRY",
              name: d?.FonUnvan || fundCode,
            });
          }
        }
      }
    } catch (e) {
      console.log(`TEFAS Allocation ${fundCode} failed:`, e.message);
    }
  }

  return res.status(200).json({ results, count: results.length });
}
