/**
 * Tier-1 source whitelist — authoritative, primary sources only (gov / regulatory,
 * primary institutions, peer-reviewed journals & standards bodies, official
 * company/platform docs, Tier-1 wire services, recognized data authorities).
 *
 * Surfaced to agents via the `tier1_sources` tool so research/decks/reports start
 * from serious sources instead of blogs, SEO pages, or low-trust junk.
 */

export interface SourceCategory {
  key: string;
  label: string;
  urls: string[];
}

export const TIER1_SOURCES: SourceCategory[] = [
  {
    key: "medicine",
    label: "Medicine / Health (clinical, drugs, devices, disease data, evidence-based medicine)",
    urls: [
      "https://www.nih.gov/", "https://pubmed.ncbi.nlm.nih.gov/", "https://pmc.ncbi.nlm.nih.gov/",
      "https://www.cdc.gov/", "https://www.fda.gov/", "https://www.who.int/",
      "https://www.cochranelibrary.com/", "https://www.cochrane.org/", "https://clinicaltrials.gov/",
      "https://www.nejm.org/", "https://jamanetwork.com/", "https://www.thelancet.com/",
      "https://www.nature.com/nm/", "https://www.bmj.com/", "https://www.mayoclinic.org/",
      "https://www.merckmanuals.com/professional",
    ],
  },
  {
    key: "finance",
    label: "Investing / Personal Finance / Investor Protection (rules, filings, enforcement, macro data)",
    urls: [
      "https://www.sec.gov/", "https://www.sec.gov/edgar", "https://www.investor.gov/",
      "https://www.finra.org/", "https://brokercheck.finra.org/", "https://www.federalreserve.gov/",
      "https://fred.stlouisfed.org/", "https://home.treasury.gov/", "https://www.irs.gov/",
      "https://www.consumerfinance.gov/", "https://www.fdic.gov/", "https://www.occ.gov/",
      "https://www.bea.gov/", "https://www.bls.gov/",
    ],
  },
  {
    key: "markets",
    label: "Stocks / Markets / Company Filings (filings first, then official exchange + macro data)",
    urls: [
      "https://www.sec.gov/edgar/search/", "https://www.sec.gov/data-research", "https://www.nyse.com/market-data",
      "https://www.nasdaq.com/market-activity", "https://www.cboe.com/us/equities/", "https://www.spglobal.com/spdji/",
      "https://www.msci.com/", "https://fred.stlouisfed.org/", "https://www.bea.gov/", "https://www.bls.gov/",
      "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/",
    ],
  },
  {
    key: "news",
    label: "Global News (Tier-1 wire services & established newsrooms)",
    urls: [
      "https://www.reuters.com/", "https://apnews.com/", "https://www.bbc.com/news", "https://www.ft.com/",
      "https://www.wsj.com/", "https://www.bloomberg.com/", "https://www.economist.com/", "https://www.nytimes.com/",
      "https://www.washingtonpost.com/", "https://www.theguardian.com/international", "https://www.aljazeera.com/",
      "https://www.dw.com/", "https://www.france24.com/en/", "https://www.npr.org/", "https://www.c-span.org/",
    ],
  },
  {
    key: "ai",
    label: "AI News / Research / Policy (official labs for products, papers for research, NIST/OECD/EU for governance)",
    urls: [
      "https://openai.com/news/", "https://www.anthropic.com/news", "https://www.anthropic.com/research",
      "https://deepmind.google/", "https://blog.google/technology/ai/", "https://ai.meta.com/",
      "https://research.ibm.com/artificial-intelligence", "https://blogs.microsoft.com/ai/",
      "https://arxiv.org/list/cs.AI/recent", "https://arxiv.org/list/cs.LG/recent", "https://paperswithcode.com/",
      "https://huggingface.co/papers", "https://hai.stanford.edu/", "https://aiindex.stanford.edu/",
      "https://www.nist.gov/artificial-intelligence", "https://www.nist.gov/itl/ai-risk-management-framework",
      "https://oecd.ai/", "https://artificialintelligenceact.eu/",
    ],
  },
  {
    key: "marketing",
    label: "Social Media Marketing / Ads / Strategy (official ad-platform docs outrank gurus)",
    urls: [
      "https://www.facebook.com/business/news", "https://www.facebook.com/business/help",
      "https://business.instagram.com/", "https://support.google.com/google-ads/",
      "https://blog.google/products/ads-commerce/", "https://marketingplatform.google.com/",
      "https://business.linkedin.com/marketing-solutions", "https://www.linkedin.com/business/marketing/blog",
      "https://ads.tiktok.com/business/", "https://ads.tiktok.com/business/creativecenter/",
      "https://business.pinterest.com/", "https://forbusiness.snapchat.com/", "https://www.youtube.com/ads/",
      "https://www.thinkwithgoogle.com/", "https://www.emarketer.com/", "https://www.marketingdive.com/",
    ],
  },
  {
    key: "engineering",
    label: "Engineering / Standards / Technical Research (standards, gov technical reports, peer-reviewed)",
    urls: [
      "https://www.nist.gov/", "https://www.nist.gov/publications", "https://www.nasa.gov/", "https://ntrs.nasa.gov/",
      "https://www.ieee.org/", "https://ieeexplore.ieee.org/", "https://standards.ieee.org/", "https://www.asme.org/codes-standards",
      "https://www.astm.org/", "https://www.iso.org/", "https://www.sae.org/", "https://www.osha.gov/",
      "https://www.energy.gov/", "https://www.nrel.gov/", "https://www.osti.gov/", "https://www.uspto.gov/",
      "https://scholar.google.com/", "https://arxiv.org/",
    ],
  },
  {
    key: "law",
    label: "Law / Legal Research (federal statutes, regs, court opinions, official portals)",
    urls: [
      "https://www.congress.gov/", "https://www.govinfo.gov/", "https://www.ecfr.gov/", "https://www.federalregister.gov/",
      "https://www.supremecourt.gov/", "https://www.uscourts.gov/", "https://www.justice.gov/", "https://www.law.cornell.edu/",
      "https://www.oyez.org/", "https://www.courtlistener.com/", "https://www.regulations.gov/", "https://www.ftc.gov/",
      "https://www.eeoc.gov/", "https://www.dol.gov/", "https://www.osha.gov/",
    ],
  },
  {
    key: "social",
    label: "Social Issues / Demographics / Public Policy (official data first; Pew for opinion)",
    urls: [
      "https://www.census.gov/", "https://data.census.gov/", "https://www.bls.gov/", "https://www.bea.gov/",
      "https://bjs.ojp.gov/", "https://www.hud.gov/", "https://www.hhs.gov/", "https://www.ed.gov/", "https://www.dol.gov/",
      "https://www.pewresearch.org/", "https://www.gallup.com/", "https://www.kff.org/", "https://www.urban.org/",
      "https://www.brookings.edu/", "https://www.rand.org/", "https://www.oecd.org/", "https://data.worldbank.org/",
      "https://sdgs.un.org/", "https://unstats.un.org/",
    ],
  },
  {
    key: "gov",
    label: "Federal / State / County / City Law & Government (incl. Florida / Palm Beach examples)",
    urls: [
      "https://www.usa.gov/state-governments", "https://www.usa.gov/state-local-governments", "https://www.ncsl.org/",
      "https://www.naag.org/", "https://www.uniformlaws.org/", "https://library.municode.com/",
      "https://www.codepublishing.com/", "https://ecode360.com/", "https://www.whitehouse.gov/", "https://www.archives.gov/",
      "https://www.myfloridahouse.gov/", "https://www.flsenate.gov/", "https://www.leg.state.fl.us/", "https://www.flcourts.gov/",
      "https://www.myfloridalegal.com/", "https://dos.myflorida.com/sunbiz/", "https://discover.pbcgov.org/",
      "https://www.pbcgov.org/", "https://www.mypalmbeachclerk.com/", "https://www.pbcgov.org/papa/", "https://www.wpb.org/",
      "https://library.municode.com/fl/west_palm_beach/codes/code_of_ordinances",
    ],
  },
];

