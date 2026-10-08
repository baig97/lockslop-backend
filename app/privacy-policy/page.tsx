import type { Metadata } from "next";
import styles from "./privacy-policy.module.css";
import { ThemeToggle } from "./theme-toggle";

const origin = "https://lockslop-backend.vercel.app";
const contact = "abdullahbaig297@gmail.com";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: "Privacy Policy · Lockslop",
  description:
    "How Lockslop handles account information, supported-page content, community contributions, and AI-assisted assessments.",
  alternates: { canonical: "/privacy-policy" },
  openGraph: {
    type: "website",
    url: "/privacy-policy",
    siteName: "Lockslop",
    title: "Privacy Policy · Lockslop",
    description:
      "How Lockslop handles data across the Chrome extension, backend, and AI-assisted assessments.",
  },
  robots: { index: true, follow: true },
};

const contents = [
  ["how-it-works", "How Lockslop works"],
  ["information", "Information we handle"],
  ["purposes", "Why we use information"],
  ["assessments", "Community and AI assessments"],
  ["providers", "Service providers"],
  ["retention", "Retention"],
  ["choices", "Your choices and rights"],
  ["permissions", "Chrome permissions"],
  ["security", "Security and children"],
  ["changes", "Changes and contact"],
] as const;

const informationRows = [
  {
    data: "Google account and profile",
    trigger: "When you choose Sign in with Google",
    details:
      "Name, email address, profile image when available, and Google/provider and Lockslop user identifiers.",
    use: "Create and identify your Lockslop account and attribute your private account activity.",
    location: "Lockslop backend database; processed by Google, Vercel, and Neon.",
    retention: "While your account remains active or until a verified deletion request, subject to legal or security needs.",
  },
  {
    data: "Authentication and session data",
    trigger: "During sign-in and authenticated use",
    details:
      "OAuth access, refresh, and ID tokens where issued; session identifiers; granted scopes; expiry and revocation times; IP address; user agent; and related security metadata. Lockslop does not receive your Google password.",
    use: "Keep you signed in, authorize read/write actions, revoke access, and protect accounts.",
    location: "Extension session storage and the Lockslop backend; processed by Google, Vercel, and Neon.",
    retention: "Extension credentials last until sign-out or browser-session termination. Backend web sessions expire after seven days; account-linked OAuth records last until expiry, revocation, or account deletion.",
  },
  {
    data: "Transient on-device page parsing",
    trigger: "When Lockslop identifies a supported YouTube watch page or eligible LinkedIn feed post",
    details:
      "The extension may scan the relevant DOM, inline platform data, or a cloned copy of a YouTube or LinkedIn response already loaded by the page. This can transiently expose additional response structure to the extension in memory.",
    use: "Locate the supported item and extract only the canonical identity, content hash inputs, and bounded fields listed below.",
    location: "On your device in the supported page. The full DOM or cloned platform response is not sent to Lockslop and is discarded as the page changes or reloads.",
    retention: "Transient memory only; it is not placed in Chrome local or session storage by Lockslop.",
  },
  {
    data: "Supported-page identity",
    trigger: "When Lockslop checks YouTube or LinkedIn for an existing rating",
    details:
      "The canonical page URL or supported external identifier and a SHA-256 content hash.",
    use: "Find the correct shared rating, distinguish content revisions, and prevent duplicate entities.",
    location: "Lockslop backend database; processed by Vercel and Neon.",
    retention: "Canonical entity records may remain while needed to provide shared ratings and preserve service integrity.",
  },
  {
    data: "Supported-page content",
    trigger: "Automatically when a signed-in user views supported content with no current AI assessment, or manually retries a failed assessment",
    details:
      "For YouTube: title, description, publication time, duration, language hint, live status, tags, engagement counts, and up to ten comment texts. For LinkedIn: post text (which can include inline image alternative text), publication and language fields when available, and engagement counts. The current LinkedIn extractor marks comments unavailable and does not send LinkedIn comment text.",
    use: "Generate content-quality signals and cache the result for other users viewing the same content revision.",
    location: "Extracted in memory on the device, then transmitted through Vercel, stored in Neon, and processed by TypeSafe.ai/Jev on an authenticated cache miss.",
    retention: "Lockslop sets the accepted analysis input and result to expire after one calendar month. Expired results are not served and are removed by the configured daily cleanup. TypeSafe applies its own service retention criteria.",
  },
  {
    data: "Community contributions",
    trigger: "When you deliberately vote, explain a vote, or submit a source report",
    details:
      "Your rating, selected reasons, optional feedback of up to 500 characters, source claim or URL, report type, account identifier, and timestamps.",
    use: "Produce community ratings, show your own selection, investigate abuse, and improve shared context.",
    location: "Lockslop backend database; processed by Vercel and Neon. Private free-text feedback and reporter identity are not shown in public aggregates.",
    retention: "While needed for the community service, unless changed, deleted, or removed following a valid request or enforcement need.",
  },
  {
    data: "Local extension information",
    trigger: "When you use the extension or change its appearance",
    details:
      "Theme preference, public account display state, browser-session credentials, and a local privacy-policy acknowledgement. The backend also stores your account’s latest policy version, acceptance or refusal, and choice time.",
    use: "Remember appearance, display sign-in state, authenticate requests, and avoid repeating the first-use disclosure for the same policy version.",
    location: "Chrome local or session storage on your device; account-level privacy choices are stored in the Lockslop backend database. Credentials are transmitted only when authenticating with the Lockslop backend.",
    retention: "Until sign-out, browser-session termination, clearing extension data, or uninstalling, depending on the item.",
  },
  {
    data: "Technical and security metadata",
    trigger: "When your browser communicates with the backend",
    details:
      "IP address, user agent, request timing, authentication status, failure category, and short-lived rate-limit counters. General location may be inferred from an IP address; Lockslop does not collect GPS or precise location.",
    use: "Deliver requests, diagnose failures without logging submitted page text, prevent abuse, and secure the service.",
    location: "Lockslop authentication and rate-limit records and hosting infrastructure; processed by Vercel and Neon.",
    retention: "Rate-limit counters expire after about one minute. Other operational records follow their associated session, account, security, or provider retention period.",
  },
  {
    data: "Privacy-page preference",
    trigger: "When you use the light/dark theme control on this page",
    details: "A light or dark theme value.",
    use: "Remember your preferred appearance.",
    location: "Your browser’s local storage only; it is not sent to Lockslop.",
    retention: "Until you clear site data or replace the preference.",
  },
];

