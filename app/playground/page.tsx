import type { Metadata } from "next";
import { Playground } from "@/components/playground/playground";

export const metadata: Metadata = {
  title: "Sandbox — X++Lab",
  description:
    "Write X++ and see the Infolog, the rows that changed and the SQL it generated. Runs entirely in your browser.",
};

export default function PlaygroundPage() {
  return <Playground />;
}
