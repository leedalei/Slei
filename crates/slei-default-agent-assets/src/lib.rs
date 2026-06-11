use serde::Deserialize;
use std::sync::OnceLock;

const MEMORY_TEMPLATE: &str =
    include_str!("../../../resources/default-agent-assets/MEMORY.md.template");
const MEMORY_SKILL_TEMPLATE: &str =
    include_str!("../../../resources/default-agent-assets/skills/memory/SKILL.md.template");
const GUIDE_CREATE_SKILL: &str =
    include_str!("../../../resources/default-agent-assets/skills/guide-create/SKILL.md");
const KEY_KNOWLEDGE_JSON: &str =
    include_str!("../../../resources/default-agent-assets/key-knowledge.json");
const SKILLS_JSON: &str = include_str!("../../../resources/default-agent-assets/skills.json");

pub struct AgentTemplateInput<'a> {
    pub name: &'a str,
    pub handle: &'a str,
    pub description: &'a str,
    pub agent_kind: Option<&'a str>,
    pub channel_ids: Vec<&'a str>,
}

pub struct StandardSkillAsset {
    pub id: &'static str,
    pub name: &'static str,
    pub trigger: String,
    pub relative_path: &'static str,
    pub body: String,
}

#[derive(Deserialize)]
struct KeyKnowledge {
    guide: String,
    coordinator: String,
    agent: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillDefinition {
    id: String,
    name: String,
    relative_path: String,
    trigger: Option<String>,
    trigger_template: Option<String>,
    agent_kinds: Vec<String>,
}

pub fn initial_memory(input: &AgentTemplateInput<'_>) -> String {
    render_template(
        MEMORY_TEMPLATE,
        &[
            ("name", input.name),
            ("description", input.description),
            ("handle", input.handle),
            ("key_knowledge", &render_key_knowledge(input)),
        ],
    )
}

pub fn memory_skill(input: &AgentTemplateInput<'_>) -> String {
    render_template(MEMORY_SKILL_TEMPLATE, &[("handle", input.handle)])
}

pub fn guide_create_skill() -> &'static str {
    GUIDE_CREATE_SKILL
}

pub fn standard_skill_assets(input: &AgentTemplateInput<'_>) -> Vec<StandardSkillAsset> {
    let mut assets = skill_definitions()
        .iter()
        .filter(|definition| definition.matches_agent_kind(input.agent_kind))
        .map(|definition| StandardSkillAsset {
            id: definition.id.as_str(),
            name: definition.name.as_str(),
            trigger: definition.render_trigger(input),
            relative_path: definition.relative_path.as_str(),
            body: if definition.id == "guide-create" {
                guide_create_skill().to_string()
            } else {
                memory_skill(input)
            },
        })
        .collect::<Vec<_>>();
    assets.sort_by(|left, right| left.id.cmp(right.id));
    assets
}

pub fn base_key_knowledge(agent_kind: Option<&str>) -> &'static str {
    let key_knowledge = key_knowledge();
    match agent_kind {
        Some("guide") => &key_knowledge.guide,
        Some("coordinator") => &key_knowledge.coordinator,
        _ => &key_knowledge.agent,
    }
}

fn render_key_knowledge(input: &AgentTemplateInput<'_>) -> String {
    let mut key_knowledge = base_key_knowledge(input.agent_kind).to_string();
    let mut channel_ids = input.channel_ids.clone();
    channel_ids.sort_unstable();
    channel_ids.dedup();
    if !channel_ids.is_empty() {
        let joined_channels = channel_ids
            .iter()
            .map(|channel_id| format!("#{channel_id}"))
            .collect::<Vec<_>>()
            .join("、");
        key_knowledge.push_str("\n已加入频道：");
        key_knowledge.push_str(&joined_channels);
    }
    key_knowledge
}

fn render_template(template: &str, replacements: &[(&str, &str)]) -> String {
    let mut rendered = template.to_string();
    for (key, value) in replacements {
        rendered = rendered.replace(&format!("{{{{{key}}}}}"), value);
    }
    rendered
}

fn key_knowledge() -> &'static KeyKnowledge {
    static KEY_KNOWLEDGE: OnceLock<KeyKnowledge> = OnceLock::new();
    KEY_KNOWLEDGE.get_or_init(|| {
        serde_json::from_str(KEY_KNOWLEDGE_JSON)
            .expect("default-agent key-knowledge.json must be valid")
    })
}

