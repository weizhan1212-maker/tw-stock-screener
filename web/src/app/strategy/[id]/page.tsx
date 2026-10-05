import { notFound } from "next/navigation";
import StrategyDetail from "@/components/StrategyDetail";
import { STRATEGIES, STRATEGY_MAP } from "@/lib/strategies";

export function generateStaticParams() {
  return STRATEGIES.map((s) => ({ id: s.id }));
}

export default async function Page(props: PageProps<"/strategy/[id]">) {
  const { id } = await props.params;
  if (!STRATEGY_MAP[id]) notFound();
  return <StrategyDetail id={id} />;
}
