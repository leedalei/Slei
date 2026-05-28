export type ChatMessage = {
  sender: string;
  body: string;
  streaming: boolean;
  toolCalls: ToolCall[];
};

export type ToolCall = {
  name: string;
  status: "collapsed" | "expanded";
};
