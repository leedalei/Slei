import enUSJson from "./locales/en-US.json";
import zhCNJson from "./locales/zh-CN.json";

export type Locale = "zh-CN" | "en-US";
export interface LocaleTree {
  [key: string]: string | LocaleTree;
}

export const defaultLocale: Locale = "zh-CN";
export const zhCN = zhCNJson as LocaleTree;
export const enUS = enUSJson as LocaleTree;

export function flattenKeys(tree: LocaleTree, prefix = ""): string[] {
  return Object.keys(tree)
    .flatMap((key) => {
      const value = tree[key];
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") {
        return [nextPrefix];
      }
      return flattenKeys(value, nextPrefix);
    })
    .sort();
}

export const resources = {
  "zh-CN": zhCN,
  "en-US": enUS,
} as const;
