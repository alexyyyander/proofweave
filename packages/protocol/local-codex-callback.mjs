export const defaultLocalCodexCallback = "http://127.0.0.1:44765/callback";

/** Keep the registered redirect exact; URL normalization must not widen it. */
export function localCodexCallbackUri(value) {
  if (value === undefined) return defaultLocalCodexCallback;
  const match = typeof value === "string" && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/callback$/.exec(value);
  const port = match && Number(match[1]);
  if (!match || port < 1024 || port > 65535) {
    throw new TypeError("redirectUri must be http://127.0.0.1:<1024-65535>/callback with no other URL components.");
  }
  return value;
}
