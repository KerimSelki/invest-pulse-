// ═══ TEFAS Fon Verileri ═══
// id format: "KOD.TEFAS" — isStock() kontrolünde yakalanır
const t = (code, name, sector, fundType) => ({ id: code + ".TEFAS", symbol: code, name, market: "tefas", currency: "₺", sector, fundType });

export const TEFAS_DATA = {
  // Hisse Fonları
  "IPB.TEFAS": t("IPB","İş Portföy BIST 100 Fonu","Hisse","Hisse"),
  "ZPX.TEFAS": t("ZPX","Ziraat BIST 30 Fonu","Hisse","Hisse"),
  "AFT.TEFAS": t("AFT","Ak Portföy BIST Temettü","Hisse","Hisse"),
  "AFA.TEFAS": t("AFA","Ak Portföy Hisse Fonu","Hisse","Hisse"),
  "YHS.TEFAS": t("YHS","Yapı Kredi Hisse Fonu","Hisse","Hisse"),
  "GHS.TEFAS": t("GHS","Garanti Hisse Fonu","Hisse","Hisse"),
  "ICF.TEFAS": t("ICF","İş Portföy BIST 30 Fonu","Hisse","Hisse"),
  "TLS.TEFAS": t("TLS","TEB Hisse Fonu","Hisse","Hisse"),
  // Borçlanma Fonları
  "TI2.TEFAS": t("TI2","İş Portföy Borçlanma Fonu","Borçlanma","Borçlanma"),
  "DZE.TEFAS": t("DZE","Deniz Portföy Eurobond","Borçlanma","Eurobond"),
  "AKU.TEFAS": t("AKU","Ak Portföy Kısa Vadeli Borç","Borçlanma","Borçlanma"),
  "TAU.TEFAS": t("TAU","TEB Kısa Vadeli Borç","Borçlanma","Borçlanma"),
  // Altın Fonları
  "OFA.TEFAS": t("OFA","OYAK Altın Fonu","Altın","Altın"),
  "GAL.TEFAS": t("GAL","Garanti Altın Fonu","Altın","Altın"),
  "IAF.TEFAS": t("IAF","İş Portföy Altın Fonu","Altın","Altın"),
  "AAL.TEFAS": t("AAL","Ak Portföy Altın Fonu","Altın","Altın"),
  // Değişken / Karma Fonlar
  "YAC.TEFAS": t("YAC","Yapı Kredi Agresif Fon","Karma","Değişken"),
  "MAC.TEFAS": t("MAC","Marmara Cap. Değişken","Karma","Değişken"),
  "TCD.TEFAS": t("TCD","TEB Portföy Değişken","Karma","Değişken"),
  "AK2.TEFAS": t("AK2","Ak Portföy Amerikan","Yabancı","Yabancı"),
  "IYH.TEFAS": t("IYH","İş Portföy Yab. Hisse","Yabancı","Yabancı"),
  // Emeklilik Fonları
  "GAE.TEFAS": t("GAE","Garanti Emeklilik Fonu","Emeklilik","Emeklilik"),
  "AGE.TEFAS": t("AGE","Ak Emeklilik Fonu","Emeklilik","Emeklilik"),
  // Para Piyasası
  "APL.TEFAS": t("APL","Ak Portföy Para Piyasası","Para Piyasası","Likit"),
  "IPL.TEFAS": t("IPL","İş Portföy Para Piyasası","Para Piyasası","Likit"),
  "GPL.TEFAS": t("GPL","Garanti Para Piyasası","Para Piyasası","Likit"),
  // Teknoloji / Sektör Fonları
  "ATS.TEFAS": t("ATS","Ak Portföy Teknoloji","Teknoloji","Sektör"),
  "ITE.TEFAS": t("ITE","İş Portföy Teknoloji","Teknoloji","Sektör"),
};
