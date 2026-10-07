import { Suspense } from "react";
import Backtest from "@/components/Backtest";

export const metadata = { title: "回測｜股見未來" };

export default function Page() {
  return <Suspense><Backtest /></Suspense>;
}
