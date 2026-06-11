export const agentCreate = {
  addAgent: "Add agent Runtime Model",
  associatedDevice: "Associated device",
  createdFailed: "Member creation failed",
  createdSuccess: "Member created",
  defaultDescription: (name: string) => `${name}'s agent memory and workspace.`,
  description: "Description",
  draftDescription: {
    qa: "QA agent responsible for reviewing code quality, security issues, and improvement suggestions.",
    architect: "Engineering architect responsible for technical plans, task breakdowns, and design reviews.",
    developer: "Engineering agent responsible for implementation work based on task breakdowns.",
  },
  draftRole: {
    qa: "QA agent",
    architect: "Engineering architect",
    developer: "Engineering developer",
  },
  fallbackAgent: "Agent",
  handle: "@handle",
  model: "Model",
  name: "Name",
  title: "Create Agent",
};
