# Privacy request runbook

This runbook supports requests sent to `abdullahbaig297@gmail.com` under the public Lockslop privacy policy. Keep request correspondence and any exported data private. Do not put OAuth tokens, submitted page content, or identity documents in application logs or issue trackers.

## 1. Record and classify the request

Record an internal request ID, received date, requested right, jurisdiction if the requester supplied it, and the response deadline required by applicable law. Classify the request as access/portability, correction, deletion, restriction/objection, or a privacy question.

## 2. Verify the requester

Use the email address already associated with the Lockslop account. Ask only for the minimum additional information needed to distinguish the account. Do not request government identification unless it is necessary and proportionate. If the request cannot be verified, explain what is missing without exposing whether another person has an account.

## 3. Find the affected records

Resolve the verified account to its `auth.user` ID, then identify:

- profile and provider records in the Better Auth schema;
- sessions, OAuth grants, access tokens, and refresh tokens;
- the latest policy version, acceptance/refusal, and choice time in `auth.privacy_consent`;
- content votes, selected signals, private feedback, and reports;
- analysis rows attributed to the user;
- correspondence or security records that must be included or retained.

Canonical entities and aggregate results are shared service records. Determine whether they contain information that still identifies the requester before including or removing them.

## 4. Fulfil the request

### Access or portability

Export eligible account data and the requester’s own contributions in a readable structured format. Exclude other users’ identities, security secrets, raw credentials, internal abuse controls, and information that would impair another person’s rights. Deliver the export through an appropriately secure channel.

### Correction

Correct the verified account profile or contribution where the service permits correction. Google profile fields may need to be corrected at Google and refreshed through a later sign-in.

### Deletion

1. If a usable Google provider token remains, revoke the Lockslop grant using Google’s supported revocation process.
2. Revoke active Lockslop sessions and OAuth access/refresh tokens.
3. Delete the verified `auth.user` record inside a database transaction. Current foreign keys cascade account, session, token, vote, feedback, selected-signal, and reporter-linked records. Analysis attribution is set to `null`; analysis input and signals remain only until their ordinary one-month expiry and pruning cycle.
4. Do not delete canonical entity records solely because one user submitted them unless they still identify that user or another valid basis requires deletion.
5. Preserve only records required for law, security, fraud prevention, dispute resolution, or the rights of others. Document the category and required retention period without retaining unnecessary content.

### Restriction or objection

Stop the challenged non-essential processing while the request is assessed. Core processing may continue where it is necessary to provide a service the user still requests or where Lockslop has overriding legal grounds. Explain the decision and available complaint route.

## 5. Verify completion

Confirm that no active account, session, OAuth token, vote, private feedback, or report remains for the deleted user ID. Confirm that any remaining analysis row has a null user attribution and will be removed by the scheduled content-pruning job. Record the completion date and the categories removed or retained; do not copy deleted content into the completion record.

## 6. Respond

Reply within the period required by applicable law. State what was done, any limited category that was retained and why, and how to complain or appeal where required. Never send stored OAuth credentials, session tokens, another user’s data, or internal security controls in the response.

## Operational changes that require a policy review

Review the public policy and Chrome Web Store disclosures before adding a provider, analytics, advertising, a new host permission, new page fields, longer retention, a new AI use, or a self-service account-deletion flow.
