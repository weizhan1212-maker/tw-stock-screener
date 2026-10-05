/**
 * 篩選欄位定義：名稱、分類、單位、白話說明。
 * key 必須對應 pipeline/snapshot.py 輸出的欄位（或下方 derived 欄位）。
 */
export type Format = "price" | "pct" | "lots" | "yi" | "yiRaw" | "times" | "days" | "num" | "bool" | "years";
export type Group = "價量" | "技術面" | "估值" | "籌碼面" | "基本面";

export interface Field {
  key: string;
  label: string;
  group: Group;
  format: Format;
  help: string;
}

export const FIELDS: Field[] = [
  // 價量
  { key: "close", label: "收盤價", group: "價量", format: "price", help: "最近一個交易日的收盤價（元）。" },
  { key: "chg_pct", label: "漲跌幅", group: "價量", format: "pct", help: "跟前一個交易日相比漲跌了幾 %（已扣除除權息影響）。" },
  { key: "volume_lots", label: "成交量", group: "價量", format: "lots", help: "當天成交多少張（1 張 = 1,000 股）。量太小的股票不好買賣。" },
  { key: "value", label: "成交金額", group: "價量", format: "yi", help: "當天成交了多少錢（億元）。" },
  { key: "market_cap", label: "市值", group: "價量", format: "yiRaw", help: "股價 × 發行股數，代表公司規模（億元）。" },

  // 技術面
  { key: "above_ma20", label: "站上月線", group: "技術面", format: "bool", help: "股價高於 20 日平均價，代表短期走勢偏多。" },
  { key: "above_ma60", label: "站上季線", group: "技術面", format: "bool", help: "股價高於 60 日平均價，代表中期走勢偏多。" },
  { key: "above_ma240", label: "站上年線", group: "技術面", format: "bool", help: "股價高於 240 日平均價，代表長期走勢偏多。" },
  { key: "bull_align", label: "均線多頭排列", group: "技術面", format: "bool", help: "股價 > 5 日線 > 20 日線 > 60 日線，短中期趨勢一致向上。" },
  { key: "ret5", label: "近 5 日漲幅", group: "技術面", format: "pct", help: "最近 5 個交易日漲跌幅。" },
  { key: "ret20", label: "近 20 日漲幅", group: "技術面", format: "pct", help: "最近 20 個交易日（約一個月）漲跌幅。" },
  { key: "ret60", label: "近 60 日漲幅", group: "技術面", format: "pct", help: "最近 60 個交易日（約一季）漲跌幅。" },
  { key: "ret120", label: "近 120 日漲幅", group: "技術面", format: "pct", help: "最近 120 個交易日（約半年）漲跌幅。" },
  { key: "dist_high52", label: "距 52 週高點", group: "技術面", format: "pct", help: "目前股價比一年內最高價低多少 %。-5% 代表離高點只差 5%。" },
  { key: "dist_low52", label: "距 52 週低點", group: "技術面", format: "pct", help: "目前股價比一年內最低價高多少 %。" },
  { key: "new_high20", label: "創 20 日新高", group: "技術面", format: "bool", help: "收盤價是最近 20 個交易日最高。" },
  { key: "new_high60", label: "創 60 日新高", group: "技術面", format: "bool", help: "收盤價是最近 60 個交易日最高。" },
  { key: "vol_ratio", label: "量比", group: "技術面", format: "times", help: "今天成交量是過去 20 天平均的幾倍。大於 2 通常叫「爆量」。" },
  { key: "k", label: "KD 的 K 值", group: "技術面", format: "num", help: "0–100，數字越高代表近期漲勢越強；80 以上偏熱、20 以下偏冷。" },
  { key: "d", label: "KD 的 D 值", group: "技術面", format: "num", help: "K 值的平滑線，用法同 K 值。" },
  { key: "kd_golden", label: "KD 黃金交叉", group: "技術面", format: "bool", help: "今天 K 值由下往上穿過 D 值，常被視為短線轉強訊號。" },
  { key: "macd_hist", label: "MACD 柱狀體", group: "技術面", format: "num", help: "正值代表多方動能、負值代表空方動能。" },
  { key: "macd_golden", label: "MACD 黃金交叉", group: "技術面", format: "bool", help: "今天 DIF 由下往上穿過訊號線，常被視為中期轉強訊號。" },
  { key: "rsi14", label: "RSI(14)", group: "技術面", format: "num", help: "0–100，衡量漲跌力道。70 以上偏熱、30 以下偏冷。" },
  { key: "boll_pctb", label: "布林 %b", group: "技術面", format: "pct", help: "股價在布林通道中的位置：0% 在下緣、100% 在上緣。" },

  // 估值
  { key: "pe", label: "本益比", group: "估值", format: "times", help: "股價 ÷ 每股盈餘。數字越低越便宜，但虧損公司沒有本益比。" },
  { key: "pb", label: "股價淨值比", group: "估值", format: "times", help: "股價 ÷ 每股淨值。小於 1 代表股價低於公司帳面價值。" },
  { key: "dividend_yield", label: "殖利率", group: "估值", format: "pct", help: "一年現金股利 ÷ 股價。存股族最常看的指標。" },
  { key: "psr", label: "股價營收比", group: "估值", format: "times", help: "市值 ÷ 近 12 個月營收。適合看還沒賺錢或獲利波動大的公司。" },
  { key: "pcf", label: "股價現金流比", group: "估值", format: "times", help: "市值 ÷ 近四季營業現金流。越低代表用越便宜的價格買到現金流。" },
  { key: "pe_pb", label: "本益比 × 淨值比", group: "估值", format: "num", help: "葛拉漢的合理價檢查：本益比乘以股價淨值比小於 22.5 算便宜。" },
  { key: "peg", label: "PEG", group: "估值", format: "num", help: "本益比 ÷ EPS 年成長率（%）。彼得林區認為小於 1 代表成長被低估。" },
  { key: "earnings_yield", label: "盈餘殖利率（神奇公式）", group: "估值", format: "pct", help: "營業利益 ÷ 企業價值（市值＋有息負債−現金）。越高代表越便宜。" },

  // 籌碼面
  { key: "foreign_net", label: "外資買賣超", group: "籌碼面", format: "lots", help: "外資今天買進減賣出的張數，正數是買超。" },
  { key: "foreign_net5", label: "外資 5 日買賣超", group: "籌碼面", format: "lots", help: "外資最近 5 個交易日合計買賣超張數。" },
  { key: "foreign_net20", label: "外資 20 日買賣超", group: "籌碼面", format: "lots", help: "外資最近 20 個交易日合計買賣超張數。" },
  { key: "foreign_buy_streak", label: "外資連買天數", group: "籌碼面", format: "days", help: "外資連續買超幾天（今天沒買超就是 0）。" },
  { key: "trust_net", label: "投信買賣超", group: "籌碼面", format: "lots", help: "投信（基金公司）今天買賣超張數。" },
  { key: "trust_net5", label: "投信 5 日買賣超", group: "籌碼面", format: "lots", help: "投信最近 5 個交易日合計買賣超張數。" },
  { key: "trust_net20", label: "投信 20 日買賣超", group: "籌碼面", format: "lots", help: "投信最近 20 個交易日合計買賣超張數。" },
  { key: "trust_buy_streak", label: "投信連買天數", group: "籌碼面", format: "days", help: "投信連續買超幾天。投信連買常被視為「投信認養」。" },
  { key: "dealer_net", label: "自營商買賣超", group: "籌碼面", format: "lots", help: "證券商自己的部位今天買賣超張數。" },
  { key: "total_net", label: "三大法人買賣超", group: "籌碼面", format: "lots", help: "外資＋投信＋自營商今天合計買賣超張數。" },
  { key: "total_value", label: "三大法人買賣超金額", group: "籌碼面", format: "yiRaw", help: "三大法人今天買賣超的估算金額（買賣超張數 × 收盤價，億元）。" },
  { key: "foreign_value", label: "外資買賣超金額", group: "籌碼面", format: "yiRaw", help: "外資今天買賣超的估算金額（億元）。" },
  { key: "trust_value", label: "投信買賣超金額", group: "籌碼面", format: "yiRaw", help: "投信今天買賣超的估算金額（億元）。" },
  { key: "daytrade_lots", label: "當沖量", group: "籌碼面", format: "lots", help: "今天當日沖銷（同一天買進又賣出）的成交張數。" },
  { key: "daytrade_ratio", label: "當沖比", group: "籌碼面", format: "pct", help: "當沖量占成交量的比例。偏高代表短線投機資金多。" },
  { key: "sbl_sell_lots", label: "借券賣出", group: "籌碼面", format: "lots", help: "今天借券賣出的張數，常被視為法人看空或避險。" },
  { key: "sbl_balance_lots", label: "借券賣出餘額", group: "籌碼面", format: "lots", help: "借券賣出還沒還回去的張數。" },
  { key: "block_value", label: "鉅額交易金額", group: "籌碼面", format: "yi", help: "今天鉅額交易（大宗交易）的成交金額（億元）。" },
  { key: "foreign_ratio", label: "外資持股比", group: "籌碼面", format: "pct", help: "外資持有的股數占發行股數的比例。" },
  { key: "big_pct", label: "千張大戶持股比", group: "籌碼面", format: "pct", help: "持有 1,000 張以上的股東合計持股比例（集保資料，每週五更新）。比例上升代表籌碼往大戶集中。" },
  { key: "big_pct_chg", label: "千張大戶週增減", group: "籌碼面", format: "pct", help: "千張大戶持股比例跟上一週相比增減幾個百分點。" },
  { key: "margin_balance", label: "融資餘額", group: "籌碼面", format: "lots", help: "散戶借錢買股票、還沒還的張數。增加太快代表散戶追高。" },
  { key: "margin_chg5", label: "融資 5 日增減", group: "籌碼面", format: "lots", help: "融資餘額跟 5 個交易日前相比增減的張數。" },
  { key: "short_balance", label: "融券餘額", group: "籌碼面", format: "lots", help: "借券賣出、還沒買回的張數。" },
  { key: "short_margin_ratio", label: "券資比", group: "籌碼面", format: "pct", help: "融券餘額 ÷ 融資餘額。偏高時可能出現「軋空」。" },

  // 基本面
  { key: "eps_ttm", label: "近四季 EPS", group: "基本面", format: "price", help: "最近四季每股盈餘合計（元），代表一年賺多少。" },
  { key: "eps_q", label: "單季 EPS", group: "基本面", format: "price", help: "最近一季每股盈餘（元）。" },
  { key: "eps_q_yoy", label: "單季 EPS 年增率", group: "基本面", format: "pct", help: "最近一季 EPS 跟去年同一季相比成長幾 %。" },
  { key: "rev_yoy", label: "月營收年增率", group: "基本面", format: "pct", help: "最新一個月營收跟去年同月相比成長幾 %。" },
  { key: "rev_yoy_min3", label: "近 3 月營收年增率（最低）", group: "基本面", format: "pct", help: "最近 3 個月營收年增率中最低的那個。設「≥ 20%」就等於「連續 3 個月年增 20% 以上」。" },
  { key: "rev_mom", label: "月營收月增率", group: "基本面", format: "pct", help: "最新一個月營收跟上個月相比成長幾 %。" },
  { key: "gross_margin", label: "毛利率", group: "基本面", format: "pct", help: "（營收 − 成本）÷ 營收。越高代表產品越有競爭力。" },
  { key: "op_margin", label: "營業利益率", group: "基本面", format: "pct", help: "本業賺的錢 ÷ 營收。" },
  { key: "net_margin", label: "淨利率", group: "基本面", format: "pct", help: "稅後淨利 ÷ 營收。" },
  { key: "roe", label: "ROE", group: "基本面", format: "pct", help: "股東權益報酬率：公司用股東的錢一年賺多少 %。巴菲特看重 15% 以上。" },
  { key: "roa", label: "ROA", group: "基本面", format: "pct", help: "資產報酬率：公司用全部資產一年賺多少 %。" },
  { key: "debt_ratio", label: "負債比", group: "基本面", format: "pct", help: "總負債 ÷ 總資產。越低財務越穩健。" },
  { key: "current_ratio", label: "流動比率", group: "基本面", format: "times", help: "流動資產 ÷ 流動負債。大於 2 代表短期還債能力好。" },
  { key: "roc", label: "資本報酬率（神奇公式）", group: "基本面", format: "pct", help: "營業利益 ÷（淨營運資金＋固定資產）。越高代表做生意越有效率。" },
  { key: "roe_min5y", label: "近 5 年最低 ROE", group: "基本面", format: "pct", help: "近 5 個完整年度中 ROE 最低的那一年。大於 15% 代表 5 年都很會賺。" },
  { key: "eps_cagr3", label: "EPS 3 年年化成長率", group: "基本面", format: "pct", help: "年度 EPS 近 3 年平均每年成長幾 %。" },
  { key: "eps_growth_3v3", label: "近 3 年 vs 前 3 年平均 EPS", group: "基本面", format: "times", help: "近 3 年平均 EPS ÷ 前 3 年平均 EPS。1.33 代表成長三分之一。" },
  { key: "eps_up3y", label: "年度 EPS 連 3 年成長", group: "基本面", format: "bool", help: "最近 3 個年度的 EPS 一年比一年高。" },
  { key: "rev_ttm_yoy", label: "近 12 月營收年增率", group: "基本面", format: "pct", help: "最近 12 個月營收跟前 12 個月相比成長幾 %。" },
  { key: "f_score", label: "F-Score", group: "基本面", format: "num", help: "皮爾托斯基的 9 項財務健康分數（獲利、現金流、槓桿、效率是否改善），0–9 分，越高越健康。" },
  { key: "neff_ratio", label: "總報酬比（聶夫）", group: "估值", format: "num", help: "（EPS 成長率 % ＋ 殖利率 %）÷ 本益比。越高代表用越低的價格買到成長加股利。" },
  { key: "fcf_ttm", label: "近四季自由現金流", group: "基本面", format: "yi", help: "營業現金流 − 資本支出（億元）。正數代表真的有賺到現金。" },
  { key: "eps_min5y", label: "近 5 年最低年 EPS", group: "基本面", format: "price", help: "近 5 個完整年度中，年 EPS 最低的那一年。大於 0 代表 5 年都賺錢。" },
  { key: "gm_stability", label: "毛利率穩定度", group: "基本面", format: "pct", help: "近 5 年毛利率最低值 ÷ 最高值。越接近 100% 越穩定。" },
  { key: "health_score", label: "財務健康度", group: "基本面", format: "num", help: "盈利能力、流動性、財務結構、營運效率、成長性五項的平均分數（0–100），用全市場百分位計算。85 分以上為 A+。" },
  { key: "div_years", label: "連續配息年數", group: "基本面", format: "years", help: "連續幾年都有發現金股利。" },
  { key: "cash_div_last", label: "最近一年現金股利", group: "基本面", format: "price", help: "最近一個年度合計發多少現金股利（元）。" },
];

