// Thin wrapper over the Fullscreen API for the video stage.
//
// Why it exists: Safari still ships the webkit-prefixed names, and iOS Safari
// supports fullscreen on <video> ONLY — no element fullscreen at all — so the
// stage has to be able to ask "can this browser do it?" and say so out loud
// rather than having the button do nothing.
type FullscreenCapable = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

export function fullscreenElement(doc: Document = document): Element | null {
  const d = doc as FullscreenDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

export function isFullscreen(el: Element | null, doc: Document = document): boolean {
  return el != null && fullscreenElement(doc) === el;
}

export function canFullscreen(el: HTMLElement | null): boolean {
  if (!el) return false;
  const e = el as FullscreenCapable;
  return (
    typeof e.requestFullscreen === "function" || typeof e.webkitRequestFullscreen === "function"
  );
}

export async function requestFullscreen(el: HTMLElement): Promise<void> {
  const e = el as FullscreenCapable;
  if (typeof e.requestFullscreen === "function") return void (await e.requestFullscreen());
  if (typeof e.webkitRequestFullscreen === "function")
    return void (await e.webkitRequestFullscreen());
  throw new Error("fullscreen unsupported");
}

export async function exitFullscreen(doc: Document = document): Promise<void> {
  const d = doc as FullscreenDocument;
  if (typeof d.exitFullscreen === "function") return void (await d.exitFullscreen());
  if (typeof d.webkitExitFullscreen === "function") return void (await d.webkitExitFullscreen());
}

// Both event names: whichever the browser fires, we hear once.
export function onFullscreenChange(handler: () => void, doc: Document = document): () => void {
  doc.addEventListener("fullscreenchange", handler);
  doc.addEventListener("webkitfullscreenchange", handler);
  return () => {
    doc.removeEventListener("fullscreenchange", handler);
    doc.removeEventListener("webkitfullscreenchange", handler);
  };
}
