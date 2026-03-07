#!/usr/bin/env python3
"""Trade Journal - InvestPulse'a Trade tab'ı ekler"""
import re

with open('src/App.js', 'r') as f:
    code = f.read()

# 1. Tab listesine "Trade" ekle
old_tabs = '{id:"overview",lbl:"Dashboard",ic:"⊞"},{id:"portfolio",lbl:"Portföy",ic:"◎"},{id:"reports",lbl:"Raporlar",ic:"📄"}'
new_tabs = '{id:"overview",lbl:"Dashboard",ic:"⊞"},{id:"portfolio",lbl:"Portföy",ic:"◎"},{id:"trade",lbl:"Trade",ic:"📈"},{id:"reports",lbl:"Raporlar",ic:"📄"}'
if old_tabs in code:
    code = code.replace(old_tabs, new_tabs)
    print("1. Tab eklendi")
else:
    print("1. HATA: Tab bulunamadi")

# 2. Trade state'leri ekle - "const [tab, setTab]" satırından sonra
trade_states = '''
  // ═══ TRADE JOURNAL STATE ═══
  const [trades, setTrades] = useState(() => { try { return JSON.parse(localStorage.getItem("ip_trades") || "[]"); } catch(e) { return []; } });
  const [tradeView, setTradeView] = useState("list"); // list | add | analytics | goals
  const [tradeFilter, setTradeFilter] = useState("all"); // all | open | closed | win | loss
  const [tradeSearch, setTradeSearch] = useState("");
  const [tradeKasa, setTradeKasa] = useState(() => { try { return parseFloat(localStorage.getItem("ip_trade_kasa") || "5000"); } catch(e) { return 5000; } });
  const [goals, setGoals] = useState(() => { try { return JSON.parse(localStorage.getItem("ip_goals") || "[]"); } catch(e) { return []; } });
  const [editTrade, setEditTrade] = useState(null);
  const [newTrade, setNewTrade] = useState({symbol:"",market:"Kripto",exchange:"Bybit",direction:"Long",status:"Acik",leverage:"1x",entryPrice:"",exitPrice:"",amount:"100",stopLoss:"",tp1:"",tp2:"",tp3:"",entryDate:new Date().toISOString().slice(0,16),exitDate:"",strategy:"",tags:"",notes:"",score:5,setupQuality:"B Orta",execution:5,followedPlan:true,setupType:"",emotion:"",mistakes:"",successes:"",lessons:""});

  // Trade localStorage sync
  useEffect(() => { try { localStorage.setItem("ip_trades", JSON.stringify(trades)); } catch(e) {} }, [trades]);
  useEffect(() => { try { localStorage.setItem("ip_trade_kasa", String(tradeKasa)); } catch(e) {} }, [tradeKasa]);
  useEffect(() => { try { localStorage.setItem("ip_goals", JSON.stringify(goals)); } catch(e) {} }, [goals]);

  // Trade helper functions
  const calcPnl = (t) => { if (!t.entryPrice || !t.exitPrice) return 0; const e=parseFloat(t.entryPrice),x=parseFloat(t.exitPrice),a=parseFloat(t.amount)||100,l=parseFloat(t.leverage)||1; return t.direction==="Long"?(x-e)/e*a*l:(e-x)/e*a*l; };
  const calcPnlPct = (t) => { if (!t.entryPrice || !t.exitPrice) return 0; const e=parseFloat(t.entryPrice),x=parseFloat(t.exitPrice),l=parseFloat(t.leverage)||1; return t.direction==="Long"?(x-e)/e*100*l:(e-x)/e*100*l; };
  const closedTrades = trades.filter(t=>t.status==="Kapali");
  const winTrades = closedTrades.filter(t=>calcPnl(t)>0);
  const lossTrades = closedTrades.filter(t=>calcPnl(t)<0);
  const totalPnl = closedTrades.reduce((s,t)=>s+calcPnl(t),0);
  const winRate = closedTrades.length>0?(winTrades.length/closedTrades.length*100):0;
  const avgWin = winTrades.length>0?winTrades.reduce((s,t)=>s+calcPnl(t),0)/winTrades.length:0;
  const avgLoss = lossTrades.length>0?Math.abs(lossTrades.reduce((s,t)=>s+calcPnl(t),0)/lossTrades.length):0;
  const profitFactor = avgLoss>0?(avgWin*winTrades.length)/(avgLoss*lossTrades.length):0;
  const maxDrawdown = (() => { let peak=0,dd=0,maxDd=0; closedTrades.sort((a,b)=>new Date(a.exitDate)-new Date(b.exitDate)).forEach(t=>{const eq=peak+calcPnl(t);if(eq>peak)peak=eq;dd=peak-eq;if(dd>maxDd)maxDd=dd;}); return maxDd; })();

  const resetNewTrade = () => setNewTrade({symbol:"",market:"Kripto",exchange:"Bybit",direction:"Long",status:"Acik",leverage:"1x",entryPrice:"",exitPrice:"",amount:"100",stopLoss:"",tp1:"",tp2:"",tp3:"",entryDate:new Date().toISOString().slice(0,16),exitDate:"",strategy:"",tags:"",notes:"",score:5,setupQuality:"B Orta",execution:5,followedPlan:true,setupType:"",emotion:"",mistakes:"",successes:"",lessons:""});

  const saveTrade = () => {
    const t = editTrade !== null ? {...newTrade, id: trades[editTrade].id} : {...newTrade, id: Date.now()};
    if (!t.symbol.trim()) return;
    if (editTrade !== null) { const updated=[...trades]; updated[editTrade]=t; setTrades(updated); }
    else setTrades(prev=>[t,...prev]);
    resetNewTrade(); setEditTrade(null); setTradeView("list");
  };

  const deleteTrade = (idx) => { setTrades(prev=>prev.filter((_,i)=>i!==idx)); };

  const filteredTrades = trades.filter(t => {
    if (tradeFilter==="open" && t.status!=="Acik") return false;
    if (tradeFilter==="closed" && t.status!=="Kapali") return false;
    if (tradeFilter==="win" && (t.status!=="Kapali" || calcPnl(t)<=0)) return false;
    if (tradeFilter==="loss" && (t.status!=="Kapali" || calcPnl(t)>=0)) return false;
    if (tradeSearch && !t.symbol.toLowerCase().includes(tradeSearch.toLowerCase()) && !t.notes?.toLowerCase().includes(tradeSearch.toLowerCase()) && !t.tags?.toLowerCase().includes(tradeSearch.toLowerCase())) return false;
    return true;
  });

  const equityData = (() => { let eq=0; return closedTrades.sort((a,b)=>new Date(a.exitDate||a.entryDate)-new Date(b.exitDate||b.entryDate)).map(t=>{eq+=calcPnl(t);return {date:new Date(t.exitDate||t.entryDate).toLocaleDateString("tr-TR",{day:"2-digit",month:"short"}),equity:+eq.toFixed(2),pnl:+calcPnl(t).toFixed(2)};});})();
'''

