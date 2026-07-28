import { getCurrentUser, toPersonIdentity } from "@/app/auth";
import { MissingDatabaseBindingError } from "@/db";
import { ControlPlaneReadOnlyError } from "@/services/database/control-plane-operation-mode.mjs";
import {
  DelegationAuthorizationError,
  DelegationConflictError,
  DelegationNotFoundError,
} from "@/db/repositories/delegation";

export async function currentDelegationIdentity() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json(
        { error: { code: "unauthorized", message: "Sign in to manage your research Agent." } },
        { status: 401 },
      );
    }

    return toPersonIdentity(user);
  } catch (error) {
    if (
      error instanceof MissingDatabaseBindingError
      || error instanceof ControlPlaneReadOnlyError
    ) {
      return delegationFailure(error);
    }
    throw error;
  }
}

export function delegationFailure(error: unknown) {
  const headers = { "Cache-Control": "no-store" };
  if (
    error instanceof MissingDatabaseBindingError
    || error instanceof ControlPlaneReadOnlyError
  ) {
    return Response.json(
      { error: { code: "unavailable", message: "Delegation storage is temporarily unavailable." } },
      { status: 503, headers },
    );
  }
  if (error instanceof DelegationNotFoundError) {
    return Response.json({ error: { code: "not_found", message: error.message } }, { status: 404, headers });
  }
  if (error instanceof DelegationAuthorizationError) {
    return Response.json({ error: { code: "forbidden", message: error.message } }, { status: 403, headers });
  }
  if (error instanceof DelegationConflictError) {
    return Response.json({ error: { code: "conflict", message: error.message } }, { status: 409, headers });
  }
  return Response.json(
    { error: { code: "internal_error", message: "The delegation request could not be completed." } },
    { status: 500, headers },
  );
}
