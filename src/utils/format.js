// ═══ Formatlama Utility'leri ═══

export const fmt = (v, d = 2, cur = "$") => {
  if (v == null) return cur + "0.00";
  if (v >= 1e9) return `${cur}${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${cur}${(v / 1e6).toFixed(2)}M`;
  return `${cur}${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

export const fmtTRY = (v, d = 2) => fmt(v, d, "₺");

export const fPct = (v) => v == null ? "0.00%" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

export const genChart = (base, days = 30) => {
  const d = [];
  let p = base * .85;
  for (let i = days; i >= 0; i--) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    p *= (1 + (Math.random() - .48) * .06);
    d.push({ date: dt.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }), price: +p.toFixed(2) });
  }
  return d;
};
