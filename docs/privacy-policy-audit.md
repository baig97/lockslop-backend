# Privacy policy implementation audit

Audited: October 8, 2026

This audit compares the public privacy policy with the Lockslop Chrome extension and backend source currently in these repositories. It covers the extension manifest and background runtime, YouTube and LinkedIn extraction, local storage, API contracts, authentication, database schemas, AI transport, contribution endpoints, retention, and the privacy route. It also checks public terms for Google, Vercel, Neon, and TypeSafe.ai where the policy names those providers.

The audit can prove what this source code and its declared dependencies do. It cannot prove business practices outside the repositories, production dashboard settings, provider account plans, deployment regions, exports performed by an operator, or whether a scheduled job is succeeding after deployment. Those items are listed separately as operational attestations.

## Corrections made during this audit

- The extension automatically submits bounded page content for AI analysis when a signed-in cache lookup returns `needs_input`. The first attempt is not triggered by a separate Analyze button. Retrying a failed provider request is user initiated. The policy now says this directly.
- The page parsers may transiently inspect a cloned platform response, inline data, or relevant DOM structure in memory. The policy now distinguishes that local parsing from the smaller set of fields retained or transmitted.
- The LinkedIn extractor currently sends no comment text. It may include accessible image alternative text in the extracted post text. The policy now states both facts.
- The extension does not read YouTube or LinkedIn cookies and does not access browser-stored passwords. That narrower statement replaces the earlier, overly broad claim that it collected no cookies at all, because first-party authentication services may use their own session mechanisms.
- AI retention previously depended on an external job that was described but not configured in this repository. A secret-protected Vercel cron route and monthly schedule are now included. Production still must define `CRON_SECRET` and monitor successful executions.
- Provider transfer safeguards are now described as provider-published mechanisms that apply only in covered circumstances and under the relevant Lockslop plan or agreement.
- Logging language now limits the no-content claim to Lockslop's Jev transport log and separately acknowledges ordinary request metadata processed by hosting and authentication infrastructure.
- Product and performance analytics are now documented as planned but inactive. The policy must be updated with exact events, identifiers, retention, regions, and controls before GA4, PostHog, or Vercel analytics collection begins.
- The operator confirmed the current production deployment is Asia-Pacific-focused. Possible global caching remains a future architecture and must receive a new field/region/retention review before activation.

## Claim matrix

