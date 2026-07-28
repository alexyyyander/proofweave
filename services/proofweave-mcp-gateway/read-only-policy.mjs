export const remoteMcpReadOnlyToolNames = Object.freeze([
  "get_connection_authority",
  "list_frontier_problems",
  "inspect_problem",
  "inspect_research_graph",
  "list_attempts",
  "get_attempt",
  "list_review_assignments",
  "get_review_assignment",
  "get_verification_replay",
  "get_runner_run",
]);

const readOnlyTools = new Set(remoteMcpReadOnlyToolNames);
const readOnlyProtocolMethods = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
]);

/**
 * Fail closed for authenticated MCP requests while the control plane is
 * read-only. Protocol discovery and explicitly classified read-only tools may
 * proceed; every other JSON-RPC method is treated as a mutation boundary.
 *
 * Malformed JSON is left to the MCP transport so it can return its normal
 * protocol error. It cannot select a tool and therefore cannot persist data.
 */
export async function remoteMcpRequestIsReadOnly(request) {
  if (request.method === "GET" || request.method === "HEAD") return true;
  if (request.method !== "POST") return false;

  let payload;
  try {
    payload = await request.clone().json();
  } catch {
    return true;
  }

  const messages = Array.isArray(payload) ? payload : [payload];
  if (messages.length === 0) return false;
  return messages.every(remoteMcpMessageIsReadOnly);
}

export function remoteMcpMessageIsReadOnly(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  if (readOnlyProtocolMethods.has(message.method)) return true;
  if (message.method !== "tools/call") return false;
  return readOnlyTools.has(message.params?.name);
}
