export const agentCreate = {
  addAgent: "添加智能体 运行时 模型",
  associatedDevice: "关联设备",
  defaultDescription: (name: string) => `${name} 的智能体记忆和工作区。`,
  description: "描述",
  draftDescription: {
    qa: "QA 质保员，负责审查代码质量、安全漏洞，提出改进意见。",
    architect: "研发团队架构师，负责技术方案、任务拆解和设计评审。",
    developer: "研发团队开发工程师，负责基于任务分解进行实际编码工作。",
  },
  draftRole: {
    qa: "QA 质保员",
    architect: "研发团队架构师",
    developer: "研发团队开发工程师",
  },
  fallbackAgent: "智能体",
  handle: "@handle",
  model: "Model",
  name: "名字",
  title: "创建智能体",
};
