import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TrackIndex } from "@/components/lesson/track-index";
import { track } from "@/content/tracks/xpp-for-nav-devs";

export function generateStaticParams() {
  return [{ track: track.slug }];
}

export const metadata: Metadata = {
  title: `${track.title} — X++Lab`,
  description: track.summary,
};

export default async function TrackPage({ params }: PageProps<"/learn/[track]">) {
  const { track: trackSlug } = await params;
  if (trackSlug !== track.slug) notFound();

  return <TrackIndex />;
}
