import { Suspense } from "react";
import IndustryHome from "@/components/IndustryHome";

export const metadata = { title: "產業｜股見未來" };

export default function Page() {
  return <Suspense><IndustryHome /></Suspense>;
}
