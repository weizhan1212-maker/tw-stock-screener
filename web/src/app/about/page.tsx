/**
 * 落地頁（公開，不需登入）：給 Willy 分享給朋友，介紹網站並引導用 Google 登入申請。
 * 不放任何績效數字或個股推薦（避免被當成投顧廣告）。
 */
import type { Metadata } from "next";
import Link from "next/link";
import { HeroParallax, Reveal, SpotCard } from "./LpClient";
import "./lp.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://tw-stock-screener-willy1212.vercel.app"),
  title: "股見未來｜台股盤後選股工具（邀請制）",
  description: "把台股盤後資料整理成看得懂的選股工具：38 套策略、自訂篩選、回測、產業熱力圖、個股風險框架、警報通知。邀請制、免費。",
  openGraph: {
    title: "股見未來｜台股盤後選股工具",
    description: "38 套策略、自訂篩選、回測、產業熱力圖、警報通知。邀請制、免費。",
    images: ["/logo.png"],
    locale: "zh_TW",
    type: "website",
  },
};

const FEATURES: { tag: string; title: string; body: string; points: string[] }[] = [
  {
    tag: "策略選股", title: "38 套現成策略，條件全部攤開",
    body: "存股、價值、成長、動能、籌碼，加上葛拉漢、神奇公式、CAN SLIM 等大師方法的台股量化版，還有 24 套單一訊號策略。",
    points: ["每套都寫明條件、資料期間、金融股怎麼處理", "列出「不適用情境」，知道什麼時候該放棄", "數字可以自己調，一鍵帶去回測"],
  },
  {
    tag: "自訂篩選", title: "100 多個指標，自己組條件",
    body: "價量、技術面、估值、籌碼、基本面、ETF，每個指標都有白話說明。邊加條件邊看還剩幾檔。",
    points: ["篩選品質檢查：條件太嚴、重複、產業集中都會提醒", "結果表欄位自己選，條件組合可以存起來", "下載 CSV"],
  },
  {
    tag: "回測", title: "照過去的資料模擬一遍",
    body: "每月收盤後選股、隔天開盤買進，扣掉手續費、證交稅與滑價，跟含息的大盤比。",
    points: ["財報、營收要等公布後才用，不偷看未來", "包含已下市股票，避免只看到存活者", "總報酬、最大回撤、夏普值、每期持股都看得到"],
  },
  {
    tag: "個股", title: "一頁看完一檔股票",
    body: "K 線與技術指標、法人與融資、月營收、季財報、股利，再加上這些整理好的判斷工具：",
    points: ["風險框架：ATR、回撤、失效訊號、部位大小試算", "財務健康分數：為什麼是這個分數、差什麼升級", "估值情境、填息與財報公布前後的歷史表現"],
  },
  {
    tag: "市場", title: "大盤、產業、情緒一次看",
    body: "指數、漲跌家數、法人買賣、融資融券之外，還把數字翻成白話。",
    points: ["市場結構警示：指數漲但多數股票跌，會直接告訴你", "產業熱力圖與產業頁：誰在領漲、誰落後", "恐懼與貪婪指數、選擇權 Put/Call 比、外資期貨部位"],
  },
  {
    tag: "追蹤", title: "自選股、投資組合、警報",
    body: "把關心的股票和持股記下來，條件到了自動通知。",
    points: ["投資組合：成本、理由、目標價、失效價、損益", "警報：策略有新股入選、股價到價、持股到目標或失效價", "網站內通知＋Telegram 推播"],
  },
];

const FAQ: [string, string][] = [
  ["要錢嗎？", "不用。這是給朋友用的網站，沒有付費方案，也沒有廣告。"],
  ["是即時報價嗎？", "不是。網站用的是盤後資料，每個交易日傍晚約 18:45 更新完成，適合下班後研究，不適合當沖看盤。"],
  ["會報明牌嗎？", "不會。網站只是把公開資料整理成篩選和分析工具，所有結果都只是依條件算出來的清單，不是買賣建議。"],
  ["手機可以用嗎？", "可以，手機和電腦都能用，也支援深色模式。"],
  ["我的資料誰看得到？", "自選股、投資組合、篩選組合和警報都只有你自己看得到。登入只用 Google 帳號，不會拿到你的密碼。"],
  ["資料從哪裡來？", "臺灣證券交易所、證券櫃檯買賣中心、期貨交易所、集保結算所、國發會等官方公開資料，以及 FinMind 的歷史財報。"],
];

function Cta({ big = false }: { big?: boolean }) {
  return (
    <Link href="/login" className="lp-btn" style={big ? undefined : { padding: "9px 18px", fontSize: 14 }}>
      用 Google 登入申請
      <span aria-hidden>→</span>
    </Link>
  );
}

