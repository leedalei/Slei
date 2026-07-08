use axum::http::HeaderMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthToken(String);

impl AuthToken {
    pub fn from_static(token: &'static str) -> Self {
        Self(token.to_string())
    }

    pub fn from_string(token: String) -> Self {
        Self(token)
    }

    pub fn authorization_header(&self) -> String {
        format!("Bearer {}", self.0)
    }

    pub fn is_authorized(&self, headers: &HeaderMap) -> bool {
        headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value == self.authorization_header())
    }
}
