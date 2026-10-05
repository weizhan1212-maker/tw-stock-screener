import IndexPage from "@/components/IndexPage";

export default async function Page(props: PageProps<"/market/index/[name]">) {
  const { name } = await props.params;
  return <IndexPage name={decodeURIComponent(name)} />;
}
