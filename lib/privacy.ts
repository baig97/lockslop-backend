import { pool } from "./db";
import { HttpError } from "./http";

export function currentPrivacyVersion() {
  const version = process.env.PRIVACY_POLICY_VERSION?.trim();
  if (!version || version.length > 100)
    throw new HttpError(503, "Privacy policy version is not configured.");
  return version;
}
export async function privacyStatus(userId?: string) {
  const currentVersion = currentPrivacyVersion();
  const { rows } = userId
    ? await pool.query(
        "SELECT policy_version, accepted FROM auth.privacy_consent WHERE user_id=$1",
        [userId],
      )
    : { rows: [] };
  return {
    userId: userId ?? null,
    currentVersion,
    acceptedVersion: rows[0]?.accepted
      ? (rows[0].policy_version as string)
      : null,
    requiresConsent:
      !rows[0]?.accepted || rows[0].policy_version !== currentVersion,
  };
}
export async function requirePrivacyConsent(userId: string) {
  if ((await privacyStatus(userId)).requiresConsent)
    throw new HttpError(
      403,
      "Agree to the current privacy policy to continue.",
    );
}
export async function savePrivacyChoice(
  userId: string,
  version: string,
  accepted: boolean,
) {
  if (version !== currentPrivacyVersion())
    throw new HttpError(
      409,
      "The privacy policy has changed. Review the current version.",
    );
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      `INSERT INTO auth.privacy_consent (user_id,policy_version,accepted,updated_at)
      VALUES ($1,$2,$3,now()) ON CONFLICT(user_id) DO UPDATE
      SET policy_version=excluded.policy_version,accepted=excluded.accepted,updated_at=now()`,
      [userId, version, accepted],
    );
    if (!accepted) {
      // Rejecting consent also invalidates this user's extension credentials.
      await connection.query(
        "UPDATE auth.oauth_access_token SET revoked=now() WHERE user_id=$1 AND client_id=$2 AND revoked IS NULL",
        [userId, process.env.OAUTH_EXTENSION_CLIENT_ID],
      );
      await connection.query(
        "UPDATE auth.oauth_refresh_token SET revoked=now() WHERE user_id=$1 AND client_id=$2 AND revoked IS NULL",
        [userId, process.env.OAUTH_EXTENSION_CLIENT_ID],
      );
      await connection.query("DELETE FROM auth.session WHERE user_id=$1", [
        userId,
      ]);
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
  return {
    userId,
    currentVersion: version,
    acceptedVersion: accepted ? version : null,
    requiresConsent: !accepted,
  };
}
