import records from "@/data/target-sponsorships.json";

type PublishedSponsorship = {
  problemRevisionId: string;
  sponsorName: string;
  announcementUrl: string;
};

// Publicly confirmed sponsorships only. Research credit pools have a separate lifecycle.
const published: readonly PublishedSponsorship[] = records;

export function publishedTargetSponsorships(problemRevisionId: string) {
  return published.filter(record => record.problemRevisionId === problemRevisionId);
}
