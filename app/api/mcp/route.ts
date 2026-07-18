import { handleRemoteMcp } from "@/app/lib/remote-mcp-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) { return handleRemoteMcp(request); }
export async function POST(request: Request) { return handleRemoteMcp(request); }
export async function DELETE(request: Request) { return handleRemoteMcp(request); }