fn skill_definitions() -> &'static [SkillDefinition] {
    static SKILL_DEFINITIONS: OnceLock<Vec<SkillDefinition>> = OnceLock::new();
    SKILL_DEFINITIONS.get_or_init(|| {
        serde_json::from_str(SKILLS_JSON).expect("default-agent skills.json must be valid")
    })
}

impl SkillDefinition {
    fn matches_agent_kind(&self, agent_kind: Option<&str>) -> bool {
        let kind = agent_kind.unwrap_or("agent");
        self.agent_kinds
            .iter()
            .any(|candidate| candidate == kind || (kind != "guide" && candidate == "agent"))
    }

    fn render_trigger(&self, input: &AgentTemplateInput<'_>) -> String {
        if let Some(trigger) = &self.trigger {
            return trigger.clone();
        }
        render_template(
            self.trigger_template.as_deref().unwrap_or_default(),
            &[("handle", input.handle)],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guide_input() -> AgentTemplateInput<'static> {
        AgentTemplateInput {
            name: "Yeal",
            handle: "@yeal",
            description: "Slei guide",
            agent_kind: Some("guide"),
            channel_ids: vec!["zeta", "all"],
        }
    }

    #[test]
    fn guide_memory_includes_product_card_guidance_and_sorted_channels() {
        let memory = initial_memory(&guide_input());

        assert!(memory.contains("# Yeal"));
        assert!(memory.contains("创建成员时通过 guide-create Skill 生成产品交互卡"));
        assert!(memory.contains("已加入频道：#all、#zeta"));
        assert!(memory.contains("## Active Context"));
    }

    #[test]
    fn coordinator_memory_says_it_routes_but_does_not_answer() {
        let memory = initial_memory(&AgentTemplateInput {
            name: "Coordinator",
            handle: "@coordinator",
            description: "Routes channel messages",
            agent_kind: Some("coordinator"),
            channel_ids: vec![],
        });

        assert!(memory.contains("负责分析用户意图并路由 Agent"));
        assert!(memory.contains("自己不做任何关于用户问题的回复"));
    }

    #[test]
    fn ordinary_agent_memory_uses_generic_role_copy() {
        let memory = initial_memory(&AgentTemplateInput {
            name: "Coda",
            handle: "@coda",
            description: "Writes code",
            agent_kind: Some("agent"),
            channel_ids: vec![],
        });

        assert!(memory.contains("该 Agent 按 Role 中的职责与用户协作"));
        assert!(memory.contains("自发判断是否需要 @ 下一位成员接手"));
        assert!(memory.contains("如果无需接手，应 @ 当前用户进行验收或审阅"));
        assert!(memory.contains("只记录真实存在的成员和用户明确要求记住的信息"));
    }

    #[test]
    fn standard_skills_are_kind_aware() {
        let guide_skills = standard_skill_assets(&guide_input());
        assert_eq!(
            guide_skills
                .iter()
                .map(|skill| skill.id)
                .collect::<Vec<_>>(),
            vec!["guide-create", "memory"]
        );

        let agent_skills = standard_skill_assets(&AgentTemplateInput {
            name: "Coda",
            handle: "@coda",
            description: "Writes code",
            agent_kind: Some("agent"),
            channel_ids: vec![],
        });
        assert_eq!(agent_skills.len(), 1);
        assert_eq!(agent_skills[0].id, "memory");
    }

    #[test]
    fn guide_create_body_contains_current_card_requirements() {
        let body = guide_create_skill();

        assert!(body.contains("slei_propose_interactive_card"));
        assert!(body.contains("Multiple requested agents require multiple tool calls"));
        assert!(body.contains("assign a simple random unused English name"));
        assert!(body.contains("Do not use role-only labels such as"));
        assert!(body.contains("已准备创建卡片，请确认。"));
    }

    #[test]
    fn memory_skill_is_curated_and_section_aware() {
        let body = memory_skill(&guide_input());

        assert!(body.contains("curated working memory, not as a chat log"));
        assert!(body.contains("Key Knowledge"));
        assert!(body.contains("Active Context"));
        assert!(body.contains("replace or compact"));
        assert!(body.contains("Do not store secrets"));
        assert!(body.contains("notes/*.md"));
    }
}
