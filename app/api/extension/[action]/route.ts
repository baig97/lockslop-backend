import { baseUrl } from "@/lib/config";
import { body, requireSession, route, HttpError, rateLimit } from "@/lib/http";
import {
  currentPrivacyVersion,
  privacyStatus,
  savePrivacyChoice,
} from "@/lib/privacy";
import { z } from "zod";
export const runtime = "nodejs";
export const GET = route(async (request) => {
  const action = new URL(request.url).pathname.split("/").pop();
  if (action === "config") {
    if (!process.env.OAUTH_EXTENSION_CLIENT_ID)
      throw new HttpError(503, "OAuth client has not been registered.");
    return Response.json({
      clientId: process.env.OAUTH_EXTENSION_CLIENT_ID,
      issuer: `${baseUrl}/api/auth`,
      resource: `${baseUrl}/api/v1`,
      privacyPolicyVersion: currentPrivacyVersion(),
    });
  }
  if (action === "privacy-consent") {
    const principal = request.headers.has("authorization")
      ? await requireSession(request)
      : null;
    return Response.json(await privacyStatus(principal?.user.id));
  }
  if (action === "session") {
    const { user } = await requireSession(request);
    return Response.json({
      userId: user.id,
      displayName: user.name,
      privacy: await privacyStatus(user.id),
    });
  }
  throw new HttpError(404, "Not found.");
});
export const POST = route(async (request) => {
  if (new URL(request.url).pathname.split("/").pop() !== "privacy-consent")
    throw new HttpError(404, "Not found.");
  const { user } = await requireSession(request, "slop:write");
  await rateLimit(`privacy:${user.id}`, 30);
  const choice = z
    .object({ version: z.string().min(1).max(100), accepted: z.boolean() })
    .strict()
    .parse(await body(request, 1024));
  return Response.json(
    await savePrivacyChoice(user.id, choice.version, choice.accepted),
  );
});
export const OPTIONS = GET;