# "const [tab, setTab]" bul ve sonrasına ekle
tab_match = re.search(r'const \[tab, setTab\] = useState\([^)]+\);', code)
if tab_match:
    insert_pos = tab_match.end()
    code = code[:insert_pos] + trade_states + code[insert_pos:]
    print("2. Trade state'leri eklendi")
else:
    print("2. HATA: tab state bulunamadi")

# 3. Trade Journal tab içeriğini ekle - reports tab'ından önce
trade_tab_ui = '''
        {/* ═══ TRADE JOURNAL ═══ */}
        {tab==="trade"&&<div style={{animation:"fadeUp .4s ease-out"}}>
          {/* Trade Header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontSize:20,fontWeight:700,color:T.text}}>Trade Journal</div>
              <div style={{fontSize:13,color:T.textMuted}}>{trades.length} trade • Toplam K/Z <span style={{color:totalPnl>=0?T.green:T.red,fontWeight:600}}>${totalPnl.toFixed(2)}</span></div>
            </div>
            <div style={{display:"flex",gap:8}}>
              {[{v:"list",l:"Geçmiş",ic:"☰"},{v:"add",l:"Yeni Trade",ic:"+"},{v:"analytics",l:"Analitik",ic:"📊"},{v:"goals",l:"Hedefler",ic:"◎"}].map(v=>
                <button key={v.v} onClick={()=>{setTradeView(v.v);if(v.v==="add"){resetNewTrade();setEditTrade(null);}}} style={{padding:"8px 16px",background:tradeView===v.v?"linear-gradient(135deg,#9333EA,#D4A017)":T.bgCard,border:`1px solid ${tradeView===v.v?T.accent+"44":T.border}`,color:tradeView===v.v?"#fff":T.textSecondary,fontSize:12,fontWeight:600,cursor:"pointer",borderRadius:8,fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",gap:4}}>{v.ic} {v.l}</button>
              )}
            </div>
          </div>

          {/* ═══ TRADE LIST ═══ */}
          {tradeView==="list"&&<>
            {/* Kasa & Filtreler */}
            <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 12px"}}>
                <span style={{fontSize:11,color:T.textMuted}}>Kasa:</span>
                <input value={tradeKasa} onChange={e=>setTradeKasa(parseFloat(e.target.value)||0)} style={{width:80,background:"transparent",border:"none",color:T.gold,fontSize:13,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",outline:"none"}} />
                <span style={{fontSize:11,color:T.textMuted}}>USDT</span>
              </div>
              <input value={tradeSearch} onChange={e=>setTradeSearch(e.target.value)} placeholder="Sembol, not, etiket ara..." style={{flex:1,minWidth:150,padding:"8px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'Inter',sans-serif"}} />
              <div style={{display:"flex",gap:4}}>
                {[{f:"all",l:"Tümü"},{f:"open",l:"Açık"},{f:"closed",l:"Kapalı"},{f:"win",l:"Kazanç"},{f:"loss",l:"Kayıp"}].map(f=>
                  <button key={f.f} onClick={()=>setTradeFilter(f.f)} style={{padding:"6px 10px",background:tradeFilter===f.f?T.accentGlow:"transparent",border:`1px solid ${tradeFilter===f.f?T.accent+"33":"transparent"}`,color:tradeFilter===f.f?T.accent:T.textMuted,fontSize:11,fontWeight:600,cursor:"pointer",borderRadius:6,fontFamily:"'Inter',sans-serif"}}>{f.l}</button>
                )}
              </div>
            </div>

            {/* Trade Listesi */}
            {filteredTrades.length===0?
              <div style={{...st.card,padding:60,textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>📈</div><div style={{fontSize:16,fontWeight:600,color:T.text,marginBottom:4}}>Henüz trade yok</div><div style={{fontSize:13,color:T.textMuted,marginBottom:16}}>İlk tradeni ekleyerek başla</div><button onClick={()=>{setTradeView("add");resetNewTrade();setEditTrade(null);}} style={{padding:"10px 24px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>İlk Tradeni Ekle</button></div>
            :
              <div style={{...st.card,padding:0,overflow:"hidden"}}><div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>
                  {["Sembol","Yön","Giriş","Çıkış","Miktar","K/Z","K/Z%","Durum","Puan",""].map(h=><th key={h} style={{...st.th,textAlign:h===""?"center":"left",padding:"10px 8px"}}>{h}</th>)}
                </tr></thead><tbody>
                {filteredTrades.map((t,i)=>{
                  const pnl=calcPnl(t);const pnlPct=calcPnlPct(t);const isWin=pnl>0;
                  return <tr key={t.id||i} style={{borderBottom:`1px solid ${T.border}`}}>
                    <td style={{padding:"10px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:"'JetBrains Mono',monospace"}}>{t.symbol}</span><span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:t.market==="Kripto"?"#F7931A18":"#3b82f618",color:t.market==="Kripto"?"#F7931A":"#3b82f6",fontWeight:700}}>{t.market}</span></div><div style={{fontSize:10,color:T.textMuted}}>{t.exchange} • {t.leverage}</div></td>
                    <td style={{padding:"10px 8px"}}><span style={{fontSize:11,padding:"3px 8px",borderRadius:4,background:t.direction==="Long"?"#22C55E18":"#EF444418",color:t.direction==="Long"?"#22C55E":"#EF4444",fontWeight:700}}>{t.direction}</span></td>
                    <td style={{padding:"10px 8px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:T.text}}>${parseFloat(t.entryPrice||0).toFixed(2)}</td>
                    <td style={{padding:"10px 8px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:t.exitPrice?T.text:T.textMuted}}>{t.exitPrice?"$"+parseFloat(t.exitPrice).toFixed(2):"—"}</td>
                    <td style={{padding:"10px 8px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:T.text}}>${parseFloat(t.amount||0).toFixed(0)}</td>
                    <td style={{padding:"10px 8px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,color:t.status==="Kapali"?(isWin?T.green:T.red):T.textMuted}}>{t.status==="Kapali"?(isWin?"+":"")+pnl.toFixed(2):"—"}</td>
                    <td style={{padding:"10px 8px",fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:t.status==="Kapali"?(isWin?T.green:T.red):T.textMuted}}>{t.status==="Kapali"?(isWin?"+":"")+pnlPct.toFixed(2)+"%":"—"}</td>
                    <td style={{padding:"10px 8px"}}><span style={{fontSize:10,padding:"3px 8px",borderRadius:4,background:t.status==="Acik"?"#EAB30818":"#4A4D6518",color:t.status==="Acik"?"#EAB308":"#8B8EA0",fontWeight:600}}>{t.status==="Acik"?"Açık":"Kapalı"}</span></td>
                    <td style={{padding:"10px 8px",textAlign:"center"}}><span style={{fontSize:12,fontWeight:700,color:t.score>=7?T.green:t.score>=4?T.gold:T.red}}>{t.score}/10</span></td>
                    <td style={{padding:"10px 8px",textAlign:"center"}}><div style={{display:"flex",gap:4,justifyContent:"center"}}><button onClick={()=>{setNewTrade({...t});setEditTrade(i);setTradeView("add");}} style={{width:26,height:26,border:`1px solid ${T.borderLight}`,background:T.bgCardSolid,color:T.textSecondary,borderRadius:5,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✎</button><button onClick={()=>deleteTrade(i)} style={{width:26,height:26,border:`1px solid ${T.red}33`,background:T.redGlow,color:T.red,borderRadius:5,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div></td>
                  </tr>;
                })}
                </tbody></table>
              </div></div>
            }
          </>}

          {/* ═══ ADD/EDIT TRADE ═══ */}
          {tradeView==="add"&&<div>
            <div style={{display:"grid",gap:16}}>
              {/* Risk Yönetimi */}
              <div style={{...st.card,borderLeft:`3px solid ${T.gold}`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>🛡 Risk Yönetimi</div>
                <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Toplam Kasa (USDT)</div><input value={tradeKasa} onChange={e=>setTradeKasa(parseFloat(e.target.value)||0)} style={{padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.gold,fontSize:14,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",outline:"none",width:150}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Risk % (Kasanın)</div><div style={{display:"flex",gap:4}}>{["0.5","1","1.5","2","3","5"].map(r=><button key={r} onClick={()=>setNewTrade(p=>({...p,amount:String((tradeKasa*parseFloat(r)/100).toFixed(2))}))} style={{padding:"6px 10px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:6,color:T.text,fontSize:11,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>%{r}</button>)}</div></div>
                </div>
              </div>

              {/* Trade Bilgileri */}
              <div style={{...st.card,borderLeft:`3px solid ${T.accent}`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>📈 Trade Bilgileri</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Sembol</div><input value={newTrade.symbol} onChange={e=>setNewTrade(p=>({...p,symbol:e.target.value.toUpperCase()}))} placeholder="BTC/USDT" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'Inter',sans-serif"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Piyasa Türü</div><select value={newTrade.market} onChange={e=>setNewTrade(p=>({...p,market:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option>Kripto</option><option>Forex</option><option>Hisse</option><option>Emtia</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Borsa</div><select value={newTrade.exchange} onChange={e=>setNewTrade(p=>({...p,exchange:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option>Bybit</option><option>Binance</option><option>OKX</option><option>Gate.io</option><option>Coinbase</option><option>Diger</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Yön</div><div style={{display:"flex",gap:6}}>{["Long","Short"].map(d=><button key={d} onClick={()=>setNewTrade(p=>({...p,direction:d}))} style={{flex:1,padding:"10px",background:newTrade.direction===d?(d==="Long"?"#22C55E18":"#EF444418"):T.bgInput,border:`1px solid ${newTrade.direction===d?(d==="Long"?"#22C55E44":"#EF444444"):T.border}`,borderRadius:8,color:newTrade.direction===d?(d==="Long"?"#22C55E":"#EF4444"):T.textMuted,fontSize:13,fontWeight:600,cursor:"pointer"}}>{d}</button>)}</div></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Durum</div><select value={newTrade.status} onChange={e=>setNewTrade(p=>({...p,status:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option value="Acik">Açık</option><option value="Kapali">Kapalı</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Kaldıraç</div><select value={newTrade.leverage} onChange={e=>setNewTrade(p=>({...p,leverage:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}>{["1x","2x","3x","5x","10x","20x","25x","50x","75x","100x","125x"].map(l=><option key={l}>{l}</option>)}</select></div>
                </div>
              </div>

              {/* Fiyat & Pozisyon */}
              <div style={{...st.card,borderLeft:`3px solid #3b82f6`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>💲 Fiyat & Pozisyon</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Giriş Fiyatı</div><input type="number" value={newTrade.entryPrice} onChange={e=>setNewTrade(p=>({...p,entryPrice:e.target.value}))} placeholder="0.00" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Çıkış Fiyatı</div><input type="number" value={newTrade.exitPrice} onChange={e=>setNewTrade(p=>({...p,exitPrice:e.target.value}))} placeholder="0.00" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Kontrat Miktarı (USDT)</div><input type="number" value={newTrade.amount} onChange={e=>setNewTrade(p=>({...p,amount:e.target.value}))} placeholder="100" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                </div>
              </div>

              {/* SL & TP */}
              <div style={{...st.card,borderLeft:`3px solid #10b981`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>🎯 Stop Loss & Take Profit</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Stop Loss</div><input type="number" value={newTrade.stopLoss} onChange={e=>setNewTrade(p=>({...p,stopLoss:e.target.value}))} placeholder="0.00" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.red}33`,borderRadius:8,color:T.red,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Take Profit 1</div><input type="number" value={newTrade.tp1} onChange={e=>setNewTrade(p=>({...p,tp1:e.target.value}))} placeholder="0.00" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.green}33`,borderRadius:8,color:T.green,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Take Profit 2</div><input type="number" value={newTrade.tp2} onChange={e=>setNewTrade(p=>({...p,tp2:e.target.value}))} placeholder="Opsiyonel" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Take Profit 3</div><input type="number" value={newTrade.tp3} onChange={e=>setNewTrade(p=>({...p,tp3:e.target.value}))} placeholder="Opsiyonel" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",fontFamily:"'JetBrains Mono',monospace"}} /></div>
                </div>
              </div>

              {/* Tarihler */}
              <div style={{...st.card,borderLeft:`3px solid #8B5CF6`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>📅 Tarihler</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Giriş Tarihi</div><input type="datetime-local" value={newTrade.entryDate} onChange={e=>setNewTrade(p=>({...p,entryDate:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}} /></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Çıkış Tarihi</div><input type="datetime-local" value={newTrade.exitDate} onChange={e=>setNewTrade(p=>({...p,exitDate:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}} /></div>
                </div>
              </div>

              {/* Notlar & Strateji */}
              <div style={{...st.card,borderLeft:`3px solid #F59E0B`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>📝 Notlar & Strateji</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Strateji</div><select value={newTrade.strategy} onChange={e=>setNewTrade(p=>({...p,strategy:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option value="">Strateji seç...</option><option>Breakout</option><option>Pullback</option><option>Trend Following</option><option>Range</option><option>Scalp</option><option>Swing</option><option>News</option><option>Diger</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Etiketler</div><input value={newTrade.tags} onChange={e=>setNewTrade(p=>({...p,tags:e.target.value}))} placeholder="scalp, haber, kırılım" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}} /></div>
                </div>
                <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Notlar</div><textarea value={newTrade.notes} onChange={e=>setNewTrade(p=>({...p,notes:e.target.value}))} placeholder="Trade sebebi, piyasa koşulları, öğrenilen dersler..." rows={3} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none",resize:"vertical",fontFamily:"'Inter',sans-serif"}} /></div>
              </div>

              {/* Trade Analizi / Puanlama */}
              <div style={{...st.card,borderLeft:`3px solid #EC4899`}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>⭐ Trade Puanlama</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Genel Trade Puanı (1-10)</div><div style={{display:"flex",gap:4}}>{[1,2,3,4,5,6,7,8,9,10].map(n=><button key={n} onClick={()=>setNewTrade(p=>({...p,score:n}))} style={{width:30,height:30,borderRadius:6,border:`1px solid ${newTrade.score===n?T.accent+"66":T.border}`,background:newTrade.score===n?T.accentGlow:T.bgInput,color:newTrade.score===n?T.accent:T.textMuted,fontSize:12,fontWeight:700,cursor:"pointer"}}>{n}</button>)}</div></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Setup Kalitesi</div><div style={{display:"flex",gap:4}}>{["A+ Mükemmel","A İyi","B Orta","C Zayıf"].map(q=><button key={q} onClick={()=>setNewTrade(p=>({...p,setupQuality:q}))} style={{padding:"8px 12px",borderRadius:6,border:`1px solid ${newTrade.setupQuality===q?T.accent+"66":T.border}`,background:newTrade.setupQuality===q?T.accentGlow:T.bgInput,color:newTrade.setupQuality===q?T.accent:T.textMuted,fontSize:11,fontWeight:600,cursor:"pointer"}}>{q}</button>)}</div></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Execution Puanı (1-10)</div><div style={{display:"flex",gap:4}}>{[1,2,3,4,5,6,7,8,9,10].map(n=><button key={n} onClick={()=>setNewTrade(p=>({...p,execution:n}))} style={{width:30,height:30,borderRadius:6,border:`1px solid ${newTrade.execution===n?T.gold+"66":T.border}`,background:newTrade.execution===n?"#D4A01718":T.bgInput,color:newTrade.execution===n?T.gold:T.textMuted,fontSize:12,fontWeight:700,cursor:"pointer"}}>{n}</button>)}</div></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Plana Uyuldu mu?</div><div style={{display:"flex",gap:8}}>{[{v:true,l:"✓ Evet"},{v:false,l:"✕ Hayır"}].map(o=><button key={String(o.v)} onClick={()=>setNewTrade(p=>({...p,followedPlan:o.v}))} style={{flex:1,padding:"10px",borderRadius:8,border:`1px solid ${newTrade.followedPlan===o.v?(o.v?T.green:T.red)+"44":T.border}`,background:newTrade.followedPlan===o.v?(o.v?"#22C55E18":"#EF444418"):T.bgInput,color:newTrade.followedPlan===o.v?(o.v?T.green:T.red):T.textMuted,fontSize:13,fontWeight:600,cursor:"pointer"}}>{o.l}</button>)}</div></div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12}}>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Duygu Durumu</div><select value={newTrade.emotion} onChange={e=>setNewTrade(p=>({...p,emotion:e.target.value}))} style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}}><option value="">Duygu seç...</option><option>Sakin</option><option>Heyecanlı</option><option>Korkulu</option><option>Açgözlü</option><option>Sabırsız</option><option>Kararsız</option><option>Güvenli</option></select></div>
                  <div><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Öğrenilen Dersler</div><input value={newTrade.lessons} onChange={e=>setNewTrade(p=>({...p,lessons:e.target.value}))} placeholder="Bu tradeden ne öğrendin?" style={{width:"100%",padding:"10px 12px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,outline:"none"}} /></div>
                </div>
              </div>

              {/* Kaydet */}
              <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
                <button onClick={()=>{resetNewTrade();setEditTrade(null);setTradeView("list");}} style={{padding:"12px 24px",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:10,color:T.textMuted,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>İptal</button>
                <button onClick={saveTrade} style={{padding:"12px 32px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:10,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif",boxShadow:"0 4px 20px rgba(147,51,234,.25)"}}>{editTrade!==null?"Güncelle":"Trade Kaydet"}</button>
              </div>
            </div>
          </div>}

          {/* ═══ ANALYTICS ═══ */}
          {tradeView==="analytics"&&<div>
            {/* Özet Kartları */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
              <div style={{...st.card,borderLeft:`3px solid ${totalPnl>=0?T.green:T.red}`}}><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Toplam K/Z</div><div style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:totalPnl>=0?T.green:T.red}}>${totalPnl.toFixed(2)}</div></div>
              <div style={{...st.card,borderLeft:`3px solid ${T.gold}`}}><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Kazanma Oranı</div><div style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.gold}}>{winRate.toFixed(1)}%</div></div>
              <div style={{...st.card,borderLeft:`3px solid ${T.accent}`}}><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Profit Factor</div><div style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:T.accent}}>{profitFactor.toFixed(2)}</div></div>
              <div style={{...st.card,borderLeft:`3px solid #8B5CF6`}}><div style={{fontSize:11,color:T.textMuted,marginBottom:4}}>Toplam Trade</div><div style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:"#8B5CF6"}}>{closedTrades.length}</div></div>
            </div>

            {/* Equity Eğrisi */}
            <div style={{...st.card,marginBottom:20}}>
              <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:12}}>Equity Eğrisi</div>
              {equityData.length>0?<ResponsiveContainer width="100%" height={260}>
                <AreaChart data={equityData}><defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.accent} stopOpacity={0.3}/><stop offset="100%" stopColor={T.accent} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={T.border} /><XAxis dataKey="date" tick={{fontSize:10,fill:T.textMuted}} /><YAxis tick={{fontSize:10,fill:T.textMuted}} tickFormatter={v=>"$"+v} />
                <Tooltip contentStyle={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,fontSize:12}} />
                <Area type="monotone" dataKey="equity" stroke={T.accent} fill="url(#eqGrad)" strokeWidth={2} /></AreaChart>
              </ResponsiveContainer>:<div style={{padding:40,textAlign:"center",color:T.textMuted}}>Kapalı trade verisi yok</div>}
            </div>

            {/* Detay Kartları */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>En İyi Trade</div><div style={{fontSize:16,fontWeight:700,color:T.green,fontFamily:"'JetBrains Mono',monospace"}}>${closedTrades.length>0?Math.max(...closedTrades.map(t=>calcPnl(t))).toFixed(2):"0.00"}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>En Kötü Trade</div><div style={{fontSize:16,fontWeight:700,color:T.red,fontFamily:"'JetBrains Mono',monospace"}}>${closedTrades.length>0?Math.min(...closedTrades.map(t=>calcPnl(t))).toFixed(2):"0.00"}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Ort. Kazanç</div><div style={{fontSize:16,fontWeight:700,color:T.green,fontFamily:"'JetBrains Mono',monospace"}}>${avgWin.toFixed(2)}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Ort. Kayıp</div><div style={{fontSize:16,fontWeight:700,color:T.red,fontFamily:"'JetBrains Mono',monospace"}}>${avgLoss.toFixed(2)}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Max Drawdown</div><div style={{fontSize:16,fontWeight:700,color:T.red,fontFamily:"'JetBrains Mono',monospace"}}>${maxDrawdown.toFixed(2)}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Risk/Ödül</div><div style={{fontSize:16,fontWeight:700,color:T.accent,fontFamily:"'JetBrains Mono',monospace"}}>{avgLoss>0?(avgWin/avgLoss).toFixed(2):"0.00"}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Beklenti</div><div style={{fontSize:16,fontWeight:700,color:T.gold,fontFamily:"'JetBrains Mono',monospace"}}>${closedTrades.length>0?(totalPnl/closedTrades.length).toFixed(2):"0.00"}</div></div>
              <div style={st.card}><div style={{fontSize:11,color:T.textMuted}}>Ort. Süre</div><div style={{fontSize:16,fontWeight:700,color:"#8B5CF6",fontFamily:"'JetBrains Mono',monospace"}}>{closedTrades.length>0?Math.round(closedTrades.reduce((s,t)=>{const d=t.exitDate&&t.entryDate?((new Date(t.exitDate)-new Date(t.entryDate))/3600000):0;return s+d;},0)/closedTrades.length)+"s":"0s"}</div></div>
            </div>
          </div>}

          {/* ═══ GOALS ═══ */}
          {tradeView==="goals"&&<div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
              <div style={{...st.card,borderLeft:`3px solid ${T.gold}`}}><div style={{fontSize:11,color:T.textMuted}}>Aktif Hedefler</div><div style={{fontSize:22,fontWeight:700,color:T.gold}}>{goals.filter(g=>g.status==="active").length}</div></div>
              <div style={{...st.card,borderLeft:`3px solid ${T.green}`}}><div style={{fontSize:11,color:T.textMuted}}>Tamamlanan</div><div style={{fontSize:22,fontWeight:700,color:T.green}}>{goals.filter(g=>g.status==="done").length}</div></div>
              <div style={{...st.card,borderLeft:`3px solid ${T.red}`}}><div style={{fontSize:11,color:T.textMuted}}>Duraklatılan</div><div style={{fontSize:22,fontWeight:700,color:T.red}}>{goals.filter(g=>g.status==="paused").length}</div></div>
              <div style={{...st.card,borderLeft:`3px solid #8B5CF6`}}><div style={{fontSize:11,color:T.textMuted}}>Toplam</div><div style={{fontSize:22,fontWeight:700,color:"#8B5CF6"}}>{goals.length}</div></div>
            </div>
            {goals.length===0?
              <div style={{...st.card,padding:60,textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>◎</div><div style={{fontSize:16,fontWeight:600,color:T.text,marginBottom:4}}>Henüz hedef yok</div><div style={{fontSize:13,color:T.textMuted,marginBottom:16}}>Trading hedeflerini belirleyerek motivasyonunu artır</div><button onClick={()=>{const g={id:Date.now(),title:"",target:"",current:0,deadline:"",status:"active",type:"pnl"};setGoals(prev=>[...prev,g]);}} style={{padding:"10px 24px",background:"linear-gradient(135deg,#9333EA,#D4A017)",border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>İlk Hedefini Oluştur</button></div>
            :
              <div style={{display:"grid",gap:12}}>{goals.map((g,i)=><div key={g.id} style={{...st.card,display:"flex",alignItems:"center",gap:16}}>
                <div style={{flex:1}}>
                  <input value={g.title} onChange={e=>{const u=[...goals];u[i]={...u[i],title:e.target.value};setGoals(u);}} placeholder="Hedef başlığı..." style={{background:"transparent",border:"none",color:T.text,fontSize:15,fontWeight:600,outline:"none",width:"100%",fontFamily:"'Inter',sans-serif"}} />
                  <div style={{display:"flex",gap:8,marginTop:6,alignItems:"center"}}>
                    <select value={g.status} onChange={e=>{const u=[...goals];u[i]={...u[i],status:e.target.value};setGoals(u);}} style={{padding:"4px 8px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:11,outline:"none"}}><option value="active">Aktif</option><option value="done">Tamamlandı</option><option value="paused">Duraklatıldı</option></select>
                    <input type="date" value={g.deadline||""} onChange={e=>{const u=[...goals];u[i]={...u[i],deadline:e.target.value};setGoals(u);}} style={{padding:"4px 8px",background:T.bgInput,border:`1px solid ${T.border}`,borderRadius:4,color:T.text,fontSize:11,outline:"none"}} />
                  </div>
                </div>
                <button onClick={()=>setGoals(prev=>prev.filter((_,j)=>j!==i))} style={{width:30,height:30,border:`1px solid ${T.red}33`,background:T.redGlow,color:T.red,borderRadius:6,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>)}</div>
            }
            {goals.length>0&&<button onClick={()=>setGoals(prev=>[...prev,{id:Date.now(),title:"",target:"",current:0,deadline:"",status:"active",type:"pnl"}])} style={{marginTop:12,padding:"10px 20px",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,color:T.accent,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif"}}>+ Yeni Hedef</button>}
          </div>}
        </div>}

'''

# Reports tab'ından önce ekle
reports_marker = '{tab==="reports"&&'
if reports_marker in code:
    pos = code.index(reports_marker)
    # Önceki satır sonunu bul
    newline_pos = code.rfind('\n', 0, pos)
    code = code[:newline_pos] + '\n' + trade_tab_ui + '\n' + code[newline_pos:]
    print("3. Trade Journal tab UI eklendi")
else:
    print("3. HATA: reports tab bulunamadi")

with open('src/App.js', 'w') as f:
    f.write(code)

print("\n=== TAMAMLANDI ===")
print("Simdi: git add . && git commit -m 'Trade Journal eklendi' && git push")
