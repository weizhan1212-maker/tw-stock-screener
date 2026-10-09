import { Suspense } from "react";
import StockPage from "@/components/StockPage";

export default async function Page(props: PageProps<"/stock/[code]">) {
  const { code } = await props.params;
  return <Suspense><StockPage code={decodeURIComponent(code).toUpperCase()} /></Suspense>;
}
