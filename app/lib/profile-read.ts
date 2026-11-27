import { requireUser } from "../auth";

type ReadStage = "delegation" | "workspace" | "facts" | "receipts" | "credits";

export type ProfileRead<T> = { ok: true; value: T } | { ok: false; reference: string };

export async function profileRead<T>(stage: ReadStage, read: () => Promise<T>): Promise<ProfileRead<T>> {
  const start = performance.now();
  try {
    const value = await read();
    console.info("profile_read", { stage, elapsedMs: Math.round(performance.now() - start) });
    return { ok: true, value };
  } catch {
    const reference = crypto.randomUUID();
    console.warn("profile_read_failed", { stage, reference, elapsedMs: Math.round(performance.now() - start) });
    return { ok: false, reference };
  }
}

export async function requireProfileUser() {
  const start = performance.now();
  const user = await requireUser("/profile");
  console.info("profile_read", { stage: "session", elapsedMs: Math.round(performance.now() - start) });
  return user;
}
