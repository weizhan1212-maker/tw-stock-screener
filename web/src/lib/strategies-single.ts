/**
 * 單一條件策略：一個主要條件（＋必要的流動性門檻），條件全部可轉成自訂篩選。
 */
import type { Condition } from "./screener";
import { passes } from "./screener";
import type { Param, Params, Strategy } from "./strategies";
import type { Sort } from "@/components/Results";

type Cat = "技術面" | "籌碼面" | "基本面";
type Cond = Omit<Condition, "id">;

interface Def {
  id: string; name: string; category: Cat; tagline: string; plain: string;
  params: Param[]; conds: (p: Params) => Cond[]; rules: (p: Params) => string[];
  cols: string[]; sort: Sort; period: string; notFor: string[]; finance?: string;
  needs?: Strategy["needs"];
}

const VOL: Param = { key: "vol", label: "成交量至少", value: 300, unit: "張", step: 100 };
const vol = (p: Params): Cond => ({ field: "volume_lots", op: "ge", a: p.vol });
const volRule = (p: Params) => `成交量 ≥ ${p.vol} 張（排除冷門股）`;
const B = ["close", "chg_pct"];

function single(d: Def): Strategy {
  return {
    id: d.id, name: d.name, group: "單一條件", category: d.category, tagline: d.tagline, plain: d.plain,
    params: d.params, rules: d.rules, cols: d.cols, sort: d.sort, period: d.period, notFor: d.notFor,
    finance: d.finance ?? "金融股與一般股票一起計算。",
    toConditions: d.conds, needs: d.needs,
    run: (c, p) => {
      const cs = d.conds(p).map((x, i) => ({ ...x, id: String(i) }));
      return c.stocks.filter((r) => cs.every((x) => passes(r, x)));
    },
  };
}

const TECH_NOT = "盤整或消息面主導時，技術訊號容易反覆假突破；只看單一訊號，沒有考慮公司基本面。";