/** 只在策略結果裡出現、不放進自訂篩選選單的欄位 */
const HIDDEN: Field[] = [
  { key: "magic_rank", label: "神奇公式排名", group: "估值", format: "num", help: "盈餘殖利率與資本報酬率兩項排名相加後的名次。" },
  { key: "years_fin", label: "財報年數", group: "基本面", format: "years", help: "有完整四季財報的年數。" },
];

export const FIELD_MAP: Record<string, Field> = Object.fromEntries([...FIELDS, ...HIDDEN].map((f) => [f.key, f]));
export const GROUPS: Group[] = ["價量", "技術面", "估值", "籌碼面", "基本面"];

export const UNIT: Partial<Record<Format, string>> = {
  price: "元", pct: "%", lots: "張", yi: "億", yiRaw: "億", times: "倍", days: "天", years: "年",
};

/** 常用條件：空白狀態時給一鍵加入 */
export const QUICK: { label: string; field: string; op: "ge" | "le" | "is"; a?: number }[] = [
  { label: "殖利率 ≥ 5%", field: "dividend_yield", op: "ge", a: 5 },
  { label: "本益比 ≤ 15 倍", field: "pe", op: "le", a: 15 },
  { label: "投信連買 ≥ 3 天", field: "trust_buy_streak", op: "ge", a: 3 },
  { label: "站上月線", field: "above_ma20", op: "is" },
  { label: "營收連 3 月年增 ≥ 20%", field: "rev_yoy_min3", op: "ge", a: 20 },
  { label: "成交量 ≥ 500 張", field: "volume_lots", op: "ge", a: 500 },
];
