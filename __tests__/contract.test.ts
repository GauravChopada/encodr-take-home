import { describe, expect, it } from "vitest";
import { ACTIVE_STAGES, isTerminalStage, parseRunEvent, type RunEvent, type Stage } from "@/lib/types";

describe("parseRunEvent", () => {
  it("accepts an active, a completed and a failed event", () => {
    const active = { stage: "TRANSCODING", progressPct: 62, message: "TRANSCODING 62%" };
    expect(parseRunEvent(JSON.stringify(active))).toEqual(active);
    const done = { stage: "COMPLETED", progressPct: 100, message: "Encode complete" };
    expect(parseRunEvent(JSON.stringify(done))).toEqual(done);
    const failed = { stage: "FAILED", progressPct: 66, message: "boom", error: "boom" };
    expect(parseRunEvent(JSON.stringify(failed))).toEqual(failed);
  });

  it.each([
    ["not json", "not json"],
    ["an unknown stage", JSON.stringify({ stage: "EXPLODING", progressPct: 1, message: "x" })],
    ["a non-numeric progress", JSON.stringify({ stage: "QUEUED", progressPct: "7", message: "x" })],
    ["a missing message", JSON.stringify({ stage: "QUEUED", progressPct: 7 })],
    ["a FAILED event without an error", JSON.stringify({ stage: "FAILED", progressPct: 7, message: "x" })],
    ["a JSON null", "null"],
  ])("rejects %s", (_name, raw) => {
    expect(parseRunEvent(raw)).toBeNull();
  });
});

describe("type-level contract", () => {
  it("narrows terminal stages and keeps ACTIVE_STAGES to non-terminal stages", () => {
    const stage = "FAILED" as Stage;
    if (isTerminalStage(stage)) {
      const terminal: "COMPLETED" | "FAILED" = stage;
      expect(terminal).toBe("FAILED");
    }
    // @ts-expect-error COMPLETED is not an active stage
    const bad: (typeof ACTIVE_STAGES)[number] = "COMPLETED";
    expect(bad).toBe("COMPLETED");
  });

  it("does not allow a FAILED event without an error", () => {
    // @ts-expect-error FAILED events must carry an error
    const bad: RunEvent = { stage: "FAILED", progressPct: 1, message: "x" };
    expect(bad.stage).toBe("FAILED");
  });
});
