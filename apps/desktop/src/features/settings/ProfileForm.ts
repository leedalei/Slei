export type ProfileState = {
  nickname: string;
  handle: string;
  bio?: string;
};

export function renderProfileForm(
  profile: ProfileState,
  locale: "zh-CN" | "en-US",
): string {
  const labels = {
    "zh-CN": {
      nickname: "昵称",
      handle: "用户名",
      bio: "基本信息",
    },
    "en-US": {
      nickname: "Nickname",
      handle: "Handle",
      bio: "Basic info",
    },
  }[locale];
  return [
    labels.nickname,
    profile.nickname,
    labels.handle,
    `@${profile.handle}`,
    labels.bio,
    profile.bio ?? "",
  ].join(" ");
}
