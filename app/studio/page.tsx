import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";

export const metadata: Metadata = {
  title: "Studio — X++Lab",
  description:
    "The Visual Studio development tools for Dynamics 365 Finance & Operations, simulated: the AOT, element designers, the property grid, and a working X++ debugger.",
};

export default function StudioPage() {
  return <Studio />;
}
