// ═══ InvestPulse Theme System ═══

// ── Logo SVG ──
export const LogoSVG = ({ size = 32, color }) => {
  const c = color || "currentColor";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <defs>
      <linearGradient id="ipGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#9333EA;stop-opacity:1"/>
        <stop offset="100%" style="stop-color:#D4A017;stop-opacity:1"/>
      </linearGradient>
    </defs>
    <circle cx="${size/2}" cy="${size/2}" r="${size/2-1}" fill="none" stroke="url(#ipGrad)" stroke-width="2"/>
    <path d="M${size*.25} ${size*.55} L${size*.4} ${size*.35} L${size*.55} ${size*.5} L${size*.75} ${size*.25}" fill="none" stroke="url(#ipGrad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${size*.75}" cy="${size*.25}" r="2.5" fill="#D4A017"/>
  </svg>`;
};

// ── Tema Tanımları ──
export const themes = {
  dark: {
    name: "Koyu",
    bg: "#0B0D15",
    bgSecondary: "#12141E",
    bgCard: "linear-gradient(135deg, #14162280, #1A1C2880)",
    bgCardSolid: "#151720",
    bgInput: "#0E1018",
    border: "#1E2035",
    borderLight: "#2A2D45",
    text: "#E8E9ED",
    textSecondary: "#8B8EA0",
    textMuted: "#4A4D65",
    accent: "#9333EA",       // Mor (primary)
    accentLight: "#A855F7",
    accentGlow: "rgba(147, 51, 234, 0.15)",
    gold: "#D4A017",         // Altın (secondary)
    goldLight: "#E5B829",
    goldGlow: "rgba(212, 160, 23, 0.15)",
    green: "#22C55E",
    greenGlow: "rgba(34, 197, 94, 0.12)",
    red: "#EF4444",
    redGlow: "rgba(239, 68, 68, 0.12)",
    gradientPrimary: "linear-gradient(135deg, #9333EA, #D4A017)",
    gradientCard: "linear-gradient(135deg, #14162280, #1A1C2880)",
    gradientHero: "linear-gradient(135deg, #1A0D2E, #0B0D15, #1A1508)",
    shadow: "0 4px 24px rgba(0,0,0,.3)",
    shadowGlow: "0 0 20px rgba(147, 51, 234, 0.1)",
    glass: "rgba(20, 22, 34, 0.6)",
    glassBorder: "rgba(255,255,255,0.05)",
    headerBg: "rgba(11, 13, 21, 0.92)",
  },
  light: {
    name: "Açık",
    bg: "#F8F9FC",
    bgSecondary: "#FFFFFF",
    bgCard: "linear-gradient(135deg, #FFFFFF, #F3F4F8)",
    bgCardSolid: "#FFFFFF",
    bgInput: "#F1F2F6",
    border: "#E2E4ED",
    borderLight: "#D1D4E0",
    text: "#1A1C28",
    textSecondary: "#5A5D72",
    textMuted: "#9498B0",
    accent: "#7C3AED",
    accentLight: "#8B5CF6",
    accentGlow: "rgba(124, 58, 237, 0.1)",
    gold: "#B8860B",
    goldLight: "#D4A017",
    goldGlow: "rgba(184, 134, 11, 0.1)",
    green: "#16A34A",
    greenGlow: "rgba(22, 163, 74, 0.08)",
    red: "#DC2626",
    redGlow: "rgba(220, 38, 38, 0.08)",
    gradientPrimary: "linear-gradient(135deg, #7C3AED, #B8860B)",
    gradientCard: "linear-gradient(135deg, #FFFFFF, #F3F4F8)",
    gradientHero: "linear-gradient(135deg, #F0E6FF, #F8F9FC, #FFF8E6)",
    shadow: "0 4px 24px rgba(0,0,0,.06)",
    shadowGlow: "0 0 20px rgba(124, 58, 237, 0.06)",
    glass: "rgba(255, 255, 255, 0.8)",
    glassBorder: "rgba(0,0,0,0.06)",
    headerBg: "rgba(248, 249, 252, 0.92)",
  }
};

// ── Market Renkleri (temadan bağımsız) ──
export const marketColors = {
  crypto: "#D4A017",
  bist: "#3B82F6",
  us: "#9333EA",
  tefas: "#06B6D4",
};

// ── Pie Chart Renkleri ──
export const chartColors = [
  "#9333EA","#D4A017","#3B82F6","#22C55E","#EF4444","#06B6D4",
  "#EC4899","#F97316","#8B5CF6","#14B8A6","#F43F5E","#6366F1",
  "#84CC16","#A855F7","#0EA5E9","#F59E0B","#10B981","#E879F9",
  "#38BDF8","#FB923C",
];

// ── CSS Animasyonları ──
export const animations = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap');
  
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  @keyframes fadeUp { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }
  @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
  @keyframes slideUp { from { opacity:0; transform:translateY(100%) } to { opacity:1; transform:translateY(0) } }
  @keyframes scaleIn { from { opacity:0; transform:scale(0.9) } to { opacity:1; transform:scale(1) } }
  @keyframes pulse { 0%,100%{ opacity:1 } 50%{ opacity:.6 } }
  @keyframes shimmer { 0%{ background-position:200% 0 } 100%{ background-position:-200% 0 } }
  @keyframes glow { 0%,100%{ box-shadow:0 0 5px rgba(147,51,234,.2) } 50%{ box-shadow:0 0 20px rgba(147,51,234,.4) } }
  @keyframes spin { from{ transform:rotate(0deg) } to{ transform:rotate(360deg) } }
  @keyframes skeletonPulse { 0%,100%{ opacity:.08 } 50%{ opacity:.18 } }
  @keyframes loadBar { 0%{ width:0 } 50%{ width:70% } 100%{ width:100% } }
  @keyframes gradientFlow { 
    0%{ background-position:0% 50% }
    50%{ background-position:100% 50% }
    100%{ background-position:0% 50% }
  }
  @keyframes pulseRing {
    0% { transform:scale(0.8); opacity:0.8 }
    100% { transform:scale(2.5); opacity:0 }
  }
  @keyframes drawLine {
    from { stroke-dashoffset: 100 }
    to { stroke-dashoffset: 0 }
  }
  @keyframes countUp {
    from { opacity:0; transform:translateY(10px) }
    to { opacity:1; transform:translateY(0) }
  }
  @keyframes float {
    0%,100% { transform:translateY(0px) }
    50% { transform:translateY(-8px) }
  }
  
  ::-webkit-scrollbar { width:6px }
  ::-webkit-scrollbar-track { background:transparent }
  ::-webkit-scrollbar-thumb { background:#2A2D45; border-radius:3px }
  ::-webkit-scrollbar-thumb:hover { background:#3A3D55 }
  table { border-collapse:collapse }
  select option { background:#151720; color:#E8E9ED }
`;

// ── Splash Screen Component ──
export const SPLASH_DURATION = 2800;
