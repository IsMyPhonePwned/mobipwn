/** Turn API / fetch errors into a short user-facing string. */
export function parseApiError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (msg.startsWith("{")) {
      try {
        const parsed = JSON.parse(msg) as { error?: string; message?: string };
        if (parsed.error) return parsed.error;
        if (parsed.message) return parsed.message;
      } catch {
        /* fall through */
      }
    }
    return msg || "Request failed";
  }
  if (typeof err === "string") return err.trim() || "Request failed";
  return String(err);
}

/** Read API response body safely (handles empty body and plain-text errors). */
export async function parseApiResponse<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  if (text.trim()) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      if (!res.ok) {
        throw new Error(text.slice(0, 2000) || res.statusText || `HTTP ${res.status}`);
      }
      throw new Error(
        `Invalid JSON response (HTTP ${res.status}): ${text.slice(0, 200) || "(empty)"}`
      );
    }
  } else {
    data = undefined;
  }

  if (!res.ok) {
    const msg =
      data &&
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : text || res.statusText || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (data === undefined) {
    // Mutation endpoints often return 204 No Content with an empty body.
    if (res.status === 204 || res.status === 205) {
      return undefined as T;
    }
    throw new Error(`HTTP ${res.status}: empty response body`);
  }

  return data as T;
}
