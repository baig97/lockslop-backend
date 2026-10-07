import { identitySchema, type ContentIdentity } from "./contracts/content";
export function normalizeIdentity(raw: ContentIdentity) {
  const identity = identitySchema.parse(raw);
  if (identity.externalId) {
    if (identity.entityType === "youtube_video") {
      if (!/^[A-Za-z0-9_-]{11}$/.test(identity.externalId))
        throw Error("Invalid video ID");
      return {
        entityType: identity.entityType,
        url: `https://www.youtube.com/watch?v=${identity.externalId}`,
        externalId: null,
      };
    }
    return {
      entityType: identity.entityType,
      url: null,
      externalId: identity.externalId,
    };
  }
  const u = new URL(identity.url!);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.port
  )
    throw Error("Unsupported URL");
  if (identity.entityType === "youtube_video") {
    if (
      !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        u.hostname,
      )
    )
      throw Error("Unsupported video URL");
    const parts = u.pathname.split("/").filter(Boolean);
    const id =
      u.hostname === "youtu.be" && parts.length === 1
        ? parts[0]
        : u.pathname === "/watch"
          ? u.searchParams.get("v")
          : parts.length === 2 && ["shorts", "embed", "live"].includes(parts[0])
            ? parts[1]
            : null;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id))
      throw Error("Invalid video URL");
    return {
      entityType: identity.entityType,
      url: `https://www.youtube.com/watch?v=${id}`,
      externalId: null,
    };
  }
  if (!["linkedin.com", "www.linkedin.com"].includes(u.hostname))
    throw Error("Unsupported LinkedIn URL");
  const path = u.pathname.replace(/\/+$/, "");
  if (
    !/^\/posts\/[A-Za-z0-9_%.-]+-(?:activity|ugcPost|share)-\d+-[A-Za-z0-9_-]+$/.test(
      path,
    ) &&
    !/^\/feed\/update\/urn:li:(?:activity|ugcPost|share):\d+$/.test(path)
  )
    throw Error("Unsupported post URL");
  return {
    entityType: identity.entityType,
    url: `https://www.linkedin.com${path}/`,
    externalId: null,
  };
}
