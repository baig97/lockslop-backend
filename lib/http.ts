import { z } from "zod";
import { createHash } from "node:crypto";
import { auth } from "./auth";
import { pool } from "./db";
import { allowedOrigins } from "./config";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function body(request: Request, maxBytes = 8192) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "Use application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing body.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export async function requireSession(
  request: Request,
  scope: "slop:read" | "slop:write" = ["GET", "HEAD"].includes(request.method)
    ? "slop:read"
    : "slop:write",
) {
  let principal;
  try {
    principal = await auth.api.extensionPrincipal({ headers: request.headers });
  } catch {
    throw new HttpError(401, "Sign in to continue.");
  }
  if (!principal.scopes.includes(scope))
    throw new HttpError(403, "This token does not allow contributions.");
  return principal;
}
export async function rateLimit(key: string, max = 60) {
  const hash = createHash("sha256").update(key).digest("hex");
  const { rows } = await pool.query(
    `INSERT INTO auth.api_rate_limits (key,count,expires_at) VALUES ($1,1,now()+interval '1 minute') ON CONFLICT (key) DO UPDATE SET count=CASE WHEN api_rate_limits.expires_at<=now() THEN 1 ELSE api_rate_limits.count+1 END, expires_at=CASE WHEN api_rate_limits.expires_at<=now() THEN now()+interval '1 minute' ELSE api_rate_limits.expires_at END RETURNING count`,
    [hash],
  );
  if (rows[0].count > max)
    throw new HttpError(429, "Too many requests. Please try again shortly.");
}
export function route(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const origin = request.headers.get("origin");
    let response: Response;
    try {
      if (origin && !allowedOrigins.includes(origin))
        throw new HttpError(403, "Origin not allowed.");
      response =
        request.method === "OPTIONS"
          ? new Response(null, { status: 204 })
          : await handler(request);
    } catch (error) {
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 500;
      response = Response.json(
        {
          error:
            status === 500
              ? "Something went wrong. Please try again."
              : error instanceof z.ZodError
                ? "Invalid request."
                : (error as Error).message,
        },
        { status },
      );
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Origin");
    response.headers.set("X-Content-Type-Options", "nosniff");
    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, OPTIONS",
      );
      response.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
      );
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }
    if (response.status === 429) response.headers.set("Retry-After", "60");
    return response;
  };
}