/** 畫面示意（純裝飾，不是真實資料） */
function Mock() {
  const rows: [string, string, string][] = [["存股", "高殖利率、年年配息", "▲"], ["神奇公式", "好公司 × 便宜價", "▲"], ["創 52 週新高", "股價來到一年來最高", "▼"]];
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md select-none">
      <div className="absolute -inset-6 -z-10 rounded-3xl blur-3xl" style={{ background: "rgba(94,106,210,0.22)" }} />
      <SpotCard className="p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="font-semibold text-ink">策略選股</span><span className="lp-label" style={{ fontSize: 10 }}>畫面示意</span>
        </div>
        <ul className="mt-3 space-y-2">
          {rows.map(([n, t, a], i) => (
            <li key={n} className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}>
              <span><b className="block text-sm font-medium text-ink">{n}</b><span className="text-xs text-muted">{t}</span></span>
              <span className={`text-xs ${i === 2 ? "text-down" : "text-up"}`}>{a}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[["條件公開", "每一條"], ["回測", "含交易成本"], ["警報", "Telegram"]].map(([k, v]) => (
            <div key={k} className="rounded-lg px-2 py-2" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="text-[11px] text-muted">{k}</div><div className="text-xs font-semibold text-ink">{v}</div>
            </div>
          ))}
        </div>
        <svg viewBox="0 0 300 60" className="mt-3 h-14 w-full">
          <defs><linearGradient id="lpg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#5e6ad2" stopOpacity="0.35" /><stop offset="1" stopColor="#5e6ad2" stopOpacity="0" /></linearGradient></defs>
          <polygon points="0,48 30,44 60,46 90,36 120,38 150,28 180,30 210,20 240,24 270,12 300,14 300,60 0,60" fill="url(#lpg)" />
          <polyline points="0,48 30,44 60,46 90,36 120,38 150,28 180,30 210,20 240,24 270,12 300,14" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinejoin="round" />
          <polyline points="0,50 30,49 60,48 90,45 120,46 150,41 180,42 210,38 240,39 270,34 300,35" fill="none" stroke="#8a8f98" strokeWidth="1.5" strokeDasharray="4 3" />
        </svg>
      </SpotCard>
    </div>
  );
}

// 不對稱 bento：6 欄，卡片寬度不一
const SPAN = ["lg:col-span-4", "lg:col-span-2", "lg:col-span-2", "lg:col-span-2", "lg:col-span-2", "lg:col-span-6"];

