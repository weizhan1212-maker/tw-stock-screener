import { Suspense } from "react";
import Compare from "@/components/Compare";

export const metadata = { title: "多股比較｜股見未來" };

export default function Page() {
  return <Suspense><Compare /></Suspense>;
}
