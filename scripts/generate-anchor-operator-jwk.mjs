// scripts/generate-anchor-operator-jwk.mjs
// 生成 secp256k1 运营密钥（EVM 锚定适配器用）：
//   - 私钥以 JWK 形式追加到 .env.local 的 ANCHOR_OPERATOR_PRIVATE_KEY_JWK（0600，不打印私钥）
//   - 只打印派生的公开地址（供水龙头注资）与 JWK 公钥部分
// 用法：node scripts/generate-anchor-operator-jwk.mjs [--force]
//   --force：若 .env.local 已有 ANCHOR_OPERATOR_PRIVATE_KEY_JWK 则覆盖（旧密钥丢失，谨慎）
import { generateKeyPairSync } from "node:crypto";
import { writeFile, readFile, stat } from "node:fs/promises";
import { loadEnvironmentFile } from "./lib/environment-file.mjs";

const environmentPath = new URL("../.env.local", import.meta.url);
const envKey = "ANCHOR_OPERATOR_PRIVATE_KEY_JWK";
const force = process.argv.includes("--force");

await loadEnvironmentFile(environmentPath, { target: process.env });
if (process.env[envKey] && !force) {
  console.error(`${envKey} already exists in .env.local; pass --force to replace it (old key is lost).`);
  process.exit(1);
}

const keyPair = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
const jwk = keyPair.privateKey.export({ format: "jwk" });
if (jwk.kty !== "EC" || jwk.crv !== "secp256k1" || !jwk.d) {
  throw new Error("unexpected JWK shape");
}

// 以公钥坐标派生以太坊地址：keccak256(pubkeyXY 去掉 0x04 前缀)[12..]（keccak256 来自 ethers，仅本脚本加载）
const { keccak256 } = await import("ethers");
const rawPub = keyPair.publicKey.export({ format: "der", type: "spki" });
// SPKI 末尾 65 字节是 0x04 || X(32) || Y(32)
const uncompressed = rawPub.subarray(rawPub.length - 65);
if (uncompressed[0] !== 0x04) throw new Error("unexpected SPKI tail");
const address = keccak256(new Uint8Array(uncompressed.subarray(1))).replace(/^0x/, "").slice(-40);
const addressHex = `0x${address.toLowerCase()}`;

const compactJwk = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, d: jwk.d });
let content = "";
try {
  content = await readFile(environmentPath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const line = `${envKey}='${compactJwk}'`;
const next = content.includes(`${envKey}=`)
  ? content.replace(new RegExp(`^${envKey}=.*$`, "m"), line)
  : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
await writeFile(environmentPath, next, { mode: 0o600 });
try {
  const info = await stat(environmentPath);
  if ((info.mode & 0o777) !== 0o600) await writeFile(environmentPath, next, { mode: 0o600 });
} catch { /* best effort */ }

console.log(JSON.stringify({
  address: addressHex,
  publicKeyJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
  note: "Private key written to .env.local (ANCHOR_OPERATOR_PRIVATE_KEY_JWK). Fund the address on Base Sepolia, then wire ANCHOR_ADAPTERS_JSON.",
}, null, 2));
