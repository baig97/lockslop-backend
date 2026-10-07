import { batchOverviews } from "@/lib/overview";
import { identitySchema, envelopeSchema } from "@/lib/contracts/content";
import { z } from "zod";
import { body, HttpError, rateLimit, requireSession, route } from "@/lib/http";
import {
  vote,
  details,
  saveDetails,
  detailsSchema,
  videoIdSchema,
  signalKeys,
} from "@/lib/content";
export const runtime = "nodejs";
const handler = route(async (request) => {
  const path = new URL(request.url).pathname.replace("/api/v1/", "");
  if (path === "slop-signals" && request.method === "GET")
    return Response.json({ signals: signalKeys });
  if (["content/overviews:batch", "content/ai-signals:derive"].includes(path)) {
    if (request.method !== "POST")
      throw new HttpError(405, "Method not allowed.");
    const derive = path === "content/ai-signals:derive";
    const principal = derive
      ? await requireSession(request, "slop:write")
      : request.headers.has("authorization")
        ? await requireSession(request, "slop:read")
        : null;
    const data = envelopeSchema.parse(
      await body(request, derive ? 512 * 1024 : 32 * 1024),
    );
    await rateLimit(
      derive ? `derive:requests:${principal!.user.id}` : "overview:global",
      derive ? 60 : 600,
    );
    return Response.json(
      await batchOverviews(data.entities, principal?.user.id, derive),
    );
  }
  if (path === "content/my-vote" || path === "content/my-vote/details") {
    const principal = await requireSession(
      request,
      request.method === "GET" ? "slop:read" : "slop:write",
    );
    if (path === "content/my-vote/details" && request.method === "GET") {
      const params = new URL(request.url).searchParams;
      return Response.json(
        await details(
          identitySchema.parse({
            entityType: params.get("entityType"),
            url: params.get("url"),
          }),
          principal.user.id,
        ),
      );
    }
    if (request.method !== "PUT")
      throw new HttpError(405, "Method not allowed.");
    await rateLimit(`write:${principal.user.id}`);
    const raw = await body(request);
    if (path === "content/my-vote") {
      const v = z
        .object({ entity: identitySchema, vote: z.enum(["slop", "not_slop"]) })
        .strict()
        .parse(raw);
      return Response.json(await vote(v.entity, principal.user.id, v.vote));
    }
    const v = z
      .object({ entity: identitySchema, details: detailsSchema })
      .strict()
      .parse(raw);
    return Response.json(
      await saveDetails(v.entity, principal.user.id, v.details),
    );
  }
  const match = /^youtube\/videos\/([^/]+)\/(my-vote|my-vote\/details)$/.exec(
    path,
  );
  if (!match) throw new HttpError(404, "Not found.");
  const id = videoIdSchema.parse(match[1]),
    action = match[2];
  if (request.method === "GET" && action === "my-vote")
    throw new HttpError(404, "Not found.");
  const session = await requireSession(request),
    userId = session.user.id;
  if (request.method === "GET") {
    if (action !== "my-vote/details") throw new HttpError(404, "Not found.");
    if (action === "my-vote/details")
      return Response.json(await details(id, userId));
  }
  if (request.method === "PUT") {
    await rateLimit(`write:${userId}`);
    if (action === "my-vote") {
      const data = z
        .object({ vote: z.enum(["slop", "not_slop"]) })
        .strict()
        .parse(await body(request));
      return Response.json(await vote(id, userId, data.vote));
    }
    if (action === "my-vote/details")
      return Response.json(
        await saveDetails(id, userId, detailsSchema.parse(await body(request))),
      );
  }
  throw new HttpError(405, "Method not allowed.");
});
export const GET = handler;
export const PUT = handler;
export const OPTIONS = handler;

export const POST = handler;
export const maxDuration = 90;
