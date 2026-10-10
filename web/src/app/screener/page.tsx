import { Suspense } from "react";
import Screener from "@/components/Screener";

export const metadata = { title: "自訂篩選｜股見未來" };

export default function Page() {
  return (
    <Suspense>
      <Screener />
    </Suspense>
  );
}
