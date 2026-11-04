import { describe, expect, it } from "vitest";
import { createJobSchema, sourceUrlSchema } from "@/lib/schemas";

describe("sourceUrlSchema", () => {
  it.each([
    "not a url",
    "ftp://cdn.example.com/a.mp4",
    "https://example.com",
    "https://example.com/",
    "https://localhost/a.mp4",
    "https://cdn.example.com/a.txt",
  ])("rejects %j with a message", (value) => {
    const result = sourceUrlSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message.length).toBeGreaterThan(0);
  });

  it.each([
    "https://cdn.example.com/videos/a.mp4",
    "https://cdn.example.com/a.MP4?sig=1",
    "https://cdn.example.com/live/master.m3u8",
    "  https://cdn.example.com/a.mp4  ",
  ])("accepts %j", (value) => {
    expect(sourceUrlSchema.safeParse(value).success).toBe(true);
  });
});

describe("createJobSchema title", () => {
  const sourceUrl = "https://cdn.example.com/a.mp4";

  it("rejects an 81-character title", () => {
    expect(createJobSchema.safeParse({ sourceUrl, title: "x".repeat(81) }).success).toBe(false);
  });

  it("accepts a whitespace-only title", () => {
    expect(createJobSchema.safeParse({ sourceUrl, title: "   " }).success).toBe(true);
  });
});
