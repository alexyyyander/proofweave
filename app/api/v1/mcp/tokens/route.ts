import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getMcpRepository } from "@/db/repositories/mcp";
import {
  apiError,
  mcpFailure,
  record,
  requestJson,
  requiredString,
} from "@/app/lib/mcp-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return apiError(
      "unauthenticated",
      "Sign in with ChatGPT before creating an MCP token.",
      401,
    );
  }

  const input = record(await requestJson(request));
  const name = input ? requiredString(input, "name", 64) : null;
  const expiresInDays = input?.expiresInDays;
  const validExpiry =
    expiresInDays === undefined ||
    (typeof expiresInDays === "number" &&
      Number.isInteger(expiresInDays) &&
      expiresInDays >= 1 &&
      expiresInDays <= 90);

  if (!name || !validExpiry) {
    return apiError(
      "invalid_input",
      "name must be 1–64 characters and expiresInDays must be an integer from 1 to 90.",
      400,
    );
  }

  const expiryDays = typeof expiresInDays === "number" ? expiresInDays : 30;

  try {
    const issued = await getMcpRepository().issueToken(
      { providerSubject: user.email, displayName: user.displayName },
      { name, expiresInDays: expiryDays },
    );
    return Response.json(
      {
        token: issued,
        warning: "Copy this token now. Proofweave stores only its digest and cannot show it again.",
      },
      { status: 201 },
    );
  } catch (error) {
    return mcpFailure(error);
  }
}
