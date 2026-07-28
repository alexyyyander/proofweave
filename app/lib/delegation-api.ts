import { getCurrentUser, toPersonIdentity } from "@/app/auth";
import { MissingDatabaseBindingError } from "@/db";
import { ControlPlaneReadOnlyError } from "@/services/database/control-plane-operation-mode.mjs";
import {
  DelegationAuthorizationError,
  DelegationConflictError,
  DelegationNotFoundError,
} from "@/db/repositories/delegation";

export async function currentDelegationIdentity() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { error: { code: "unauthorized", message: "Sign in to manage your research Agent." } },
      { status: 401 },
    );
  }

  return toPersonIdentity(user);
}

export function delegationFailure(error: unknown) {
  if (
    error instanceof MissingDatabaseBindingError
    || error instanceof ControlPlaneReadOnlyError
  ) {
    return Response.json(
      { error: { code: "unavailable", message: "Delegation storage is temporarily unavailable." } },
      { status: 503 },
    );
  }
  if (error instanceof DelegationNotFoundError) {
    return Response.json({ error: { code: "not_found", message: error.message } }, { status: 404 });
  }
  if (error instanceof DelegationAuthorizationError) {
    return Response.json({ error: { code: "forbidden", message: error.message } }, { status: 403 });
  }
  if (error instanceof DelegationConflictError) {
    return Response.json({ error: { code: "conflict", message: error.message } }, { status: 409 });
  }
  if (error instanceof Error) {
    return Response.json({ error: { code: "invalid_input", message: error.message } }, { status: 400 });
  }
  return Response.json(
    { error: { code: "unavailable", message: "Delegation service is temporarily unavailable." } },
    { status: 503 },
  );
}
