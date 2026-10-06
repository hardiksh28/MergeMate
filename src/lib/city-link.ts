// Links into MergeCity (separate app). Safe for client and server.
export const MERGECITY_URL = (process.env.NEXT_PUBLIC_MERGECITY_URL || "https://merge-city.vercel.app").replace(/\/$/, "");

/** MergeCity home, keeping a MergeMate referral code if there is one. */
export function cityUrl(opts: { ref?: string | null } = {}) {
  return opts.ref ? `${MERGECITY_URL}/r/${encodeURIComponent(opts.ref)}` : MERGECITY_URL;
}
