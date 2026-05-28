import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const zh = JSON.parse(fs.readFileSync(path.join(root, "packages/i18n/src/locales/zh-CN.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.join(root, "packages/i18n/src/locales/en-US.json"), "utf8"));

function keys(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" && !Array.isArray(value) ? keys(value, next) : [next];
  });
}

const zhKeys = keys(zh).sort();
const enKeys = keys(en).sort();
const missingInEn = zhKeys.filter((key) => !enKeys.includes(key));
const missingInZh = enKeys.filter((key) => !zhKeys.includes(key));

if (missingInEn.length || missingInZh.length) {
  console.error(JSON.stringify({ missingInEn, missingInZh }, null, 2));
  process.exit(1);
}

console.log(`locale keys verified: ${zhKeys.length}`);
