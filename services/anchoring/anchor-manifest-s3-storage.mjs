// services/anchoring/anchor-manifest-s3-storage.mjs
// R2 的 S3 兼容 API 适配：供 cron 侧 anchor-tick（Node，无 Workers 绑定）把 manifest
// 持久化到内容寻址桶。签名用 AWS SigV4（header auth，签名 payload）。
import { createHmac, createHash } from "node:crypto";
import { canonicalUtf8 } from "../../packages/protocol/canonical-json.mjs";
import { anchorManifestHash } from "../../packages/protocol/anchor-manifest.mjs";

export class AnchorManifestS3Error extends Error {
  constructor(message) {
    super(message);
    this.name = "AnchorManifestS3Error";
  }
}

export function createS3ManifestStorage({
  endpoint, bucket, accessKeyId, secretAccessKey, prefix = "anchors", region = "auto", service = "s3",
}) {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new TypeError("createS3ManifestStorage requires endpoint, bucket, accessKeyId, and secretAccessKey.");
  }
  const base = new URL(endpoint);
  if (base.protocol !== "https:" && base.hostname !== "127.0.0.1" && base.hostname !== "localhost") {
    throw new AnchorManifestS3Error("S3 endpoint must use https (localhost allowed for tests).");
  }
  const host = base.host;
  return {
    async put(manifest) {
      const manifestHash = await anchorManifestHash(manifest);
      const key = `${prefix}/${manifestHash}`;
      const body = canonicalUtf8(manifest);
      await signedFetch({
        method: "PUT",
        base, host, bucket, key, body,
        accessKeyId, secretAccessKey, region, service,
      });
      return { key, manifestHash };
    },
    async get(key) {
      const response = await signedFetch({
        method: "GET", base, host, bucket, key, body: new Uint8Array(),
        accessKeyId, secretAccessKey, region, service,
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new AnchorManifestS3Error(`S3 GET failed with status ${response.status}.`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

async function signedFetch({ method, base, host, bucket, key, body, accessKeyId, secretAccessKey, region, service }) {
  const payloadHash = sha256Hex(body);
  const now = new Date();
  const amzDate = `${now.toISOString().replaceAll("-", "").replaceAll(":", "").slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const canonical = buildCanonicalRequest({ method, path: `/${bucket}/${key}`, host, payloadHash, amzDate });
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(new TextEncoder().encode(canonical)),
  ].join("\n");
  const signingKey = s3SigningKey({ secret: secretAccessKey, date: dateStamp, region, service });
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, `
    + "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, "
    + `Signature=${signature}`;
  const objectPath = `${base.pathname.replace(/\/$/, "")}/${bucket}/${key}`;
  return fetch(`${base.origin}${objectPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization,
    },
    body: method === "PUT" ? body : undefined,
  });
}

/** Canonical request per SigV4: method \n path \n query(空) \n 排序头 \n 签名头列表 \n payload 哈希。 */
export function buildCanonicalRequest({ method, path, host, payloadHash, amzDate }) {
  return [
    method,
    path,
    "",
    `content-type:application/json`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
    "content-type;host;x-amz-content-sha256;x-amz-date",
    payloadHash,
  ].join("\n");
}

/** SigV4 派生密钥链：HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), service), "aws4_request")。 */
export function s3SigningKey({ secret, date, region, service }) {
  const kDate = createHmac("sha256", `AWS4${secret}`).update(date).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update(service).digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
