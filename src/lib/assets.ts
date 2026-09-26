import { useEffect, useState } from "react";
import { ApiError, assetUrl, reportSessionExpired } from "./api";
import { getToken } from "./auth";

/**
 * Fetching a patient's photograph.
 *
 * Photographs used to be static files: `<img src="/uploads/…">` and the
 * browser did the rest. They are not static any more, because a URL anyone
 * could open is not a safe way to hold patient data. The gateway asks for the
 * same bearer token as every other route, and an `<img>` element cannot send
 * one — so the file is fetched here and handed to the image as a blob URL.
 *
 * One request per file per session. A doctor paging back and forth through
 * five photographs, or flicking between the map and the photograph in the
 * Workspace, should not re-download megabytes each time; and the alternative
 * — letting the browser cache them on disk — would be writing patient images
 * to the machine, which is what the server's `no-store` is there to prevent.
 * So the cache is in memory, and it dies with the tab.
 */

/** path → the blob URL for it, or the request still in flight. */
const cache = new Map<string, Promise<string>>();

/** Every blob URL handed out, so signing out can take them all back. */
const handed = new Set<string>();

function isDirect(path: string): boolean {
  return /^(data:|blob:)/i.test(path);
}

async function download(path: string): Promise<string> {
  const token = getToken();
  const response = await fetch(assetUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    // A photograph is the first thing a screen asks for and often the first
    // request to discover that a session has ended. It has to end the session
    // the same way any other 401 would, or the app sits on a dead token
    // showing broken pictures.
    if (response.status === 401) reportSessionExpired();
    throw new ApiError("This picture could not be loaded.", response.status);
  }

  const url = URL.createObjectURL(await response.blob());
  handed.add(url);
  return url;
}

export function loadAsset(path: string): Promise<string> {
  if (!path) return Promise.resolve("");
  if (isDirect(path)) return Promise.resolve(path);

  const cached = cache.get(path);
  if (cached) return cached;

  const pending = download(path);
  cache.set(path, pending);
  // A failure is not worth remembering: the next screen that asks should try
  // again rather than inherit a rejection from minutes ago.
  pending.catch(() => cache.delete(path));
  return pending;
}

/**
 * Drops every downloaded photograph.
 *
 * Called on sign-out. Leaving them would mean the next doctor to sign in on
 * this machine inherits a tab holding the previous one's patient images, and
 * a blob URL keeps its bytes alive until it is revoked.
 */
export function clearAssets(): void {
  for (const url of handed) URL.revokeObjectURL(url);
  handed.clear();
  cache.clear();
}

export interface AssetState {
  /** The blob URL, or "" until it is ready. */
  url: string;
  loading: boolean;
  failed: boolean;
}

/** One photograph, fetched with the session's token. */
export function useAsset(path?: string | null): AssetState {
  const key = path ?? "";
  // Already in the browser — a preview of a file the doctor has just picked,
  // or an inline image. There is nothing to fetch and nothing to wait for.
  const direct = Boolean(key) && isDirect(key);

  const [resolved, setResolved] = useState<{
    key: string;
    url: string;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!key || direct) return;

    let cancelled = false;
    loadAsset(key)
      .then((url) => {
        if (!cancelled) setResolved({ key, url, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResolved({ key, url: "", failed: true });
      });

    return () => {
      cancelled = true;
    };
  }, [key, direct]);

  if (!key) return { url: "", loading: false, failed: false };
  if (direct) return { url: key, loading: false, failed: false };

  // Keyed by the path it was fetched for, so a component that switches
  // photograph shows a loading frame rather than one render of the previous
  // eye under the new caption. Nothing is reset on the way in, which is what
  // keeps this to one render per change.
  const done = resolved?.key === key ? resolved : null;
  return {
    url: done?.url ?? "",
    loading: !done,
    failed: Boolean(done?.failed),
  };
}
