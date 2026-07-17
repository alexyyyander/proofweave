import {
  getVerificationMarketRepository,
  VerificationMarketSchemaUnavailableError,
} from "@/db/repositories/verification-market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jobs = await getVerificationMarketRepository().listOpenJobs();
    return Response.json({
      jobs,
      note: "Review weights are settlement shares, not reserved credits. Only evidence-bearing completed reviews can enter a final Receipt closure.",
    });
  } catch (error) {
    if (error instanceof VerificationMarketSchemaUnavailableError) {
      return Response.json(
        { error: { code: "unavailable", message: "The verification market is temporarily unavailable." } },
        { status: 503 },
      );
    }
    return Response.json(
      { error: { code: "unavailable", message: "Open verification work could not be loaded." } },
      { status: 503 },
    );
  }
}
