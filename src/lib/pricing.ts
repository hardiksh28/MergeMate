export type Tier = {
  id: string;
  name: string;
  spots: number | null; // null = unlimited
  usd: number;
  inr: number;
  perk: string;
};

// Each tier keeps its price for as long as the member stays subscribed.
export const TIERS: Tier[] = [
  { id: "og", name: "OG 100", spots: 100, usd: 8, inr: 299, perk: "3 months free, then locked forever" },
  { id: "early", name: "Early 100", spots: 100, usd: 8, inr: 299, perk: "Locked forever" },
  { id: "wave", name: "Wave 3", spots: 100, usd: 10, inr: 399, perk: "Locked forever" },
  { id: "public", name: "Public", spots: null, usd: 15, inr: 599, perk: "Standard price" },
];

export const FREE_ISSUES_PER_MONTH = 2;
