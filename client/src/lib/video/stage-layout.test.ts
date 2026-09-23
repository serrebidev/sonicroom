import { describe, it, expect } from "vitest";
import { bestGrid, fallbackGrid, TILE_ASPECT } from "./stage-layout";

describe("fallbackGrid", () => {
  it("is the squarest grid for the count", () => {
    expect(fallbackGrid(1)).toEqual({ cols: 1, rows: 1 });
    expect(fallbackGrid(2)).toEqual({ cols: 2, rows: 1 });
    expect(fallbackGrid(4)).toEqual({ cols: 2, rows: 2 });
    expect(fallbackGrid(5)).toEqual({ cols: 3, rows: 2 });
    expect(fallbackGrid(9)).toEqual({ cols: 3, rows: 3 });
  });

  it("never returns an empty grid", () => {
    expect(fallbackGrid(0)).toEqual({ cols: 1, rows: 1 });
    expect(fallbackGrid(-3)).toEqual({ cols: 1, rows: 1 });
    expect(fallbackGrid(NaN)).toEqual({ cols: 1, rows: 1 });
  });
});

describe("bestGrid", () => {
  it("gives one tile the whole stage", () => {
    expect(bestGrid(1, 1600, 900)).toEqual({ cols: 1, rows: 1 });
    expect(bestGrid(1, 400, 1200)).toEqual({ cols: 1, rows: 1 });
  });

  it("puts two people side by side on a wide stage", () => {
    expect(bestGrid(2, 1600, 900)).toEqual({ cols: 2, rows: 1 });
    expect(bestGrid(2, 1600, 400)).toEqual({ cols: 2, rows: 1 });
  });

  it("stacks two people on a tall, narrow stage", () => {
    expect(bestGrid(2, 400, 900)).toEqual({ cols: 1, rows: 2 });
  });

  it("picks the layout with the biggest tile, not the squarest", () => {
    // 3 tiles on a 16:9 stage: 2x2 beats both 1x3 and 3x1.
    expect(bestGrid(3, 1600, 900)).toEqual({ cols: 2, rows: 2 });
    // ...but a very wide, short stage wants one row.
    expect(bestGrid(3, 2400, 300)).toEqual({ cols: 3, rows: 1 });
    expect(bestGrid(4, 1600, 900)).toEqual({ cols: 2, rows: 2 });
  });

  it("always fits every tile", () => {
    for (let n = 1; n <= 12; n++) {
      for (const [w, h] of [
        [1600, 900],
        [800, 1200],
        [2400, 400],
        [1024, 768],
      ]) {
        const { cols, rows } = bestGrid(n, w, h);
        expect(cols * rows).toBeGreaterThanOrEqual(n);
        // No empty row: that would be wasted stage.
        expect((rows - 1) * cols).toBeLessThan(n);
      }
    }
  });

  it("falls back when the stage has not been measured yet", () => {
    expect(bestGrid(5, 0, 0)).toEqual(fallbackGrid(5));
    expect(bestGrid(5, NaN, 900)).toEqual(fallbackGrid(5));
    expect(bestGrid(5, 1600, -1)).toEqual(fallbackGrid(5));
  });

  it("honours a non-default tile aspect", () => {
    // A square tile fits differently than 16:9 on the same stage.
    expect(bestGrid(2, 1000, 1000, 1)).toEqual({ cols: 2, rows: 1 });
    expect(TILE_ASPECT).toBeCloseTo(1.777, 2);
  });
});
