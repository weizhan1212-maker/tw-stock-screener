import { Suspense } from "react";
import IndustryPage from "@/components/IndustryPage";

export async function generateMetadata(props: PageProps<"/industry/[name]">) {
  const { name } = await props.params;
  let decoded = name;
  try { decoded = decodeURIComponent(name); } catch { /* 已解碼 */ }
  return { title: `${decoded}｜股見未來` };
}

export default async function Page(props: PageProps<"/industry/[name]">) {
  const { name } = await props.params;
  let decoded = name;
  try { decoded = decodeURIComponent(name); } catch { /* 已解碼 */ }
  return <Suspense><IndustryPage name={decoded} /></Suspense>;
}
