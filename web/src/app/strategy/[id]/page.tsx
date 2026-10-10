import { notFound } from "next/navigation";
import StrategyDetail from "@/components/StrategyDetail";
import { STRATEGIES, STRATEGY_MAP } from "@/lib/strategies";

export function generateStaticParams() {
  return STRATEGIES.map((s) => ({ id: s.id }));
}

export async function generateMetadata(props: PageProps<"/strategy/[id]">) {
  const { id } = await props.params;
  const s = STRATEGY_MAP[id];
  return { title: s ? `${s.name}策略｜股見未來` : "策略選股｜股見未來" };
}

export default async function Page(props: PageProps<"/strategy/[id]">) {
  const { id } = await props.params;
  if (!STRATEGY_MAP[id]) notFound();
  return <StrategyDetail id={id} />;
}