| Policy claim | Status | Evidence and limits |
| --- | --- | --- |
| Existing community ratings are available without sign-in | Verified in code | `app/api/v1/[...path]/route.ts`, `lib/http.ts`, `lib/overview.ts`, and the extension lookup service allow anonymous cache lookups; invalid bearer credentials do not silently become anonymous. |
| Contributions require an intentional signed-in action | Verified in code | Vote, reason, feedback, and report calls originate in explicit UI actions and backend write routes require `slop:write`. See `src/components/slop/*`, `src/data/prepared-service.ts`, `app/api/v1/[...path]/route.ts`, and `lib/content.ts`. |
| Signed-in cache misses automatically start AI analysis | Verified in code | `src/data/prepared-service.ts` filters authenticated `needs_input` results and calls the derive batch automatically. Failed analysis retries are initiated from the UI. |
| Anonymous cache lookup sends identity and hash, not full content | Verified in code | The overview batch schema accepts URL or external ID plus content hash. Full content is accepted only by the authenticated derive route. See both repositories' `src/contracts/content.ts` / `lib/contracts/content.ts` and the backend route. |
| Parsers transiently inspect page-owned data in memory | Verified in code | YouTube clones already loaded player/next/watch responses and scans inline data with response-size bounds. LinkedIn inspects cloned React/Flight data or the eligible DOM subtree. See `src/platforms/youtube/main.ts` and `src/platforms/linkedin/{extract,wire}.ts`. |
| YouTube payload is bounded | Verified in code | The version-2 schema and extractor limit output to the disclosed title, description, metadata, tags, counts, and at most ten comment texts. Structured commenter identities are not in the schema. |
| LinkedIn sends post text and counts, but no comments in this build | Verified in code | `src/platforms/linkedin/extract.ts` sets comments to unavailable and an empty list. DOM extraction can append image `alt` text to post text. |
| Media pixels/audio and linked articles are not uploaded for analysis | Verified in code | The derivation schemas accept text and metadata, not media bytes. No linked-page fetch path exists. The extension may observe page-owned platform responses to extract the disclosed fields. |
| The extension does not read platform cookies or browser passwords | Verified in code | The manifest declares no `cookies` permission, and no cookie/password API calls were found. Authentication uses Chrome Identity's web-auth flow. |
| Extension permissions are `identity`, `storage`, supported hosts, and backend host | Verified in code | `public/manifest.json`. No history, tabs, cookies, or webRequest permission is declared. |
| Theme/public display state uses local storage; credentials use session storage | Verified in packaged extension path | `src/extension/background/index.ts` stores secret session material in `chrome.storage.session` and public display state in `chrome.storage.local`; theme uses local storage. Development fallbacks use page `localStorage` outside a valid extension context and should not be described as the packaged extension's production store. |
| Google password is not received | Verified in code | Better Auth is configured for Google social login. The password column exists in the generic account schema but this application does not expose password sign-in or account creation. Google credentials are entered at Google. |
| Name, email, image, provider identifiers, tokens, IP, and user agent may be stored | Verified in code | `lib/db/auth-schema.ts` and Better Auth configuration. Access, refresh, and ID token fields are present; session rows include IP and user agent. |
| Backend web session lasts seven days | Verified in code | `lib/auth.ts` sets `session.expiresIn` to seven days. OAuth token records have their own expiry, revocation, and rotation fields and are not promised a fixed seven-day life. |
| Community aggregates omit private feedback and reporter identity | Verified in code | `lib/overview.ts` aggregates votes and selected signal counts only. Private details are returned only through authenticated per-user endpoints. |
| Deleting a user removes votes, feedback, reports, sessions, and tokens | Verified by schema | Foreign keys cascade for user-owned contributions and authentication records; analysis attribution becomes null. Canonical entities and aggregate-capable records can remain. See `lib/db/schema.ts` and `lib/db/auth-schema.ts`. There is no self-service deletion UI, so the documented operator runbook must be used. |
| AI input/results expire after one calendar month | Verified in code | `lib/ai-signals.ts` sets `expiresAt` one calendar month after acceptance and excludes expired analyses from reads. `content_analyses` stores the accepted sanitized input; dependent signals cascade on deletion. |
| Expired AI rows are physically removed during the next monthly cleanup | Implemented; deployment check required | `app/api/internal/prune-analyses/route.ts` deletes expired rows, `vercel.json` invokes it monthly, and Vercel supplies `CRON_SECRET` as a bearer token when configured. Production must define the secret and confirm successful cron logs after deployment. |
| Rate-limit state lasts about one minute | Verified in code | `lib/http.ts` creates one-minute rate-limit windows; API routes apply the documented limits. Provider/platform infrastructure may maintain separate security logs under its own terms. |
| Jev transport logs omit content and credentials | Verified in code | `lib/ai/jev-runner.ts` logs model, generator version, duration, status/failure category, and token counts. It does not add the submitted state or API key to its event object. Hosting may separately log request metadata. |
| TypeSafe does not train on customer input | Verified against current provider statement | TypeSafe's current privacy policy says it does not train or fine-tune models on Input. Recheck `https://typesafe.ai/legal/privacy-policy` before material policy updates. The policy does not promise an exact TypeSafe retention period. |
| No advertising or active product-analytics code is added by the current release | Verified in source; future change planned | No analytics SDK, tracking pixel, ad SDK, or event transport was found in the extension or privacy route. GA4, PostHog, and Vercel product/performance analytics are planned for a later release and require updated disclosures, a minimized event schema, provider terms, and applicable consent or opt-out controls before activation. Ordinary infrastructure logs are disclosed separately. |
| No remote executable code in the extension | Verified in source and build model | Runtime fetches exchange API/data payloads; no fetched JavaScript, WebAssembly, dynamic module, or remote script execution path was found. Reconcile the Chrome Web Store remote-code declaration with the packaged ZIP because the dashboard previously requested a remote-code justification. |
| No sale, behavioral-ad sharing, unrelated transfer, or credit use | Operator policy commitment | Source code contains no such path. The publisher must attest that no off-repo agreement, manual export, or business practice contradicts it. |
| HTTPS is used in production | Verified in configured endpoints; deployment check required | Manifest/backend URLs and provider endpoints use HTTPS. Confirm production redirects and custom domains if added later. Local development is intentionally HTTP. |
| Children, legal disclosure, business transfer, and policy-change statements | Policy commitments | These are not facts source code can fully prove. The operator must follow the published process and obtain legal review appropriate to the business and user locations. |

