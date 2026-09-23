import { describe, it, expect, vi } from "vitest";
import {
  canFullscreen,
  exitFullscreen,
  fullscreenElement,
  isFullscreen,
  onFullscreenChange,
  requestFullscreen,
} from "./fullscreen";

function fakeDoc(props: Record<string, unknown> = {}) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    ...props,
    listeners,
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string) {
      listeners.get(type)?.forEach((fn) => fn());
    },
  } as unknown as Document & { fire: (t: string) => void; listeners: Map<string, Set<() => void>> };
}

describe("fullscreen", () => {
  it("reads the standard and the webkit fullscreen element", () => {
    const el = {} as Element;
    expect(fullscreenElement(fakeDoc({ fullscreenElement: el }))).toBe(el);
    expect(fullscreenElement(fakeDoc({ webkitFullscreenElement: el }))).toBe(el);
    expect(fullscreenElement(fakeDoc())).toBeNull();
  });

  it("isFullscreen only matches OUR element", () => {
    const mine = {} as Element;
    const other = {} as Element;
    expect(isFullscreen(mine, fakeDoc({ fullscreenElement: mine }))).toBe(true);
    expect(isFullscreen(mine, fakeDoc({ fullscreenElement: other }))).toBe(false);
    expect(isFullscreen(null, fakeDoc({ fullscreenElement: mine }))).toBe(false);
  });

  it("detects support, including the webkit spelling", () => {
    expect(canFullscreen(null)).toBe(false);
    expect(canFullscreen({} as HTMLElement)).toBe(false);
    expect(canFullscreen({ requestFullscreen: () => {} } as unknown as HTMLElement)).toBe(true);
    expect(canFullscreen({ webkitRequestFullscreen: () => {} } as unknown as HTMLElement)).toBe(
      true,
    );
  });

  it("requests through whichever spelling exists, and rejects when neither does", async () => {
    const standard = vi.fn().mockResolvedValue(undefined);
    await requestFullscreen({ requestFullscreen: standard } as unknown as HTMLElement);
    expect(standard).toHaveBeenCalled();

    const webkit = vi.fn();
    await requestFullscreen({ webkitRequestFullscreen: webkit } as unknown as HTMLElement);
    expect(webkit).toHaveBeenCalled();

    await expect(requestFullscreen({} as HTMLElement)).rejects.toThrow();
  });

  it("exits through whichever spelling exists, and is a no-op with neither", async () => {
    const standard = vi.fn().mockResolvedValue(undefined);
    await exitFullscreen(fakeDoc({ exitFullscreen: standard }));
    expect(standard).toHaveBeenCalled();

    const webkit = vi.fn();
    await exitFullscreen(fakeDoc({ webkitExitFullscreen: webkit }));
    expect(webkit).toHaveBeenCalled();

    await expect(exitFullscreen(fakeDoc())).resolves.toBeUndefined();
  });

  it("subscribes to both change events and unsubscribes from both", () => {
    const doc = fakeDoc();
    const handler = vi.fn();
    const off = onFullscreenChange(handler, doc);
    doc.fire("fullscreenchange");
    doc.fire("webkitfullscreenchange");
    expect(handler).toHaveBeenCalledTimes(2);
    off();
    doc.fire("fullscreenchange");
    doc.fire("webkitfullscreenchange");
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
