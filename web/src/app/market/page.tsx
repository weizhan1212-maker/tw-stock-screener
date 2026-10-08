import { Suspense } from "react";
import MarketOverview from "@/components/MarketOverview";

export const metadata = { title: "市場總覽｜股見未來" };

export default function Page() {
  return <Suspense><MarketOverview /></Suspense>;
}
