import { Suspense } from "react";
import Screener from "@/components/Screener";

export default function Page() {
  return (
    <Suspense>
      <Screener />
    </Suspense>
  );
}
