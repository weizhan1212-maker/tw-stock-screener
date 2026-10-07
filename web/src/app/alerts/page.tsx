import { Suspense } from "react";
import Alerts from "@/components/Alerts";

export const metadata = { title: "警報｜股見未來" };

export default function Page() {
  return <Suspense><Alerts /></Suspense>;
}
