import { redirect } from "next/navigation";

/** 舊網址：市場總覽已移到首頁，保留查詢參數轉過去。 */
export default async function Page(props: PageProps<"/market">) {
  const sp = await props.searchParams;
  const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v == null ? [] : (Array.isArray(v) ? v : [v]).map((x) => [k, x] as [string, string])))).toString();
  redirect(q ? `/?${q}` : "/");
}
