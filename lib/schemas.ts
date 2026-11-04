import { z } from "zod";

// Schemas are shared between client (React Hook Form resolver) and server (Route Handler validation),
// so the same rules apply in both places and field errors map cleanly back to the form.

const MEDIA_EXTENSION = /\.(mp4|mov|m4v|mkv|webm|avi|m3u8|mpd)$/i;

/**
 * An http(s) URL with a dotted host and a path ending in a known media extension.
 * The extension allowlist is a judgement call on "media URL" (documented in the README).
 */
export const sourceUrlSchema = z
  .string()
  .trim()
  .min(1, "Source URL is required")
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full URL, e.g. https://cdn.example.com/video.mp4" });
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ctx.addIssue({ code: "custom", message: "URL must start with http:// or https://" });
    } else if (!url.hostname.includes(".")) {
      ctx.addIssue({ code: "custom", message: "URL needs a real host name, e.g. cdn.example.com" });
    } else if (url.pathname === "/") {
      ctx.addIssue({ code: "custom", message: "URL must point to a media file, not just a host" });
    } else if (!MEDIA_EXTENSION.test(url.pathname)) {
      ctx.addIssue({
        code: "custom",
        message: "URL must end in a media extension (mp4, mov, m4v, mkv, webm, avi, m3u8, mpd)",
      });
    }
  });

export const createJobSchema = z.object({
  sourceUrl: sourceUrlSchema,
  title: z
    .string()
    .trim()
    .max(80, "Keep the title under 80 characters")
    .optional()
    .or(z.literal("")),
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const startRunSchema = z.object({
  jobId: z.string().min(1, "jobId is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});