export default function AboutPage() {
  return (
    <div className="lp">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" />
      <div className="lp-bg" aria-hidden>
        <div className="lp-noise" /><div className="lp-grid" />
        <div className="lp-blob b1" /><div className="lp-blob b2" /><div className="lp-blob b3" /><div className="lp-blob b4" />
      </div>

      {/* 簡單品牌列（落地頁不放站內選單） */}
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-4 pt-5">
        <span className="flex items-center gap-2 text-[17px] font-semibold tracking-wide text-ink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={26} height={26} className="h-[26px] w-[26px]" />
          股見未來
        </span>
        <Link href="/login" className="rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-white/5 hover:text-ink">登入</Link>
      </header>

      {/* 主視覺 */}
      <section className="mx-auto max-w-[1120px] px-4 pb-20 pt-14 md:pt-24">
        <HeroParallax>
          <div className="grid items-center gap-12 md:grid-cols-[1.1fr_1fr]">
            <div>
              <Reveal>
                <span className="lp-pill">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="" width={16} height={16} className="h-4 w-4" />
                  邀請制・免費・給朋友用
                </span>
              </Reveal>
              <Reveal delay={80}>
                <h1 className="mt-6 text-[32px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[48px] lg:text-[56px]">
                  <span className="lp-grad">台股盤後資料<br /></span><span className="lp-shimmer">看得懂</span><span className="lp-grad">的選股工具</span>
                </h1>
              </Reveal>
              <Reveal delay={160}>
                <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
                  38 套策略、100 多個篩選指標、回測、產業熱力圖、個股風險框架與警報通知。
                  每個數字都有白話說明，每套策略的條件都攤開給你看。
                </p>
              </Reveal>
              <Reveal delay={240}>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Cta big />
                  <a href="#features" className="lp-btn2">看看有什麼功能</a>
                </div>
                <p className="mt-4 text-xs text-muted">第一次登入後送出申請，管理員核准後就能使用。</p>
              </Reveal>
            </div>
            <Reveal delay={200}><Mock /></Reveal>
          </div>
        </HeroParallax>
      </section>

      {/* 三個原則 */}
      <div className="lp-hr" />
      <section>
        <div className="mx-auto grid max-w-[1120px] gap-8 px-4 py-14 sm:grid-cols-3">
          {[
            ["01", "看得懂", "每個指標都有白話解釋，紅漲綠跌、深淺色都好讀。"],
            ["02", "攤開來", "策略條件、資料期間、不適用情境全部公開，不是黑盒子。"],
            ["03", "不報牌", "只整理公開資料，結果是依條件算出的清單，不是買賣建議。"],
          ].map(([n, t, b], i) => (
            <Reveal key={t} delay={i * 80}>
              <span className="lp-label">{n}</span>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
            </Reveal>
          ))}
        </div>
      </section>
      <div className="lp-hr" />

      {/* 功能（不對稱 bento） */}
      <section id="features" className="mx-auto max-w-[1120px] scroll-mt-6 px-4 py-20">
        <Reveal>
          <span className="lp-label">Features</span>
          <h2 className="lp-grad mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">有什麼功能</h2>
          <p className="mt-3 text-muted">從找股票、驗證想法，到持有後的追蹤，一個網站做完。</p>
        </Reveal>
        <div className="mt-10 grid gap-4 lg:grid-cols-6">
          {FEATURES.map((x, i) => (
            <Reveal key={x.tag} delay={(i % 3) * 80} className={`flex ${SPAN[i]}`}>
              <SpotCard className={`flex w-full flex-col ${i === 0 ? "p-7" : "p-6"}`}>
                <span className="lp-pill w-fit">{x.tag}</span>
                <h3 className={`mt-4 font-semibold leading-snug tracking-tight text-ink ${i === 0 ? "text-2xl" : "text-xl"}`}>{x.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{x.body}</p>
                <ul className="mt-4 space-y-2 text-sm text-ink">
                  {x.points.map((p) => <li key={p} className="flex gap-2"><span aria-hidden className="text-[#818cf8]">✓</span><span>{p}</span></li>)}
                </ul>
              </SpotCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 適合誰 */}
      <section className="mx-auto grid max-w-[1120px] gap-4 px-4 pb-20 md:grid-cols-2">
        {[
          ["剛開始研究股票", "從現成策略開始，看懂每個條件在找什麼樣的公司；個股頁直接告訴你財務體質、風險在哪、過去除息多久填息。"],
          ["已經有自己的方法", "用 100 多個指標自己組條件，馬上回測三年，比較 38 套策略的表現；條件存起來，有新股票符合時 Telegram 通知你。"],
        ].map(([t, b], i) => (
          <Reveal key={t} delay={i * 80} className="flex">
            <SpotCard className="w-full p-7">
              <h3 className="text-xl font-semibold tracking-tight text-ink">{t}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{b}</p>
            </SpotCard>
          </Reveal>
        ))}
      </section>

      {/* 怎麼加入 */}
      <div className="lp-hr" />
      <section className="mx-auto max-w-[1120px] px-4 py-20">
        <Reveal>
          <span className="lp-label">How it works</span>
          <h2 className="lp-grad mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">怎麼加入</h2>
        </Reveal>
        <ol className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            ["用 Google 登入", "點下面的按鈕，用你的 Google 帳號登入。"],
            ["等待核准", "第一次登入會自動送出申請，跟我說一聲，我核准後就能用。"],
            ["開始使用", "從「策略選股」開始逛，或直接到「自訂篩選」組條件。"],
          ].map(([t, b], i) => (
            <Reveal key={t} delay={i * 80} className="flex">
              <li className="flex w-full list-none">
                <SpotCard className="w-full p-6">
                  <span className="num flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: "#5e6ad2", boxShadow: "0 0 16px rgba(94,106,210,0.5)" }}>{i + 1}</span>
                  <h3 className="mt-4 font-semibold text-ink">{t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{b}</p>
                </SpotCard>
              </li>
            </Reveal>
          ))}
        </ol>
        <Reveal className="mt-10"><Cta big /></Reveal>
      </section>

      {/* 常見問題 */}
      <div className="lp-hr" />
      <section>
        <div className="mx-auto max-w-[820px] px-4 py-20">
          <Reveal>
            <span className="lp-label">FAQ</span>
            <h2 className="lp-grad mt-3 text-3xl font-semibold tracking-tight">常見問題</h2>
          </Reveal>
          <Reveal delay={80}>
            <div className="mt-8 divide-y divide-white/[0.06] rounded-2xl" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
              {FAQ.map(([q, a]) => (
                <details key={q} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-ink">
                    {q}<span aria-hidden className="text-muted transition duration-300 group-open:rotate-45">＋</span>
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <div className="lp-hr" />
      <section className="mx-auto max-w-[820px] px-4 py-20 text-center">
        <Reveal>
          <h2 className="lp-grad text-3xl font-semibold tracking-tight">想一起用？</h2>
          <p className="mt-3 text-sm text-muted">登入後送出申請，核准就能開始。</p>
          <div className="mt-6"><Cta big /></div>
          <p className="mx-auto mt-12 max-w-xl text-xs leading-relaxed text-muted">
            本網站為資料整理與篩選工具，所有內容僅供研究參考，不構成任何投資建議或買賣推薦；回測為歷史模擬，過去表現不代表未來報酬。投資有風險，請自行判斷。
          </p>
        </Reveal>
      </section>
    </div>
  );
}