## Data category reconciliation for Chrome Web Store

The current implementation supports selecting these categories in the Web Store disclosure:

- Personally identifiable information: Google name, email, profile image, and account identifiers.
- Authentication information: session and OAuth credentials. Google receives the user's Google password; Lockslop does not.
- Location: IP address can reveal approximate location; there is no GPS or precise-location collection.
- Web history: canonical URLs/external identifiers of supported YouTube and LinkedIn items viewed with the extension, plus associated hashes and request time in infrastructure records.
- User activity: deliberate votes, selected reasons, feedback, reports, sign-in/sign-out, and requests; the extension also reacts to navigation and page changes to place its UI.
- Website content: the bounded YouTube and LinkedIn fields disclosed in the policy, including YouTube comment text and possible LinkedIn image alternative text.

No implementation evidence was found for health information, financial/payment information, or personal communications. Public post/comment text may itself contain personal information or quoted communication supplied by its original author, but Lockslop does not access private messages or email bodies.

## Operational checks before publication

1. Set a strong `CRON_SECRET` in Vercel, deploy, and confirm `/api/internal/prune-analyses` succeeds from the monthly cron and rejects an unauthenticated request. Review cron logs periodically.
2. Confirm the production Vercel plan, Neon project region/plan, TypeSafe account terms, subprocessor lists, and any executed DPAs. Vercel's DPA applicability depends on the applicable plan and agreement; do not claim a signed DPA or a specific transfer mechanism without that record.
3. Confirm production Google OAuth scopes, redirect origins, publisher contact, and account deletion/revocation procedure. Test the procedure in `docs/privacy-requests.md` and keep an internal request log without retaining unnecessary request content.
4. Confirm that no Vercel Analytics/Speed Insights, GA4, PostHog, third-party dashboard integration, log drain, tracking proxy, or manual export is enabled before the planned analytics review is complete. When analytics are introduced, update this audit and the public/store disclosures before the first event is collected.
5. Decide whether the legal operator requires a full legal name, address, representative, or data-protection contact for the jurisdictions served. “Lockslop” and the published Gmail address are the current controller identification, but source code cannot establish whether that is legally sufficient.
6. Compare the exact release ZIP with the manifest and this audit, then reconcile all Web Store data categories, permission justifications, single-purpose statement, remote-code declaration, and Limited Use certification.
7. Re-run this audit whenever a permission, extracted field, provider, analytics tool, retention period, authentication flow, data export, or deletion feature changes.

## Verification note

Backend type checking, backend unit tests, the Next.js production build, extension lint, contract synchronization, content-pipeline verification, extension-context verification, Trusted Types verification, and the backend-targeted extension production build completed successfully on October 8, 2026. The end-to-end browser/Next/Neon script reached its first request-count assertion inconsistently (zero lookups on one run and two on the next, where it expects exactly one). This is an existing timing/idempotency test failure outside the privacy-page changes. It did not reveal an additional data category, but the lookup lifecycle should be made deterministic and the integration check rerun before release. Extension lint completed with pre-existing warnings and no errors.

## Provider references checked

- TypeSafe.ai privacy policy: `https://typesafe.ai/legal/privacy-policy`
- TypeSafe.ai data processing agreement: `https://typesafe.ai/legal/data-processing`
- Vercel data processing addendum: `https://vercel.com/legal/dpa`
- Vercel cron management and authentication: `https://vercel.com/docs/cron-jobs/manage-cron-jobs`
- Neon data processing addendum: `https://neon.com/pdf/DPA.pdf`
