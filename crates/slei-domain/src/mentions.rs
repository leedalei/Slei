use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MentionTarget {
    Human,
    Agent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mention {
    pub handle: String,
    pub target: MentionTarget,
}

pub fn parse_mentions<F>(input: &str, mut resolve: F) -> Vec<Mention>
where
    F: FnMut(&str) -> Option<MentionTarget>,
{
    let mut mentions = Vec::new();
    let mut chars = input.char_indices().peekable();

    while let Some((_, ch)) = chars.next() {
        if ch != '@' {
            continue;
        }

        let mut handle = String::new();
        while let Some((_, next)) = chars.peek().copied() {
            if next.is_ascii_alphanumeric() || next == '-' || next == '_' {
                handle.push(next);
                chars.next();
            } else {
                break;
            }
        }

        if handle.is_empty() {
            continue;
        }

        if let Some(target) = resolve(&handle) {
            mentions.push(Mention { handle, target });
        }
    }

    mentions
}