const retentionRows = [
  ["Extension session credentials", "Until sign-out or browser-session termination."],
  ["Extension theme, public account display, and privacy acknowledgement", "Until sign-out where applicable, clearing extension data, uninstalling, or replacing the acknowledgement with a later policy version."],
  ["Account privacy choice", "The latest choice is retained while your account is active, until replaced by a new choice or removed with account deletion."],
  ["Backend web session", "Seven days from creation, unless revoked sooner."],
  ["AI input, status, and generated signals", "Configured to expire one calendar month after first acceptance. Expired analyses are not served and the Vercel cleanup route is scheduled daily; deployment monitoring must confirm successful runs."],
  ["Rate-limit state", "Approximately one minute."],
  ["Account and provider records", "While the account is active or until a verified deletion request, except where a longer period is required for law, disputes, or security."],
  ["Votes, reasons, feedback, and reports", "While needed for the community service, subject to updates, enforcement, and applicable correction or deletion rights."],
  ["Canonical entity records and non-personal aggregates", "While needed to match and serve shared ratings and preserve service integrity."],
  ["Privacy-page theme", "Until you clear this site’s local storage or choose another theme."],
] as const;

function Wordmark() {
  return (
    <a className={styles.brand} href="#top" aria-label="Lockslop privacy policy home">
      <img
        className={`${styles.wordmark} ${styles.wordmarkLight}`}
        src="/brand/lockslop-wordmark-light.png"
        width="1308"
        height="316"
        alt="Lockslop"
      />
      <img
        className={`${styles.wordmark} ${styles.wordmarkDark}`}
        src="/brand/lockslop-wordmark-dark.png"
        width="1308"
        height="316"
        alt="Lockslop"
      />
    </a>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main id="top" className={styles.page}>
      <header className={styles.header}>
        <Wordmark />
        <ThemeToggle />
      </header>

      <section className={styles.hero} aria-labelledby="policy-title">
        <div className={styles.eyebrow}>Clear by design · Effective October 8, 2026</div>
        <h1 id="policy-title">Privacy, without the fog.</h1>
        <p className={styles.lede}>
          This policy explains what Lockslop handles when it places community context and AI-assisted signals on supported YouTube and LinkedIn content. It covers the Chrome extension, Lockslop backend and authentication services, and this privacy page.
        </p>
        <div className={styles.summaryGrid} aria-label="Privacy at a glance">
          <article className={styles.summaryCard}>
            <span className={styles.summaryIndex}>01</span>
            <h2>No ads or analytics</h2>
            <p>Lockslop does not use your data for advertising or add behavioral analytics to the current extension or this page.</p>
          </article>
          <article className={styles.summaryCard}>
            <span className={styles.summaryIndex}>02</span>
            <h2>Community first</h2>
            <p>Existing community ratings can be viewed without signing in. Contributing requires a deliberate signed-in action.</p>
          </article>
          <article className={styles.summaryCard}>
            <span className={styles.summaryIndex}>03</span>
            <h2>Automatic cache misses</h2>
            <p>For signed-in users, bounded supported-page content is sent automatically when no current AI assessment exists.</p>
          </article>
          <article className={styles.summaryCard}>
            <span className={styles.summaryIndex}>04</span>
            <h2>No data sales</h2>
            <p>Lockslop does not sell personal information or transfer it for unrelated purposes or credit decisions.</p>
          </article>
        </div>
      </section>

      <div className={styles.contentLayout}>
        <aside className={styles.toc} aria-label="Privacy policy contents">
          <p className={styles.tocLabel}>On this page</p>
          <nav>
            <ol>
              {contents.map(([id, label], index) => (
                <li key={id}>
                  <a href={`#${id}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className={styles.policy}>
          <section id="how-it-works">
            <div className={styles.sectionHeading}>
              <span>01</span>
              <h2>How Lockslop works</h2>
            </div>
            <p>
              Lockslop first shows a short disclosure with a link to this policy. Until you enable Lockslop, its supported-page discovery, extraction, rating lookups, and AI analysis stay off. Authentication and privacy-status requests can still run to check your account and the current policy version. Signed-in users must agree to the current version before continuing; declining signs them out. After you enable it, Lockslop adds a small rating interface to supported YouTube watch pages and LinkedIn feed posts. To identify the content revision, the extension locally extracts selected text and metadata and computes a content hash. Its page-side parsers may transiently scan a cloned copy of a platform response or the relevant page DOM in memory, but they keep only the bounded fields listed below. The initial cache lookup sends the content type, canonical URL or supported external identifier, and the hash—not the full text or comments.
            </p>
            <p>
              If the user is signed in and that cache lookup finds no current assessment, the extension automatically sends the bounded supported-page content described below to generate one. There is no separate “analyze” click for the first attempt. A retry after a provider failure is user-initiated. Community votes, explanations, and source reports are sent only when a signed-in user deliberately submits them.
            </p>
            <div className={styles.callout}>
              <strong>Bounded access.</strong>
              <p>
                Lockslop does not upload or analyze YouTube video/audio or LinkedIn image/video pixels, open linked articles, read YouTube or LinkedIn cookies, access browser-stored passwords, or read private messages. It does not run on other websites. LinkedIn post text may include accessible alternative text attached to an inline image.
              </p>
            </div>
          </section>

          <section id="information">
            <div className={styles.sectionHeading}>
              <span>02</span>
              <h2>Information we handle</h2>
            </div>
            <p>
              “Handle” includes collecting, receiving, storing, transmitting, or otherwise using information. Some supported-page text is public at its source but may still contain personal information written by an author or commenter. Lockslop discards structured commenter identities, but it cannot guarantee that names or other personal details are absent from free text.
            </p>
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Information handling table">
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th scope="col">Information</th>
                    <th scope="col">When and what</th>
                    <th scope="col">Purpose</th>
                    <th scope="col">Where and who</th>
                    <th scope="col">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {informationRows.map((row) => (
                    <tr key={row.data}>
                      <th scope="row">{row.data}</th>
                      <td data-label="When and what"><strong>{row.trigger}.</strong> {row.details}</td>
                      <td data-label="Purpose">{row.use}</td>
                      <td data-label="Where and who">{row.location}</td>
                      <td data-label="Retention">{row.retention}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="purposes">
            <div className={styles.sectionHeading}>
              <span>03</span>
              <h2>Why we use information</h2>
            </div>
            <p>Lockslop uses information only to operate and protect the service:</p>
            <ul>
              <li>find and return the correct community rating and cached signals;</li>
              <li>authenticate accounts and authorize user-requested read and write actions;</li>
              <li>accept, aggregate, and display community contributions;</li>
              <li>generate an AI-assisted assessment automatically when a signed-in view produces an authenticated cache miss, or when the user retries a failed assessment;</li>
              <li>detect duplicate content revisions, rate-limit requests, investigate abuse, and keep the service reliable;</li>
              <li>respond to support and privacy requests and comply with legal obligations.</li>
            </ul>
            <p>
              Where data-protection law requires a legal basis, core processing is necessary to provide the service you request. Security, abuse prevention, reliability, and maintenance rely on Lockslop’s legitimate interests in operating a trustworthy service, balanced against user rights. Processing may also be necessary to meet a legal obligation or establish and defend legal claims.
            </p>
          </section>

          <section id="assessments">
            <div className={styles.sectionHeading}>
              <span>04</span>
              <h2>Community and AI assessments</h2>
            </div>
            <h3>Community context</h3>
            <p>
              Community percentages reflect users’ opinions about the supported content. They are not verified facts, endorsements, or judgments about the author. Private free-text feedback and reporter identity are not included in public aggregate counts.
            </p>
            <h3>AI-assisted signals</h3>
            <p>
              For a signed-in user, the first authenticated cache miss automatically sends the relevant supported-page text and metadata to TypeSafe.ai’s Jev service; a later retry after provider failure requires a user action. YouTube video/audio, LinkedIn image/video pixels, and the contents of linked pages are not sent. LinkedIn post text can include accessible image alternative text. TypeSafe’s current policy states that it does not train or fine-tune AI or machine-learning models on customer prompts or other input. TypeSafe may process technical service data and retains customer data according to its service and legal requirements. See the <a href="https://typesafe.ai/legal/privacy-policy">TypeSafe.ai privacy policy</a> and <a href="https://typesafe.ai/legal/data-processing">data processing terms</a>.
            </p>
            <div className={styles.callout}>
              <strong>What the result means.</strong>
              <p>
                AI signal scores describe the strength of selected content patterns. They are advisory, can be incomplete or wrong, and are not a calibrated probability that content is false or AI-generated. Lockslop does not use them to make decisions about credit, employment, education, housing, eligibility, or other legal rights.
              </p>
            </div>
          </section>

          <section id="providers">
            <div className={styles.sectionHeading}>
              <span>05</span>
              <h2>Service providers and disclosures</h2>
            </div>
            <p>Lockslop uses a small set of providers to deliver the service:</p>
            <div className={styles.providerGrid}>
              <article><h3>Google</h3><p>OAuth authentication and account identity.</p><a href="https://policies.google.com/privacy">Privacy policy</a></article>
              <article><h3>Vercel</h3><p>Hosting, request delivery, and infrastructure protection.</p><a href="https://vercel.com/legal/privacy-policy">Privacy policy</a></article>
              <article><h3>Neon</h3><p>Managed PostgreSQL database infrastructure.</p><a href="https://neon.com/privacy-policy">Privacy policy</a></article>
              <article><h3>TypeSafe.ai / Jev</h3><p>AI-assisted analysis for authenticated cache misses and retries.</p><a href="https://typesafe.ai/legal/privacy-policy">Privacy policy</a></article>
            </div>
            <p>
              Lockslop’s production application and database services are currently configured in Asia-Pacific regions. Providers may still process limited information in other countries for delivery, support, security, or subprocessors under the terms that apply to Lockslop’s account. Vercel, Neon, and TypeSafe publish data-processing terms that include transfer mechanisms such as standard contractual clauses in covered circumstances. The exact mechanism available to Lockslop depends on the applicable provider agreement and plan; contact Lockslop for the mechanism relevant to a request.
            </p>
            <p>
              Lockslop may preserve or disclose information when reasonably necessary to comply with law or valid legal process, respond to a user request, investigate fraud or abuse, protect rights and safety, or establish and defend legal claims. Information may also transfer as part of a merger, acquisition, financing, reorganization, or sale of service assets, subject to applicable notice and privacy obligations.
            </p>
            <p>
              Lockslop does not sell personal information, share it for cross-context behavioral advertising, use it for advertising, or transfer it for an unrelated purpose. Lockslop does not use personal information to determine creditworthiness or for lending.
            </p>
          </section>

          <section id="retention">
            <div className={styles.sectionHeading}>
              <span>06</span>
              <h2>Retention</h2>
            </div>
            <p>
              Lockslop keeps information for the shortest period that supports the purposes described here, subject to security, dispute, and legal requirements. The current operational periods are:
            </p>
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Data retention table">
              <table className={`${styles.dataTable} ${styles.retentionTable}`}>
                <thead><tr><th scope="col">Record</th><th scope="col">Current period</th></tr></thead>
                <tbody>
                  {retentionRows.map(([record, period]) => (
                    <tr key={record}><th scope="row">{record}</th><td data-label="Current period">{period}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Uninstalling the extension removes extension-managed local data through Chrome, but it does not automatically delete an account or contributions already stored by the backend. Use the request process below for backend deletion.
            </p>
          </section>

          <section id="choices">
            <div className={styles.sectionHeading}>
              <span>07</span>
              <h2>Your choices and rights</h2>
            </div>
            <p>You can control Lockslop data in several ways:</p>
            <ul>
              <li>sign out to remove the extension’s active session and public account display state;</li>
              <li>revoke Lockslop’s Google access from your Google account permissions;</li>
              <li>clear extension or site data through Chrome, or uninstall the extension;</li>
              <li>change a community vote or its explanation through the extension where that control is available;</li>
              <li>email <a href={`mailto:${contact}`}>{contact}</a> to request access, correction, deletion, restriction, objection, or a portable copy of eligible personal information.</li>
            </ul>
            <p>
              Lockslop may ask for enough information to verify that a request concerns your account and will respond within the period required by applicable law. Some records may be retained where required for security, legal obligations, fraud prevention, dispute resolution, or the rights of others. Non-personal shared entity records or aggregates may remain after personal information is removed.
            </p>
            <h3>Regional rights</h3>
            <p>
              Depending on where you live, you may have rights to know or access personal information, correct it, delete it, restrict or object to processing, receive a portable copy, or complain to a data-protection authority. EEA, UK, and Swiss users may object to processing based on legitimate interests and may contact their local supervisory authority. California residents may request to know, correct, or delete covered information and receive equal service for exercising a privacy right. Lockslop does not sell or share personal information for behavioral advertising, so there is no sale or sharing to opt out of.
            </p>
          </section>

          <section id="permissions">
            <div className={styles.sectionHeading}>
              <span>08</span>
              <h2>Chrome permissions and Google data</h2>
            </div>
            <div className={styles.permissionList}>
              <article><code>identity</code><p>Opens Google sign-in through Chrome’s secure web-auth flow and receives the authorization result needed to create an extension session.</p></article>
              <article><code>storage</code><p>Keeps the theme, public sign-in display state, and browser-session credentials in Chrome’s local or session storage.</p></article>
              <article><code>youtube.com</code><p>Displays Lockslop on YouTube and reads the bounded watch-page fields described in this policy.</p></article>
              <article><code>linkedin.com</code><p>Displays Lockslop on LinkedIn and reads the bounded post fields described in this policy.</p></article>
              <article><code>lockslop-backend.vercel.app</code><p>Allows the extension to authenticate and exchange rating, contribution, and the analysis data described above with the Lockslop backend.</p></article>
            </div>
            <div className={`${styles.callout} ${styles.limitedUse}`}>
              <strong>Google API Limited Use</strong>
              <p>
                Lockslop’s use and transfer of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.
              </p>
            </div>
          </section>

          <section id="security">
            <div className={styles.sectionHeading}>
              <span>09</span>
              <h2>Security and children</h2>
            </div>
            <h3>Security</h3>
            <p>
              Lockslop uses HTTPS in production, scoped OAuth authorization, token expiry and revocation, request-size limits, rate limiting, and managed hosting and database controls. The Jev transport log records model/version, status, duration, failure category, and token-usage counts—not submitted page text or credentials. Hosting and authentication providers may still process standard request metadata such as IP address, user agent, path, status, and timing. No electronic transmission or storage system can guarantee absolute security.
            </p>
            <h3>Children</h3>
            <p>
              Lockslop is not directed to children under 13 and users must satisfy the age rules of Chrome, Google, YouTube, LinkedIn, and their local law. If you believe a child has provided personal information to Lockslop, email <a href={`mailto:${contact}`}>{contact}</a> so it can be reviewed and removed where appropriate.
            </p>
          </section>

          <section id="changes">
            <div className={styles.sectionHeading}>
              <span>10</span>
              <h2>Changes and contact</h2>
            </div>
            <p>
              This policy may change when Lockslop’s features, providers, or legal obligations change. The revised policy will be posted at this URL with a new effective date. Material changes will be communicated through an appropriate service or store notice when required.
            </p>
            <div className={styles.contactCard}>
              <p className={styles.contactLabel}>Privacy and data-rights contact</p>
              <h3>Lockslop</h3>
              <a href={`mailto:${contact}`}>{contact}</a>
              <p>For a privacy request, include “Privacy request” in the subject and identify the Lockslop account email involved.</p>
            </div>
          </section>
        </article>
      </div>

      <footer className={styles.footer}>
        <Wordmark />
        <p>More signal. Less slop.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
