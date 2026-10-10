import { Suspense } from "react";
import MarketOverview from "@/components/MarketOverview";

export const metadata = { title: "市場總覽｜股見未來" };

/** 首頁＝市場總覽（一打開網站先看大盤、資金輪動與 AI 市場摘要）。策略選股移到 /strategy。 */
export default function Page() {
  return <Suspense><MarketOverview /></Suspense>;
}
