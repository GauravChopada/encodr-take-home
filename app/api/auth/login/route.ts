import { loginSchema } from "@/lib/schemas";
import { authenticate, issueTokens } from "@/lib/server/auth";
import { error, handle, json, readJson, validationError } from "@/lib/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    const parsed = loginSchema.safeParse(await readJson(req));
    if (!parsed.success) return validationError(parsed.error);

    const user = authenticate(parsed.data.email, parsed.data.password);
    if (!user) return error(401, "Invalid email or password");

    return json({ ...issueTokens(user.id), user });
  });
}
