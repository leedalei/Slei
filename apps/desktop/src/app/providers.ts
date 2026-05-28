export type AppProviders = {
  locale: "zh-CN" | "en-US";
};

export function createDefaultProviders(): AppProviders {
  return { locale: "zh-CN" };
}
