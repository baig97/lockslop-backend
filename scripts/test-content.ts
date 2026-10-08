import assert from "node:assert/strict";
import {
  identitySchema,
  envelopeSchema,
  sanitizeContent,
  hashContent,
  sortedJson,
} from "../lib/contracts/content";
import { normalizeIdentity } from "../lib/identity";
import { checkContentLanguage, isEnglish } from "../lib/ai/language";
import {
  founderEnglishPost,
  rejectedLanguageSamples,
} from "./language-fixtures";
import { fixtureContent, evaluationFixtures } from "./evaluation-fixtures";
const sample = fixtureContent(evaluationFixtures[0]);
const content = sanitizeContent("youtube_video", sample);
const hash = hashContent("youtube_video", content);
assert.match(hash, /^sha256:[a-f0-9]{64}$/);
assert.equal(
  sortedJson({ z: 1, a: { y: 2, x: 3 } }),
  '{"a":{"x":3,"y":2},"z":1}',
);
const modified = structuredClone(sample);
modified.counts.comments = 123 as any;
modified.comments = {
  status: "available",
  items: [
    {
      text: "Useful explanation",
      username: "private",
      profileUrl: "https://private.test",
      avatar: "private",
      tracking: "private",
    },
  ],
} as any;
const clean = sanitizeContent("youtube_video", modified);
assert.deepEqual(clean.comments.items, [{ text: "Useful explanation" }]);
assert(!JSON.stringify(clean).includes("private"));
assert.equal(hashContent("youtube_video", clean), hash);
modified.description += "Changed";
assert.notEqual(
  hashContent("youtube_video", sanitizeContent("youtube_video", modified)),
  hash,
);
assert.throws(() => hashContent("linkedin_post", content));
assert.throws(() => sanitizeContent("linkedin_post", sample));
assert.throws(() =>
  sanitizeContent("youtube_video", {
    ...sample,
    description: "a".repeat(40000),
  }),
);
assert.throws(() =>
  identitySchema.parse({
    entityType: "youtube_video",
    url: "https://youtube.com/watch?v=abcdefghijk",
    externalId: "abcdefghijk",
  }),
);
assert.throws(() =>
  identitySchema.parse({ entityType: "linkedin_post", externalId: " " }),
);
assert.throws(() => identitySchema.parse({ entityType: "youtube_video" }));
assert.equal(
  normalizeIdentity({ entityType: "youtube_video", externalId: "abcdefghijk" })
    .url,
  "https://www.youtube.com/watch?v=abcdefghijk",
);
assert.equal(
  normalizeIdentity({
    entityType: "youtube_video",
    url: "http://youtu.be/abcdefghijk?t=5",
  }).url,
  "https://www.youtube.com/watch?v=abcdefghijk",
);
assert.equal(
  normalizeIdentity({
    entityType: "linkedin_post",
    url: "http://linkedin.com/posts/test-ugcPost-123-abc?tracking=x#x",
  }).url,
  "https://www.linkedin.com/posts/test-ugcPost-123-abc/",
);
assert.throws(() =>
  normalizeIdentity({
    entityType: "linkedin_post",
    url: "https://www.linkedin.com/feed/",
  }),
);
assert.throws(() =>
  normalizeIdentity({
    entityType: "youtube_video",
    url: "https://evil.test/watch?v=abcdefghijk",
  }),
);
for (const text of [
  founderEnglishPost,
  founderEnglishPost.replace(/\s+/g, " "),
  founderEnglishPost.replace(/'/g, "’"),
]) {
  assert(isEnglish(text), "Conversational English must pass the language gate");
  assert.equal(
    checkContentLanguage(
      sanitizeContent("linkedin_post", { schemaVersion: 2, text }),
    ),
    null,
  );
  assert.equal(
    checkContentLanguage(
      sanitizeContent("youtube_video", {
        ...sample,
        title: "My brain at 3 AM",
        description: text,
      }),
    ),
    null,
  );
}
for (const text of rejectedLanguageSamples)
  assert.equal(
    isEnglish(text),
    false,
    "Do not force unrelated or undetermined language samples to English",
  );
const nonEnglishBody = rejectedLanguageSamples[1].repeat(6);
const englishSegment =
  "I finally finished building the product and now I can get some sleep before the next idea wakes me up again.";
for (const text of [
  `${nonEnglishBody}\n\n${englishSegment}`,
  `${nonEnglishBody} ${englishSegment}`,
  `${englishSegment}\n${nonEnglishBody}`,
]) {
  const mixedPost = sanitizeContent("linkedin_post", {
    schemaVersion: 2,
    text,
  });
  const before = structuredClone(mixedPost);
  assert.equal(
    checkContentLanguage(mixedPost),
    null,
    "English body segments qualify mixed-language content",
  );
  assert.deepEqual(
    mixedPost,
    before,
    "Language qualification must preserve the original payload",
  );
  assert.equal(
    checkContentLanguage(
      sanitizeContent("youtube_video", {
        ...sample,
        title: "Título no inglés",
        description: text,
      }),
    ),
    null,
  );
}
assert.equal(
  checkContentLanguage(
    sanitizeContent("youtube_video", {
      ...sample,
      title: englishSegment,
      description: nonEnglishBody,
      comments: { status: "available", items: [{ text: englishSegment }] },
      tags: [englishSegment],
      languageHint: "en",
    }),
  )?.status,
  "unsupported_language",
  "English comments, tags or hints cannot rescue a non-English description",
);
assert.equal(
  checkContentLanguage(
    sanitizeContent("linkedin_post", {
      schemaVersion: 2,
      text: `${nonEnglishBody}\n\nOK AI SEO CEO 3 AM 😅`,
    }),
  )?.status,
  "unsupported_language",
  "Tiny fragments are not sufficient English evidence",
);
assert.equal(checkContentLanguage(content), null);
assert.equal(
  checkContentLanguage(
    sanitizeContent("youtube_video", fixtureContent(evaluationFixtures[6])),
  )?.status,
  "unsupported_language",
);
assert.equal(
  envelopeSchema.parse({ entities: new Array(10).fill({}) }).entities.length,
  10,
);
assert.throws(() => envelopeSchema.parse({ entities: new Array(11).fill({}) }));
assert.throws(() =>
  sanitizeContent("youtube_video", {
    ...sample,
    description: "界".repeat(12000),
  }),
);
assert.throws(() =>
  sanitizeContent("youtube_video", {
    ...sample,
    observedAt: "2026-10-07T00:00:00Z",
  }),
);
const post = sanitizeContent("linkedin_post", {
  schemaVersion: 2,
  text: sample.description,
});
assert.throws(() =>
  sanitizeContent("linkedin_post", { ...post, durationSeconds: 1 }),
);
assert.throws(() =>
  sanitizeContent("youtube_video", { ...sample, text: "post" }),
);
assert.match(hashContent("linkedin_post", post), /^sha256:[a-f0-9]{64}$/);
assert.throws(() => envelopeSchema.parse({ entities: [] }));
console.log(
  "PASS: identity XOR, canonical URLs, core-only deterministic hashes, UTF-8 size bounds, schema sanitation, PII field removal, platform restrictions and language gating.",
);
