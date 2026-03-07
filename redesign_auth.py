#!/usr/bin/env python3
"""AuthScreen redesign - daha modern ve akıcı giriş ekranı"""

with open('src/App.js', 'r') as f:
    lines = f.readlines()

# Satır 351-550 arası AuthScreen (0-indexed: 350-549)
before = lines[:350]
after = lines[550:]

new_auth = '''const AuthScreen = ({ onLogin }) => {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      if (user) onLogin(user);
      setCheckingAuth(false);
    });
    return unsub;
  }, [onLogin]);

  if (checkingAuth) return (
    <div style={{minHeight:"100vh",background:"#060812",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <svg width="48" height="48" viewBox="0 0 80 80" style={{marginBottom:16,animation:"spin 2s linear infinite"}}>
          <circle cx="40" cy="40" r="35" fill="none" stroke="#9333EA22" strokeWidth="3"/>
          <circle cx="40" cy="40" r="35" fill="none" stroke="#9333EA" strokeWidth="3" strokeDasharray="60 160" strokeLinecap="round"/>
        </svg>
        <div style={{color:"#4A4D65",fontSize:14,fontFamily:"'Inter',sans-serif"}}>Yükleniyor...</div>
      </div>
      <style>{animations}</style>
    </div>
  );

  const handleLogin = async () => {
    if (!email.trim() || !password) { setError("E-posta ve şifre gerekli"); return; }
    setLoading(true); setError("");
    try { await loginWithEmail(email.trim(), password); }
    catch (e) {
      const msg = e.code === "auth/invalid-credential" ? "E-posta veya şifre hatalı" :
        e.code === "auth/user-not-found" ? "Hesap bulunamadı" :
        e.code === "auth/too-many-requests" ? "Çok fazla deneme, lütfen bekleyin" :
        e.code === "auth/invalid-email" ? "Geçersiz e-posta adresi" : "Giriş hatası";
      setError(msg);
    }
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!username.trim() || username.trim().length < 3) { setError("Kullanıcı adı en az 3 karakter"); return; }
    if (!email.trim()) { setError("E-posta gerekli"); return; }
    if (password.length < 6) { setError("Şifre en az 6 karakter"); return; }
    if (password !== confirmPass) { setError("Şifreler eşleşmiyor"); return; }
    setLoading(true); setError("");
    try {
      const cred = await registerWithEmail(email.trim(), password);
      await updateProfile(cred.user, { displayName: username.trim() });
      await saveUserData(cred.user.uid, { name: username.trim(), email: email.trim().toLowerCase(), createdAt: new Date().toISOString() });
    } catch (e) {
      const msg = e.code === "auth/email-already-in-use" ? "Bu e-posta zaten kayıtlı" :
        e.code === "auth/weak-password" ? "Şifre çok zayıf (min. 6 karakter)" :
        e.code === "auth/invalid-email" ? "Geçersiz e-posta" : "Kayıt hatası";
      setError(msg);
    }
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    setLoading(true); setError("");
    try {
      const cred = await loginWithGoogle();
      await saveUserData(cred.user.uid, { name: cred.user.displayName || "Kullanıcı", email: cred.user.email, loginMethod: "google", lastLogin: new Date().toISOString() });
    } catch (e) { if (e.code !== "auth/popup-closed-by-user") setError("Google giriş hatası"); }
    setLoading(false);
  };

  const handleGuestLogin = async () => {
    setLoading(true); setError("");
    try { await loginAsGuest(); } catch (e) { setError("Misafir giriş hatası"); }
    setLoading(false);
  };

  const handleForgot = async () => {
    if (!email.trim()) { setError("E-posta adresinizi girin"); return; }
    setLoading(true); setError("");
    try {
      await resetPassword(email.trim());
      setSuccess("Sıfırlama e-postası gönderildi!");
      setTimeout(() => { setMode("login"); setSuccess(""); }, 3000);
    } catch (e) { setError(e.code === "auth/user-not-found" ? "Hesap bulunamadı" : "Hata oluştu"); }
    setLoading(false);
  };

  const inp = (icon, val, set, ph, type="text", onKey=null) => (
    <div style={{position:"relative",marginBottom:14}}>
      <span style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",fontSize:15,opacity:.4}}>{icon}</span>
      <input type={type==="password"?(showPass?"text":"password"):type} value={val}
        onChange={e=>{set(e.target.value);setError("");}}
        onKeyDown={e=>e.key==="Enter"&&onKey&&onKey()}
        onFocus={e=>{e.target.style.borderColor="#9333EA";e.target.style.boxShadow="0 0 0 3px rgba(147,51,234,.1)";}}
        onBlur={e=>{e.target.style.borderColor="#1a1d2e";e.target.style.boxShadow="none";}}
        placeholder={ph} style={{width:"100%",padding:"14px 14px 14px 46px",background:"rgba(255,255,255,.03)",border:"1.5px solid #1a1d2e",borderRadius:12,color:"#E8E9ED",fontSize:14,outline:"none",fontFamily:"'Inter',sans-serif",transition:"all .25s ease"}}/>
      {type==="password"&&<span onClick={()=>setShowPass(!showPass)} style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",cursor:"pointer",fontSize:13,opacity:.4,userSelect:"none"}}>{showPass?"◉":"◎"}</span>}
    </div>
  );

  const features = [
    {ic:"📊",t:"Portföy Takibi",d:"Kripto, BIST, ABD hisseleri"},
    {ic:"📈",t:"Trade Journal",d:"Profesyonel trade günlüğü"},
    {ic:"🔒",t:"Güvenli",d:"Firebase ile şifreli depolama"},
    {ic:"📱",t:"Her Cihazda",d:"Bulut senkronizasyon"}
  ];

  return (
    <div style={{minHeight:"100vh",background:"#060812",display:"flex",fontFamily:"'Inter',sans-serif",overflow:"hidden"}}>
      {/* Sol - Hero */}
      <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",padding:"40px 60px",position:"relative"}}>
        {/* Animated background */}
        <div style={{position:"absolute",inset:0,overflow:"hidden"}}>
          <div style={{position:"absolute",width:500,height:500,borderRadius:"50%",background:"radial-gradient(circle,rgba(147,51,234,.12) 0%,transparent 70%)",top:"-10%",left:"-5%",filter:"blur(80px)",animation:"float 8s ease-in-out infinite"}}/>
          <div style={{position:"absolute",width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(212,160,23,.08) 0%,transparent 70%)",bottom:"-5%",right:"10%",filter:"blur(60px)",animation:"float 10s ease-in-out infinite reverse"}}/>
          <div style={{position:"absolute",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(59,130,246,.06) 0%,transparent 70%)",top:"40%",right:"-5%",filter:"blur(50px)",animation:"float 12s ease-in-out infinite"}}/>
          <div style={{position:"absolute",inset:0,opacity:.02,backgroundImage:"radial-gradient(circle at 1px 1px, #9333EA 0.5px, transparent 0)",backgroundSize:"48px 48px"}}/>
        </div>

        <div style={{position:"relative",zIndex:1,maxWidth:440,width:"100%"}}>
          {/* Logo */}
          <div style={{marginBottom:40}}>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}>
              <div style={{width:52,height:52,borderRadius:14,background:"linear-gradient(135deg,#9333EA20,#D4A01720)",border:"1px solid #9333EA22",display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(10px)"}}>
                <svg width="28" height="28" viewBox="0 0 80 80"><defs><linearGradient id="lGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#9333EA"/><stop offset="100%" stopColor="#D4A017"/></linearGradient></defs><path d="M20 50 L32 32 L48 42 L62 18" fill="none" stroke="url(#lGrad)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="62" cy="18" r="4" fill="#D4A017"/></svg>
              </div>
              <div>
                <div style={{fontSize:26,fontWeight:800,letterSpacing:"-.5px",background:"linear-gradient(135deg,#C084FC,#D4A017)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>InvestPulse</div>
                <div style={{fontSize:12,color:"#4A4D65",letterSpacing:"2px",textTransform:"uppercase",marginTop:2}}>Trading & Portföy</div>
              </div>
            </div>
            <h1 style={{fontSize:36,fontWeight:800,color:"#E8E9ED",lineHeight:1.2,marginBottom:12,letterSpacing:"-.5px"}}>Yatırımlarını<br/><span style={{background:"linear-gradient(135deg,#9333EA,#D4A017)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>tek yerden</span> yönet.</h1>
            <p style={{fontSize:15,color:"#6B6F8A",lineHeight:1.7}}>Kripto, hisse, BIST ve TEFAS portföyünü takip et. Trade günlüğü tut, performansını analiz et.</p>
          </div>

          {/* Feature pills */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {features.map(f=>(
              <div key={f.t} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"rgba(255,255,255,.02)",border:"1px solid #12141E",borderRadius:12,transition:"border-color .2s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="#9333EA22"} onMouseLeave={e=>e.currentTarget.style.borderColor="#12141E"}>
                <span style={{fontSize:20}}>{f.ic}</span>
                <div><div style={{fontSize:12,fontWeight:600,color:"#C8CAD4"}}>{f.t}</div><div style={{fontSize:10,color:"#4A4D65"}}>{f.d}</div></div>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div style={{display:"flex",gap:32,marginTop:32}}>
            {[["8,000+","Hisse & ETF"],["800+","Kripto"],["516","BIST"],["Gerçek Zamanlı","Fiyatlar"]].map(([n,l])=>(
              <div key={l}>
                <div style={{fontSize:18,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",background:"linear-gradient(135deg,#C084FC,#D4A017)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{n}</div>
                <div style={{fontSize:10,color:"#3D4058",textTransform:"uppercase",letterSpacing:1,marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{position:"absolute",bottom:20,left:60,fontSize:11,color:"#1E2035"}}>© 2026 InvestPulse — Tüm hakları saklıdır</div>
      </div>

      {/* Sağ - Auth Form */}
      <div style={{width:440,display:"flex",alignItems:"center",justifyContent:"center",padding:"40px 36px",background:"rgba(8,10,18,.8)",borderLeft:"1px solid #12141E",backdropFilter:"blur(20px)"}}>
        <div style={{width:"100%",maxWidth:360}}>
          {/* Tab switch */}
          <div style={{display:"flex",gap:0,background:"#0C0E18",borderRadius:12,padding:4,marginBottom:28,border:"1px solid #12141E"}}>
            {[["login","Giriş Yap"],["register","Kayıt Ol"]].map(([m,l])=>(
              <button key={m} onClick={()=>{setMode(m);setError("");setSuccess("");}}
                style={{flex:1,padding:"11px",borderRadius:9,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Inter',sans-serif",transition:"all .3s",
                  background:mode===m?"linear-gradient(135deg,rgba(147,51,234,.15),rgba(212,160,23,.1))":"transparent",
                  color:mode===m?"#C084FC":"#4A4D65",
                  boxShadow:mode===m?"0 2px 12px rgba(147,51,234,.1)":"none"}}>{l}</button>
            ))}
          </div>

          {/* Login Form */}
          {mode==="login"&&<>
            <div style={{marginBottom:24}}>
              <h2 style={{fontSize:22,fontWeight:700,color:"#E8E9ED",marginBottom:6}}>Hoş Geldiniz</h2>
              <p style={{fontSize:13,color:"#4A4D65",margin:0}}>Hesabınıza giriş yapın</p>
            </div>
            {inp("✉",email,setEmail,"E-posta adresi","email",handleLogin)}
            {inp("🔒",password,setPassword,"Şifre","password",handleLogin)}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,marginTop:-4}}>
              <label onClick={()=>setRememberMe(!rememberMe)} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"#4A4D65"}}>
                <div style={{width:16,height:16,borderRadius:4,border:"1.5px solid "+(rememberMe?"#9333EA":"#1E2035"),background:rememberMe?"#9333EA15":"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
                  {rememberMe&&<span style={{color:"#9333EA",fontSize:10,fontWeight:700}}>✓</span>}
                </div>
                Beni hatırla
              </label>
              <span onClick={()=>{setMode("forgot");setError("");}} style={{fontSize:12,color:"#9333EA",cursor:"pointer",fontWeight:500}}>Şifremi unuttum</span>
            </div>
          </>}

          {/* Register Form */}
          {mode==="register"&&<>
            <div style={{marginBottom:24}}>
              <h2 style={{fontSize:22,fontWeight:700,color:"#E8E9ED",marginBottom:6}}>Hesap Oluştur</h2>
              <p style={{fontSize:13,color:"#4A4D65",margin:0}}>Ücretsiz başlayın, kart gerekmez</p>
            </div>
            {inp("👤",username,setUsername,"Kullanıcı adı")}
            {inp("✉",email,setEmail,"E-posta adresi","email")}
            {inp("🔒",password,setPassword,"Şifre (min. 6 karakter)","password")}
            {inp("🔒",confirmPass,setConfirmPass,"Şifre tekrar","password",handleRegister)}
          </>}

          {/* Forgot Form */}
          {mode==="forgot"&&<>
            <div style={{marginBottom:24}}>
              <h2 style={{fontSize:22,fontWeight:700,color:"#E8E9ED",marginBottom:6}}>Şifre Sıfırlama</h2>
              <p style={{fontSize:13,color:"#4A4D65",margin:0}}>E-postanıza sıfırlama linki göndereceğiz</p>
            </div>
            {inp("✉",email,setEmail,"E-posta adresi","email",handleForgot)}
            <span onClick={()=>{setMode("login");setError("");}} style={{fontSize:12,color:"#9333EA",cursor:"pointer",fontWeight:500}}>← Giriş ekranına dön</span>
            <div style={{height:12}}/>
          </>}

          {/* Error / Success */}
          {error&&<div style={{padding:"10px 14px",background:"rgba(239,68,68,.06)",border:"1px solid rgba(239,68,68,.15)",borderRadius:10,color:"#F87171",fontSize:12,marginBottom:14,display:"flex",alignItems:"center",gap:8,animation:"fadeUp .3s ease-out"}}><span>⚠</span>{error}</div>}
          {success&&<div style={{padding:"10px 14px",background:"rgba(34,197,94,.06)",border:"1px solid rgba(34,197,94,.15)",borderRadius:10,color:"#4ADE80",fontSize:12,marginBottom:14,display:"flex",alignItems:"center",gap:8,animation:"fadeUp .3s ease-out"}}><span>✓</span>{success}</div>}

          {/* Submit button */}
          <button onClick={mode==="login"?handleLogin:mode==="register"?handleRegister:handleForgot} disabled={loading}
            style={{width:"100%",padding:"14px",background:loading?"#2A1545":"linear-gradient(135deg,#9333EA,#7C3AED)",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:600,cursor:loading?"wait":"pointer",fontFamily:"'Inter',sans-serif",transition:"all .3s",boxShadow:"0 4px 24px rgba(147,51,234,.3)",opacity:loading?.6:1,letterSpacing:".3px",position:"relative",overflow:"hidden"}}>
            {loading?<span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><svg width="16" height="16" viewBox="0 0 24 24" style={{animation:"spin 1s linear infinite"}}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 60" strokeLinecap="round"/></svg>İşleniyor...</span>:mode==="login"?"Giriş Yap":mode==="register"?"Hesap Oluştur":"Sıfırlama Linki Gönder"}
          </button>

          {/* Divider + Social */}
          {mode!=="forgot"&&<>
            <div style={{display:"flex",alignItems:"center",gap:16,margin:"22px 0"}}>
              <div style={{flex:1,height:1,background:"linear-gradient(90deg,transparent,#1E2035)"}}/>
              <span style={{fontSize:11,color:"#3D4058",textTransform:"uppercase",letterSpacing:1}}>veya</span>
              <div style={{flex:1,height:1,background:"linear-gradient(90deg,#1E2035,transparent)"}}/>
            </div>

            <button onClick={handleGoogleLogin} disabled={loading}
              style={{width:"100%",padding:"12px",background:"rgba(255,255,255,.03)",border:"1.5px solid #1a1d2e",borderRadius:12,color:"#C8CAD4",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:8,transition:"all .25s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="#9333EA44";e.currentTarget.style.background="rgba(147,51,234,.04)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="#1a1d2e";e.currentTarget.style.background="rgba(255,255,255,.03)";}}>
              <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Google ile devam et
            </button>

            <button onClick={handleGuestLogin} disabled={loading}
              style={{width:"100%",padding:"12px",background:"transparent",border:"1.5px solid #12141E",borderRadius:12,color:"#4A4D65",fontSize:12,fontWeight:500,cursor:"pointer",fontFamily:"'Inter',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .25s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="#1E2035";e.currentTarget.style.color="#6B6F8A";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="#12141E";e.currentTarget.style.color="#4A4D65";}}>
              Misafir olarak göz at
            </button>
          </>}

          <div style={{textAlign:"center",marginTop:20,fontSize:11,color:"#1E2035"}}>Giriş yaparak kullanım koşullarını kabul edersiniz</div>
        </div>
      </div>

      <style>{animations + `
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-20px)} }
        @media(max-width:900px){
          div[style*="flex:1"]{display:none!important}
          div[style*="width:440"]{width:100%!important;border-left:none!important}
        }
      `}</style>
    </div>
  );
};
'''

with open('src/App.js', 'w') as f:
    f.writelines(before)
    f.write(new_auth)
    f.writelines(after)

print("AuthScreen yeniden tasarlandi!")
print("Simdi: git add . && git commit -m 'auth ekrani redesign' && git push")
