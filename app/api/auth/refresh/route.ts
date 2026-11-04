import { refreshSchema } from "@/lib/schemas";
import { issueAccessToken, verifyRefreshToken } from "@/lib/server/auth";
import { error, handle, json, readJson, validationError } from "@/lib/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    const parsed = refreshSchema.safeParse(await readJson(req));
    if (!parsed.success) return validationError(parsed.error);

    const userId = verifyRefreshToken(parsed.data.refreshToken);
    if (!userId) return error(401, "Invalid or expired refresh token");

    return json({ accessToken: issueAccessToken(userId) });
  });
}
