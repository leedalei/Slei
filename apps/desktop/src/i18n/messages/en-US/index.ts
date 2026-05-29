import { agentCreate } from "./agentCreate";
import { chat } from "./chat";
import { common } from "./common";
import { computers } from "./computers";
import { diagnostics } from "./diagnostics";
import { empty } from "./empty";
import { members } from "./members";
import { onboarding } from "./onboarding";
import { search } from "./search";
import { settings } from "./settings";
import { shell } from "./shell";
import { status } from "./status";
import { tasks } from "./tasks";
import type { DesktopMessages } from "../../types";

export const enUSMessages = {
  agentCreate,
  chat,
  common,
  computers,
  diagnostics,
  empty,
  members,
  onboarding,
  search,
  settings,
  shell,
  status,
  tasks,
} satisfies DesktopMessages;
