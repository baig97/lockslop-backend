import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return json({ error: "Cleanup is not configured." }, 503);
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized." }, 401);
  }

  const result = await pool.query(
    "DELETE FROM content_analyses WHERE expires_at<=now()",
  );

  return json({ expiredAnalysesDeleted: result.rowCount ?? 0 }, 200);
}
