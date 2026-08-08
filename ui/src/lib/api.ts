const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

function readInitialSessionToken(): string | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("session");
  return token && SESSION_TOKEN_PATTERN.test(token) ? token : null;
}

const sessionToken = readInitialSessionToken();

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!sessionToken) return fetch(input, init);

  const headers = new Headers(init.headers);
  headers.set("X-Win11Opt-Session", sessionToken);
  return fetch(input, { ...init, headers });
}