/** The source-quality hierarchy + evidence-labeling policy (compact, for prompts). */
export const SOURCE_POLICY = `

SOURCE POLICY (Tier-1 only): prefer authoritative primary sources; do NOT use random blogs, SEO/affiliate pages, anonymous posts, unsourced social media, or AI-generated summaries as primary evidence. Hierarchy: (1) official government/regulatory; (2) primary institution; (3) peer-reviewed journal / standards body; (4) official company/platform docs; (5) Tier-1 wire service / established newsroom; (6) nonpartisan research institute / recognized data authority. For every claim: cite the source URL and label it CONFIRMED, INFERRED, or UNKNOWN; prefer primary sources over summaries. Call the tier1_sources tool to get the vetted starting URLs for the relevant domain (medicine, finance, markets, news, ai, marketing, engineering, law, social, gov).`;

/** Render the whitelist (optionally one category) as compact text for a tool result. */
export function tier1SourcesText(category?: string): string {
  const cats = category
    ? TIER1_SOURCES.filter((c) => c.key === category.toLowerCase() || c.label.toLowerCase().includes(category.toLowerCase()))
    : TIER1_SOURCES;
  if (!cats.length) {
    return `No Tier-1 category matched "${category}". Available: ${TIER1_SOURCES.map((c) => c.key).join(", ")}.`;
  }
  return cats.map((c) => `## ${c.key} — ${c.label}\n${c.urls.join("\n")}`).join("\n\n");
}