export const SINGLE: Strategy[] = [
  // ---------- 技術面 ----------
  single({
    id: "high52", name: "創 52 週新高", category: "技術面", tagline: "股價來到一年來最高",
    plain: "股價突破過去一年的最高價，代表一年內買進的人幾乎都賺錢，上方沒有套牢賣壓。強勢股常常「新高之後還有新高」。",
    params: [VOL], conds: (p) => [{ field: "dist_high52", op: "ge", a: 0 }, vol(p)],
    rules: (p) => ["收盤價 ≥ 近 52 週最高價", volRule(p)],
    cols: [...B, "dist_high52", "ret60", "vol_ratio", "volume_lots"], sort: { key: "ret60", dir: -1 },
    period: "近 250 個交易日的還原收盤價。", notFor: ["大盤急漲後的追價階段，新高股可能已漲多", TECH_NOT],
  }),
  single({
    id: "high60", name: "創 60 日新高", category: "技術面", tagline: "突破一季以來的高點",
    plain: "收盤創下近 3 個月新高，是中期轉強的常見訊號，比 52 週新高更早出現，但假突破也比較多。",
    params: [VOL], conds: (p) => [{ field: "new_high60", op: "is" }, vol(p)],
    rules: (p) => ["收盤價創近 60 個交易日新高", volRule(p)],
    cols: [...B, "dist_high52", "ret20", "vol_ratio", "volume_lots"], sort: { key: "vol_ratio", dir: -1 },
    period: "近 60 個交易日的還原收盤價。", notFor: [TECH_NOT],
  }),
  single({
    id: "bull_align", name: "均線多頭排列", category: "技術面", tagline: "短中長期趨勢一致向上",
    plain: "收盤價 > 5 日線 > 20 日線 > 60 日線，代表最近一週、一個月、一季買進的人平均都賺錢，趨勢最健康的型態。",
    params: [VOL], conds: (p) => [{ field: "bull_align", op: "is" }, vol(p)],
    rules: (p) => ["收盤 > 5 日均線 > 20 日均線 > 60 日均線", volRule(p)],
    cols: [...B, "ret20", "ret60", "dist_ma240", "volume_lots"], sort: { key: "ret20", dir: -1 },
    period: "近 60 個交易日的還原收盤價。", notFor: ["已經排列很久的股票可能漲多，追高風險較大", TECH_NOT],
  }),
  single({
    id: "kd_golden", name: "KD 低檔黃金交叉", category: "技術面", tagline: "短線超跌後轉強",
    plain: "KD 指標在低檔（K 值不高）出現黃金交叉，代表短線跌深後開始反彈。高檔的黃金交叉意義較小，所以限制 K 值上限。",
    params: [{ key: "k", label: "K 值低於", value: 40 }, VOL],
    conds: (p) => [{ field: "kd_golden", op: "is" }, { field: "k", op: "le", a: p.k }, vol(p)],
    rules: (p) => ["今天 K 值由下往上穿過 D 值", `K 值 ≤ ${p.k}`, volRule(p)],
    cols: [...B, "k", "d", "ret20", "volume_lots"], sort: { key: "k", dir: 1 },
    period: "9 日 KD（近 9 個交易日最高、最低價）。", notFor: ["空頭趨勢中的低檔交叉常常只是反彈，之後續跌", TECH_NOT],
  }),
  single({
    id: "macd_golden", name: "MACD 黃金交叉", category: "技術面", tagline: "中期動能翻多",
    plain: "MACD 的快線向上穿過慢線，代表中期動能由弱轉強。比 KD 慢，但比較不容易被短線雜訊騙。",
    params: [VOL], conds: (p) => [{ field: "macd_golden", op: "is" }, vol(p)],
    rules: (p) => ["今天 MACD 快線（DIF）由下往上穿過慢線（DEA）", volRule(p)],
    cols: [...B, "macd_hist", "ret20", "above_ma60", "volume_lots"], sort: { key: "macd_hist", dir: -1 },
    period: "12、26、9 日指數移動平均。", notFor: ["橫盤時快慢線反覆交叉，訊號失真", TECH_NOT],
  }),
  single({
    id: "vol_surge", name: "量能倍增上漲", category: "技術面", tagline: "成交量暴增而且收紅",
    plain: "今天成交量是平常的好幾倍、而且股價上漲，代表有新資金搶進。要搭配趨勢判斷，單日爆量也可能是出貨。",
    params: [{ key: "ratio", label: "量比至少", value: 2, unit: "倍", step: 0.5 }, { ...VOL, value: 500 }],
    conds: (p) => [{ field: "vol_ratio", op: "ge", a: p.ratio }, { field: "chg_pct", op: "ge", a: 0.01 }, vol(p)],
    rules: (p) => [`量比（今日量 ÷ 20 日均量）≥ ${p.ratio} 倍`, "今天收紅", volRule(p)],
    cols: [...B, "vol_ratio", "volume_lots", "value", "ret20"], sort: { key: "vol_ratio", dir: -1 },
    period: "今日與近 20 個交易日成交量。", notFor: ["長期大漲後的高檔爆量，可能是主力出貨", TECH_NOT],
  }),
  single({
    id: "rsi_oversold", name: "RSI 超跌", category: "技術面", tagline: "短線賣過頭",
    plain: "RSI 低於 30 代表最近跌勢很重、賣壓可能已經宣洩。適合找反彈機會，但「便宜可以更便宜」。",
    params: [{ key: "rsi", label: "RSI 低於", value: 30 }, VOL],
    conds: (p) => [{ field: "rsi14", op: "le", a: p.rsi }, vol(p)],
    rules: (p) => [`14 日 RSI ≤ ${p.rsi}`, volRule(p)],
    cols: [...B, "rsi14", "ret20", "dist_low52", "volume_lots"], sort: { key: "rsi14", dir: 1 },
    period: "14 日 RSI。", notFor: ["公司基本面出問題（營收衰退、虧損）造成的下跌", "空頭市場中超跌可以持續很久"],
  }),
  single({
    id: "boll_break", name: "突破布林上緣", category: "技術面", tagline: "股價衝出波動區間",
    plain: "股價站到布林通道上緣之上，代表漲勢超出平常的波動範圍，常出現在新一波行情的起點，也可能是短線過熱。",
    params: [VOL], conds: (p) => [{ field: "boll_pctb", op: "ge", a: 100 }, vol(p)],
    rules: (p) => ["收盤價 ≥ 布林通道上緣（20 日均線 + 2 倍標準差）", volRule(p)],
    cols: [...B, "boll_pctb", "vol_ratio", "ret20", "volume_lots"], sort: { key: "vol_ratio", dir: -1 },
    period: "20 日均線與標準差。", notFor: ["連續多天貼著上緣後的追價，回檔機率高", TECH_NOT],
  }),
  single({
    id: "near_ma240", name: "剛站上年線", category: "技術面", tagline: "長期趨勢可能翻多",
    plain: "股價在年線之上、但離年線不遠，代表長期趨勢剛由空轉多或在年線附近整理，進場成本離長期平均不遠。",
    params: [{ key: "max", label: "高於年線最多", value: 5, unit: "%" }, VOL],
    conds: (p) => [{ field: "dist_ma240", op: "between", a: 0, b: p.max }, vol(p)],
    rules: (p) => [`股價高於 240 日均線 0～${p.max}%`, volRule(p)],
    cols: [...B, "dist_ma240", "ret60", "above_ma60", "volume_lots"], sort: { key: "dist_ma240", dir: 1 },
    period: "近 240 個交易日的還原收盤價。", notFor: ["年線本身還在下彎時，站上後常再跌破", TECH_NOT],
  }),
  single({
    id: "rs_leader", name: "強於大盤", category: "技術面", tagline: "近一季明顯跑贏加權指數",
    plain: "近 60 日漲幅比加權指數多很多，代表資金持續偏愛。強者恆強是動能投資的核心概念。",
    params: [{ key: "rs", label: "贏大盤至少", value: 20, unit: "%" }, { ...VOL, value: 500 }],
    conds: (p) => [{ field: "rs60", op: "ge", a: p.rs }, vol(p)],
    rules: (p) => [`近 60 日漲幅 − 加權指數同期漲幅 ≥ ${p.rs}%`, volRule(p)],
    cols: [...B, "rs60", "rs20", "dist_high52", "volume_lots"], sort: { key: "rs60", dir: -1 },
    period: "近 60 個交易日的還原收盤價與加權指數。", notFor: ["盤勢轉空時，前期強勢股往往跌最多", "小型股題材炒作也會出現在這裡"],
  }),
  single({
    id: "low_vol", name: "低波動穩健", category: "技術面", tagline: "走勢平穩、站在季線之上",
    plain: "每天平均震盪幅度小、又維持在季線之上，適合不想坐雲霄飛車的人。通常是大型股或穩定配息股。",
    params: [{ key: "atr", label: "波動度低於", value: 2, unit: "%", step: 0.5 }, { ...VOL, value: 500 }],
    conds: (p) => [{ field: "atr_pct", op: "le", a: p.atr }, { field: "above_ma60", op: "is" }, vol(p)],
    rules: (p) => [`ATR%（14 日平均真實波幅 ÷ 股價）≤ ${p.atr}%`, "收盤在 60 日均線之上", volRule(p)],
    cols: [...B, "atr_pct", "ret60", "dividend_yield", "volume_lots"], sort: { key: "atr_pct", dir: 1 },
    period: "近 14 個交易日。", notFor: ["想要短期大漲的人", "波動低不代表不會跌，突發利空時一樣會大跌"],
  }),

  // ---------- 籌碼面 ----------
  single({
    id: "foreign_streak", name: "外資連續買超", category: "籌碼面", tagline: "外資連買多天",
    plain: "外資資金大、研究深，連續多天買超通常代表有計畫地建立部位，不是短線進出。",
    params: [{ key: "days", label: "連買至少", value: 5, unit: "天" }, VOL],
    conds: (p) => [{ field: "foreign_buy_streak", op: "ge", a: p.days }, vol(p)],
    rules: (p) => [`外資連續買超 ≥ ${p.days} 個交易日`, volRule(p)],
    cols: [...B, "foreign_buy_streak", "foreign_net5", "foreign_net20", "foreign_ratio"], sort: { key: "foreign_buy_streak", dir: -1 },
    period: "證交所／櫃買中心每日三大法人買賣超。", notFor: ["外資買賣常受匯率與國際資金影響，連買可能突然中斷", "權值股的外資買超可能只是被動指數調整"],
  }),
  single({
    id: "inst_big", name: "法人大額買超", category: "籌碼面", tagline: "近一個月法人砸大錢",
    plain: "三大法人近 20 日合計買超金額很大，代表主要資金近期明顯站在買方。金額為估算值。",
    params: [{ key: "amt", label: "20 日買超至少", value: 10, unit: "億" }],
    conds: (p) => [{ field: "inst_amt20", op: "ge", a: p.amt }],
    rules: (p) => [`三大法人近 20 日買超金額 ≥ ${p.amt} 億（張數 × 收盤價估算）`],
    cols: [...B, "inst_amt20", "inst_amt5", "ret20", "market_cap"], sort: { key: "inst_amt20", dir: -1 },
    period: "近 20 個交易日三大法人買賣超。", notFor: ["大型權值股金額天生較大，跟小型股不能直接比", "法人也會買錯，買超後股價不一定漲"],
  }),
  single({
    id: "big_holder", name: "大戶持股增加", category: "籌碼面", tagline: "千張大戶本週加碼",
    plain: "持股 1,000 張以上的大戶比例增加，代表籌碼往大戶集中、散戶減少，常被視為「籌碼變乾淨」。",
    params: [{ key: "chg", label: "週增加至少", value: 0.5, unit: "%", step: 0.1 }, VOL],
    conds: (p) => [{ field: "big_pct_chg", op: "ge", a: p.chg }, vol(p)],
    rules: (p) => [`千張大戶持股比例比上週增加 ≥ ${p.chg} 個百分點`, volRule(p)],
    cols: [...B, "big_pct", "big_pct_chg", "ret20", "volume_lots"], sort: { key: "big_pct_chg", dir: -1 },
    period: "集保結算所每週公布的股權分散表（每週五資料）；本站從 2026 年 10 月開始累積，滿兩週才有增減資料。", notFor: ["ETF 與受益憑證不適用", "大戶可能是公司派、法人或信託，不一定是看好"],
    needs: { field: "big_pct_chg", msg: "資料累積中：集保每週五公布，本站 10/2 開始累積，滿兩週（約 10 月中）起才有結果" },
  }),
  single({
    id: "margin_clean", name: "融資減、股價漲", category: "籌碼面", tagline: "散戶下車、股價反而上漲",
    plain: "融資是散戶借錢買股。融資減少但股價上漲，代表上漲不是靠散戶追價，而是其他資金在買，籌碼比較穩。",
    params: [VOL],
    conds: (p) => [{ field: "margin_chg5", op: "le", a: -1 }, { field: "ret5", op: "ge", a: 0.01 }, vol(p)],
    rules: (p) => ["融資餘額比 5 個交易日前減少", "近 5 日股價上漲", volRule(p)],
    cols: [...B, "margin_chg5", "margin_balance", "ret5", "volume_lots"], sort: { key: "margin_chg5", dir: 1 },
    period: "近 5 個交易日的融資餘額與股價。", notFor: ["不能融資的股票（例如部分新上市、全額交割股）不會出現", "除權息前後融資會強制回補，數字失真"],
  }),
  single({
    id: "short_squeeze", name: "高券資比", category: "籌碼面", tagline: "空單多，可能軋空",
    plain: "券資比高代表放空的人相對多。若股價上漲，空方被迫回補會推升股價（軋空），但也代表有人認為股價高估。",
    params: [{ key: "ratio", label: "券資比至少", value: 30, unit: "%" }, VOL],
    conds: (p) => [{ field: "short_margin_ratio", op: "ge", a: p.ratio }, vol(p)],
    rules: (p) => [`券資比（融券 ÷ 融資）≥ ${p.ratio}%`, volRule(p)],
    cols: [...B, "short_margin_ratio", "short_balance", "margin_balance", "ret20"], sort: { key: "short_margin_ratio", dir: -1 },
    period: "最新一日融資融券餘額。", notFor: ["股東會與除權息前的融券強制回補期間", "空方看壞有理由時，軋空不一定發生"],
  }),

  // ---------- 基本面 ----------
  single({
    id: "rev_jump", name: "月營收大增", category: "基本面", tagline: "最新月營收比去年大幅成長",
    plain: "月營收每個月 10 號前公布，是最即時的基本面數字。大幅年增代表生意變好，是很多成長股行情的起點。",
    params: [{ key: "yoy", label: "年增率至少", value: 30, unit: "%" }, { ...VOL, value: 100 }],
    conds: (p) => [{ field: "rev_yoy", op: "ge", a: p.yoy }, vol(p)],
    rules: (p) => [`最新月營收年增率 ≥ ${p.yoy}%`, volRule(p)],
    cols: [...B, "rev_yoy", "rev_mom", "rev_yoy_chg", "pe"], sort: { key: "rev_yoy", dir: -1 },
    period: "最新一個月營收（公開資訊觀測站彙總資料）。", notFor: ["去年同期基期很低時，年增率會被放大", "一次性大單或認列時點造成的跳升"],
  }),
  single({
    id: "eps_jump", name: "單季獲利大增", category: "基本面", tagline: "最新一季 EPS 年增率高",
    plain: "最新一季每股盈餘比去年同季大幅成長，而且營收也連續成長、獲利本身有一定規模，代表公司真的賺更多錢，不是去年同季基期太低（例如匯損）造成的假成長。",
    params: [{ key: "yoy", label: "EPS 年增至少", value: 50, unit: "%" }, { key: "eps", label: "單季 EPS 至少", value: 0.5, unit: "元", step: 0.1 },
      { key: "rev", label: "近 3 個月營收年增都至少", value: 20, unit: "%" }],
    conds: (p) => [{ field: "eps_q_yoy", op: "ge", a: p.yoy }, { field: "eps_q", op: "ge", a: p.eps }, { field: "rev_yoy_min3", op: "ge", a: p.rev }],
    rules: (p) => [`最新一季 EPS 年增率 ≥ ${p.yoy}%`, `最新一季 EPS ≥ ${p.eps} 元（排除獲利太小、比率失真）`, `近 3 個月營收年增率都 ≥ ${p.rev}%（確認是本業成長）`],
    cols: [...B, "eps_q", "eps_q_yoy", "eps_ttm", "pe"], sort: { key: "eps_q_yoy", dir: -1 },
    period: "最新一季合併財報。", notFor: ["業外收益（賣土地、匯兌）撐起的獲利", "去年同季虧損或很低，年增率失真"],
  }),
  single({
    id: "high_roe", name: "高 ROE", category: "基本面", tagline: "很會用股東的錢賺錢",
    plain: "ROE（股東權益報酬率）代表公司用股東的錢一年能賺幾 %。長期維持在 15% 以上的公司通常有競爭優勢。",
    params: [{ key: "roe", label: "ROE 至少", value: 15, unit: "%" }],
    conds: (p) => [{ field: "roe", op: "ge", a: p.roe }, { field: "eps_ttm", op: "ge", a: 0.01 }],
    rules: (p) => [`近四季 ROE ≥ ${p.roe}%`, "近四季 EPS > 0"],
    cols: [...B, "roe", "roe_min5y", "debt_ratio", "pe"], sort: { key: "roe", dir: -1 },
    period: "近四季合併財報。", notFor: ["高負債撐起的高 ROE（請一併看負債比）", "單年一次性獲利造成的高 ROE"],
    finance: "金融股一起計算；銀行業本身槓桿高，ROE 不宜跟一般產業直接比較。",
  }),
  single({
    id: "high_gm", name: "高毛利率", category: "基本面", tagline: "產品有定價能力",
    plain: "毛利率高代表產品賣得比成本貴很多，通常有技術、品牌或通路優勢，景氣變差時比較撐得住。",
    params: [{ key: "gm", label: "毛利率至少", value: 40, unit: "%" }],
    conds: (p) => [{ field: "gross_margin", op: "ge", a: p.gm }, { field: "eps_ttm", op: "ge", a: 0.01 }],
    rules: (p) => [`近四季毛利率 ≥ ${p.gm}%`, "近四季 EPS > 0"],
    cols: [...B, "gross_margin", "op_margin", "gm_stability", "pe"], sort: { key: "gross_margin", dir: -1 },
    period: "近四季合併財報。", notFor: ["不同產業毛利率天生差很多（軟體高、代工低），跨產業比較意義小"],
    finance: "金融股沒有毛利率，不會出現在結果中。",
  }),
  single({
    id: "solid", name: "低負債有現金", category: "基本面", tagline: "財務保守、真的有賺現金",
    plain: "負債比低、近四季自由現金流為正，代表公司不靠借錢過日子，景氣差時倒閉風險低。",
    params: [{ key: "debt", label: "負債比低於", value: 30, unit: "%" }],
    conds: (p) => [{ field: "debt_ratio", op: "le", a: p.debt }, { field: "fcf_ttm", op: "ge", a: 0.01 }],
    rules: (p) => [`負債比 ≤ ${p.debt}%`, "近四季自由現金流 > 0"],
    cols: [...B, "debt_ratio", "fcf_ttm", "current_ratio", "roe"], sort: { key: "debt_ratio", dir: 1 },
    period: "最新一季資產負債表與近四季現金流量表。", notFor: ["成長期需要大量投資的公司（現金流暫時為負但前景好）"],
    finance: "金融股負債比天生很高，實際上不會出現在結果中。",
  }),
  single({
    id: "healthy", name: "財務健康 A 級", category: "基本面", tagline: "五項財務指標綜合表現好",
    plain: "依盈利、流動性、財務結構、營運效率、成長性五項的全市場百分位平均打分數，80 分以上大約是 A 級。",
    params: [{ key: "score", label: "健康度至少", value: 80, unit: "分" }],
    conds: (p) => [{ field: "health_score", op: "ge", a: p.score }],
    rules: (p) => [`財務健康度 ≥ ${p.score} 分（0–100）`],
    cols: [...B, "health_score", "roe", "debt_ratio", "rev_yoy"], sort: { key: "health_score", dir: -1 },
    period: "最新四季財報與近 12 個月營收。", notFor: ["分數是全市場相對排名，景氣整體變差時 A 級公司也可能在衰退"],
    finance: "金融股只計盈利與成長兩項，分數不宜跟一般產業直接比較。",
  }),
  single({
    id: "below_book", name: "跌破淨值仍賺錢", category: "基本面", tagline: "股價低於帳面價值",
    plain: "股價淨值比小於 1，代表股價比公司帳面淨值還低；再加上仍有賺錢，可能被市場低估。",
    params: [{ key: "pb", label: "股價淨值比低於", value: 1, unit: "倍", step: 0.1 }],
    conds: (p) => [{ field: "pb", op: "between", a: 0.01, b: p.pb }, { field: "eps_ttm", op: "ge", a: 0.01 }],
    rules: (p) => [`股價淨值比 ≤ ${p.pb} 倍`, "近四季 EPS > 0"],
    cols: [...B, "pb", "pe", "roe", "dividend_yield"], sort: { key: "pb", dir: 1 },
    period: "最新收盤價與最新一季淨值。", notFor: ["產業長期衰退、資產價值會持續縮水的公司（價值陷阱）", "景氣循環股在景氣高點時淨值也偏高"],
  }),
  single({
    id: "high_yield", name: "高殖利率", category: "基本面", tagline: "股息報酬特別高",
    plain: "用目前股價計算，去年的現金股利能換到多少報酬率。殖利率特別高時要確認是不是一次性大方配息。",
    params: [{ key: "y", label: "殖利率至少", value: 7, unit: "%", step: 0.5 }],
    conds: (p) => [{ field: "dividend_yield", op: "ge", a: p.y }],
    rules: (p) => [`現金殖利率 ≥ ${p.y}%`],
    cols: [...B, "dividend_yield", "cash_div_last", "div_years", "eps_ttm"], sort: { key: "dividend_yield", dir: -1 },
    period: "最近一年度現金股利 ÷ 最新收盤價。", notFor: ["獲利已衰退、明年股利可能大減的公司", "一次性處分資產後的特別股利"],
  }),
];
