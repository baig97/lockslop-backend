import { createHash } from "node:crypto";
import {
  canonicalContent,
  sortedJson,
  type ContentIdentity,
  type DerivedContent,
} from "./content-schema";
export * from "./content-schema";
export function hashContent(
  type: ContentIdentity["entityType"],
  input: DerivedContent,
) {
  return (
    "sha256:" +
    createHash("sha256")
      .update(sortedJson(canonicalContent(type, input)), "utf8")
      .digest("hex")
  );
}
