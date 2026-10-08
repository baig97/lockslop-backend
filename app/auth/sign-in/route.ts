import { auth } from "@/lib/auth";
import { baseUrl } from "@/lib/config";
import { startGoogleSignIn } from "@/lib/google-sign-in";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return startGoogleSignIn(request, auth.api.signInSocial, baseUrl);
}
