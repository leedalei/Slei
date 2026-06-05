import { ChatPage } from "../../features/chat/ChatPageView";

export function ChatRoute(props: Parameters<typeof ChatPage>[0]) {
  return <ChatPage {...props} />;
}
