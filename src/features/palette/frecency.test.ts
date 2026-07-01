import { describe, it, expect, beforeEach } from "vitest";
import {
  loadFrecency,
  bumpFrecency,
  frecencyScore,
  recentIds,
} from "./frecency";

const DAY = 24 * 3600 * 1000;

describe("frecency", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(loadFrecency()).toEqual({});
  });

  it("bump increments count and records lastUsed", () => {
    bumpFrecency("a", 1000);
    bumpFrecency("a", 2000);
    const map = loadFrecency();
    expect(map.a.count).toBe(2);
    expect(map.a.lastUsed).toBe(2000);
  });

  it("more frequent item scores higher at equal recency", () => {
    const now = 10 * DAY;
    bumpFrecency("often", now);
    bumpFrecency("often", now);
    bumpFrecency("rare", now);
    const map = loadFrecency();
    expect(frecencyScore(map, "often", now)).toBeGreaterThan(
      frecencyScore(map, "rare", now),
    );
  });

  it("recency decays score", () => {
    const now = 30 * DAY;
    bumpFrecency("old", 0);
    bumpFrecency("new", now);
    const map = loadFrecency();
    expect(frecencyScore(map, "new", now)).toBeGreaterThan(
      frecencyScore(map, "old", now),
    );
  });

  it("unknown id scores 0", () => {
    expect(frecencyScore({}, "nope", 1000)).toBe(0);
  });

  it("recentIds returns ids by lastUsed descending", () => {
    bumpFrecency("first", 100);
    bumpFrecency("second", 300);
    bumpFrecency("third", 200);
    expect(recentIds(loadFrecency(), 2)).toEqual(["second", "third"]);
  });

  it("evicts lowest-scoring entries beyond the cap", () => {
    const now = 1000;
    for (let i = 0; i < 250; i++) bumpFrecency(`id${i}`, now + i);
    const map = loadFrecency();
    expect(Object.keys(map).length).toBeLessThanOrEqual(200);
    // most-recent survivor kept
    expect(map["id249"]).toBeDefined();
  });
});
