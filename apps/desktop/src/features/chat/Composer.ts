export function renderComposer(input: { channelName: string; asTask: boolean }): string {
  return [
    `Message #${input.channelName}`,
    input.asTask ? "As Task checked" : "As Task",
  ].join(" ");
}
