const { execFileSync } = require("child_process");
const fs = require("fs");

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const riskyPathPattern =
  /(^|\/)(?:id|.*(?:keypair|private|secret|mnemonic|seed-phrase).*)\.(?:json|txt|env)$/i;
const envSecretPattern =
  /^\s*(?:export\s+)?[A-Z0-9_]*(?:PRIVATE|SECRET|MNEMONIC|KEYPAIR)[A-Z0-9_]*\s*=\s*["']?([^"'\s#]+)["']?/;
const labelledBase58SecretPattern =
  /(private[_ -]?key|secret[_ -]?key|mnemonic|seed phrase)\s*[:=]\s*["'`]?([1-9A-HJ-NP-Za-km-z]{80,120})/i;

function isByteArray(value) {
  return (
    Array.isArray(value) &&
    value.length >= 64 &&
    value.length <= 128 &&
    value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
  );
}

function hasKeyShapedJson(value, path = []) {
  if (isByteArray(value)) return path.join(".") || "$";
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (/secret|private|keypair|mnemonic|seed/i.test(key)) {
      if (
        isByteArray(nested) ||
        (typeof nested === "string" &&
          /^[1-9A-HJ-NP-Za-km-z]{80,120}$/.test(nested))
      ) {
        return nextPath.join(".");
      }
    }
    const nestedHit = hasKeyShapedJson(nested, nextPath);
    if (nestedHit) return nestedHit;
  }

  return null;
}

const findings = [];

for (const file of trackedFiles) {
  if (!fs.existsSync(file)) continue;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 2_000_000) continue;

  if (riskyPathPattern.test(file)) {
    findings.push({ file, reason: "tracked path looks like it may contain secrets" });
  }

  const content = fs.readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const envMatch = line.match(envSecretPattern);
    if (envMatch) {
      const value = envMatch[1];
      if (!/^(changeme|example|placeholder|your_|<)/i.test(value)) {
        findings.push({
          file,
          line: index + 1,
          reason: "tracked environment-style secret assignment",
        });
      }
    }

    if (labelledBase58SecretPattern.test(line)) {
      findings.push({
        file,
        line: index + 1,
        reason: "tracked labelled base58 private/secret key",
      });
    }
  });

  if (file.endsWith(".json")) {
    try {
      const parsed = JSON.parse(content);
      const keyPath = hasKeyShapedJson(parsed);
      if (keyPath) {
        findings.push({
          file,
          reason: `tracked JSON contains key-shaped secret material at ${keyPath}`,
        });
      }
    } catch {
      // Non-JSON content in a .json path is handled by the text checks above.
    }
  }
}

if (findings.length > 0) {
  console.error("Potential tracked secret material found:");
  for (const finding of findings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.error(`- ${location}: ${finding.reason}`);
  }
  process.exit(1);
}

console.log("No tracked secret material detected.");
