export function GET() {
  return new Response(
    "Sign-in was cancelled or could not be completed. Close this window and try again from the Slop widget.",
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
