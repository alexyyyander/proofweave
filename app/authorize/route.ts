import { handleRemoteIdentity } from "@/app/lib/remote-mcp-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) { return handleRemoteIdentity(request); }
export async function POST(request: Request) { return handleRemoteIdentity(request); }
