import { randomBytes } from "node:crypto";
import { baseUrl } from "@/lib/config";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  if (!query.has('sig'))
    return new Response("Invalid sign-in request", { status: 400 });
  const nonce = randomBytes(18).toString("base64");
  const callback = `${baseUrl}/auth/error`;
  const oauthQuery = JSON.stringify(query.toString()).replace(/</g, '\\u003c');
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in to Slop</title><style nonce="${nonce}">
 :root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#111113;color:#ededee}body{margin:0;min-height:100vh;display:grid;place-items:center}.card{max-width:360px;margin:24px;padding:36px;border:1px solid #333338;border-radius:24px;background:#1a1a1d}small{color:#a4a4ac;letter-spacing:.16em}h1{font-size:28px;font-weight:600}p{color:#b9b9c1;line-height:1.6}button{margin:16px 0 8px;width:100%;padding:14px;border:0;border-radius:24px;background:#f2f2f3;color:#19191b;font:600 15px system-ui;cursor:pointer}button:disabled{opacity:.6}#error{color:#ffa99a}footer{font-size:12px;color:#94949c}</style>
 <main class="card"><small>SLOP</small><h1>A little more signal.</h1><p>Sign in to rate videos and help others find content worth their time.</p><button id="signin">Continue with Google</button><p id="error" role="alert"></p><footer>Your optional feedback stays private.</footer></main>
 <script nonce="${nonce}">document.getElementById('signin').onclick=async()=>{const b=document.getElementById('signin');b.disabled=true;b.textContent='Connecting…';try{const r=await fetch('/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'google',oauth_query:${oauthQuery},callbackURL:${JSON.stringify(callback)},errorCallbackURL:${JSON.stringify(`${baseUrl}/auth/error`)}})});const data=await r.json();if(!r.ok||!data.url)throw Error();location.assign(data.url)}catch{document.getElementById('error').textContent='Could not start sign-in. Please try again.';b.disabled=false;b.textContent='Continue with Google';}};</script></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      },
    },
  );
}
