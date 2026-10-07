import IndustryPage from "@/components/IndustryPage";

export default async function Page(props: PageProps<"/industry/[name]">) {
  const { name } = await props.params;
  let decoded = name;
  try { decoded = decodeURIComponent(name); } catch { /* 已解碼 */ }
  return <IndustryPage name={decoded} />;
}
