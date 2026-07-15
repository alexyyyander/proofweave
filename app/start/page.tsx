import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string | string[] }>;
}) {
  const params = await searchParams;
  const target = typeof params.target === "string" ? params.target.trim() : "";
  redirect(target.length > 0 && target.length <= 120
    ? `/workbench?target=${encodeURIComponent(target)}#research-launcher`
    : "/workbench#research-launcher");
}
