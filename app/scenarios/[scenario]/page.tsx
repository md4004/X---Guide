import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ScenarioScreen } from "@/components/scenario/scenario-screen";
import { getScenario, orderedScenarioSlugs } from "@/content/scenarios";

export function generateStaticParams() {
  return orderedScenarioSlugs.map((scenario) => ({ scenario }));
}

export async function generateMetadata({
  params,
}: PageProps<"/scenarios/[scenario]">): Promise<Metadata> {
  const { scenario: slug } = await params;
  const scenario = getScenario(slug);
  if (scenario === undefined) return { title: "Scenario not found — X++Lab" };

  return { title: `${scenario.title} — X++Lab`, description: scenario.summary };
}

export default async function ScenarioPage({ params }: PageProps<"/scenarios/[scenario]">) {
  const { scenario: slug } = await params;
  const scenario = getScenario(slug);
  if (scenario === undefined) notFound();

  // Plain data all the way down, so the whole definition can cross to the client.
  return <ScenarioScreen scenario={scenario} />;
}
