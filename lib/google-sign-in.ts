interface SocialSignInOptions {
  headers: Headers;
  body: {
    provider: "google";
    oauth_query: string;
    callbackURL: string;
    errorCallbackURL: string;
    disableRedirect: true;
  };
  asResponse: true;
}

type SocialSignIn = (options: SocialSignInOptions) => Promise<Response>;

/** Start Google directly while letting Better Auth validate and preserve the signed OAuth flow. */
export async function startGoogleSignIn(request: Request, signIn: SocialSignIn, baseUrl: string) {
  const query = new URL(request.url).searchParams;
  const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (!query.get("sig"))
    return new Response("Invalid sign-in request.", { status: 400, headers });
  try {
    const response = await signIn({
      headers: request.headers,
      body: {
        provider: "google", oauth_query: query.toString(),
        callbackURL: `${baseUrl}/auth/error`, errorCallbackURL: `${baseUrl}/auth/error`,
        disableRedirect: true,
      },
      asResponse: true,
    });
    if (!response.ok)
      return new Response("Google sign-in could not be started. Close this window and try again from Lockslop.", { status: response.status, headers });
    const data = await response.json();
    const destination = new URL(data.url);
    if (destination.protocol !== "https:" || destination.hostname !== "accounts.google.com" || destination.username || destination.password || destination.port)
      throw new Error("Unexpected Google sign-in destination.");
    for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
    headers.set("Location", destination.toString());
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 502;
    console.warn("[Lockslop] Google sign-in initiation failed", { status, errorName: error instanceof Error ? error.name : "UnknownError" });
    return new Response("Google sign-in could not be started. Close this window and try again from Lockslop.", { status, headers });
  }
}
