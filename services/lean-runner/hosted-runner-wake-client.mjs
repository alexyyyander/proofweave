export class HostedRunnerWakeConfigurationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "HostedRunnerWakeConfigurationError";
  }
}

export class HostedRunnerWakeError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "HostedRunnerWakeError";
    this.diagnosticCode = "runner_wake_failed";
  }
}

export class HostedRunnerWakeUnconfirmedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "HostedRunnerWakeUnconfirmedError";
    this.diagnosticCode = "runner_wake_unconfirmed";
  }
}

/** Wake a scale-to-zero coordinator after its durable queue delivery exists. */
export class HostedRunnerWakeClient {
  constructor({
    url,
    wakeToken,
    hostAuthorizationToken = null,
    fetcher = globalThis.fetch,
    timeoutMilliseconds = 60_000,
  } = {}) {
    this.url = requireWakeUrl(url);
    this.wakeToken = requireSecret(wakeToken, "Runner wake token");
    this.hostAuthorizationToken = hostAuthorizationToken === null
      ? null
      : requireSecret(hostAuthorizationToken, "Runner host authorization token");
    if (typeof fetcher !== "function") {
      throw new HostedRunnerWakeConfigurationError("Runner wake client requires HTTPS fetch.");
    }
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1_000 || timeoutMilliseconds > 90_000) {
      throw new HostedRunnerWakeConfigurationError("Runner wake timeout must be between 1000 and 90000 milliseconds.");
    }
    this.fetcher = fetcher;
    this.timeoutMilliseconds = timeoutMilliseconds;
  }

  async wake() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMilliseconds);
    timer.unref?.();
    let response;
    try {
      response = await this.fetcher(this.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "x-proofweave-wake-token": this.wakeToken,
          ...(this.hostAuthorizationToken
            ? { authorization: `Bearer ${this.hostAuthorizationToken}` }
            : {}),
        },
        redirect: "error",
        signal: controller.signal,
      });
    } catch (cause) {
      throw new HostedRunnerWakeUnconfirmedError(
        "The durable Runner job was recorded, but the hosted Runner wake response could not be confirmed.",
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!(response instanceof Response) || response.status !== 202) {
      throw new HostedRunnerWakeError("The hosted Runner rejected its authenticated wake request.");
    }
    return Object.freeze({ state: "wake_accepted" });
  }
}

function requireWakeUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new HostedRunnerWakeConfigurationError("Runner wake URL must be a bounded HTTPS URL.");
  }
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new HostedRunnerWakeConfigurationError("Runner wake URL must be a bounded HTTPS URL.", { cause });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/v1/wake") {
    throw new HostedRunnerWakeConfigurationError("Runner wake URL must target an exact HTTPS /v1/wake endpoint.");
  }
  return url.toString();
}

function requireSecret(value, label) {
  if (typeof value !== "string" || value.length < 32 || value.length > 512 || /\s|\0/.test(value)) {
    throw new HostedRunnerWakeConfigurationError(`${label} must contain 32-512 non-whitespace characters.`);
  }
  return value;
}
