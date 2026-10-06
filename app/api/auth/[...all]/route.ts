import { auth } from "@/lib/auth";
import { route } from "@/lib/http";
export const runtime = "nodejs";
export const GET = route((request) => auth.handler(request));
export const POST = GET;
export const OPTIONS = GET;
