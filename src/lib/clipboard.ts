/**
 * Copy text to the clipboard, resilient to environments where the async
 * Clipboard API is unavailable or blocked — notably the Discord Activity
 * iframe (missing `clipboard-write` permission) and non-secure contexts,
 * where `navigator.clipboard` may be undefined or `writeText` may reject.
 *
 * Falls back to the legacy `execCommand("copy")` path, which works when
 * invoked synchronously within a user gesture (e.g. a button click).
 * Returns true if the copy succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // Keep it out of view and avoid scrolling/zoom on mobile.
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
