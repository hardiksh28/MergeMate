import type { Metadata } from "next";
import { PublicProfile } from "./PublicProfile";

export async function generateMetadata(props: PageProps<"/u/[username]">): Promise<Metadata> {
  const { username } = await props.params;
  return {
    title: `@${username} · open source proof of work · MergeMate`,
    description: `Merged PRs, live GitHub activity and skills proven by real contributions from @${username}.`,
  };
}

export default async function Page(props: PageProps<"/u/[username]">) {
  const { username } = await props.params;
  return <PublicProfile username={username} />;
}
