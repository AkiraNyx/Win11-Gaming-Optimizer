const SESSION_STORAGE_KEY = "win11_optimizer_session";
const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

function initializeSessionToken(): string | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.hash.slice(1));
  const fragmentToken = params.get("session");
  if (fragmentToken !== null) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    if (SESSION_TOKEN_PATTERN.test(fragmentToken)) {
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, fragmentToken);
      } catch {
        // The in-memory token still protects requests when storage is unavailable.
      }
      return fragmentToken;
    }
  }

  try {
    const storedToken = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    return storedToken && SESSION_TOKEN_PATTERN.test(storedToken) ? storedToken : null;
  } catch {
    return null;
  }
}

const sessionToken = initializeSessionToken();

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (sessionToken) headers.set("X-Win11Opt-Session", sessionToken);
  return fetch(input, { ...init, headers });
}
