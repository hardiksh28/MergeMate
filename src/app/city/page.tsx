import { redirect } from "next/navigation";
import { cityUrl } from "@/lib/city-link";

// MergeCity is its own app now; keep old /city links (and referral codes) working.
export default async function City(props: PageProps<"/city">) {
  const q = await props.searchParams;
  redirect(cityUrl({ ref: typeof q.ref === "string" ? q.ref : null }));
}
