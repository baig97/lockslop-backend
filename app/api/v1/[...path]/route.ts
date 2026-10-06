import { overview } from "@/lib/overview";
import { z } from "zod";
import { body, HttpError, rateLimit, requireSession, route } from "@/lib/http";
import {
  rating,
  myVote,
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
  const match =
    /^youtube\/videos\/([^/]+)\/(overview|rating|my-vote|my-vote\/details)$/.exec(
      path,
    );
  if (!match) throw new HttpError(404, "Not found.");
  const id = videoIdSchema.parse(match[1]),
    action = match[2];
  if (action === "overview" && request.method === "GET") {
    const session = request.headers.has("authorization")
      ? await requireSession(request)
      : null;
    await rateLimit("overview:global", 600);
    return Response.json(await overview(id, session?.user.id));
  }
  if (action === "rating" && request.method === "GET")
    return Response.json(await rating(id));
  const session = await requireSession(request),
    userId = session.user.id;
  if (request.method === "GET") {
    if (action === "my-vote") return Response.json(await myVote(id, userId));
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
