#![cfg_attr(test, allow(dead_code))]

use anyhow::{bail, Context, Result};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client, Method, Url};
use serde::de::DeserializeOwned;
use serde::Serialize;

const DEFAULT_DAEMON_URL: &str = "http://127.0.0.1:41273";

#[derive(Clone)]
pub struct DaemonClient {
    client: Client,
    base_url: Url,
    token: Option<String>,
}

impl DaemonClient {
    #[cfg(test)]
    pub fn for_base_url(base_url: &str) -> Result<Self> {
        let base_url =
            Url::parse(base_url).with_context(|| format!("invalid test daemon url: {base_url}"))?;
        Ok(Self {
            client: Client::new(),
            base_url,
            token: None,
        })
    }

    pub fn from_env() -> Result<Self> {
        let base_url =
            std::env::var("SLEI_DAEMON_URL").unwrap_or_else(|_| DEFAULT_DAEMON_URL.to_string());
        let base_url = Url::parse(&base_url)
            .with_context(|| format!("invalid SLEI_DAEMON_URL: {base_url}"))?;
        let token = std::env::var("SLEI_DAEMON_TOKEN")
            .ok()
            .map(|token| token.trim().to_string())
            .filter(|token| !token.is_empty());

        Ok(Self {
            client: Client::new(),
            base_url,
            token,
        })
    }

    pub async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.request_json::<(), T>(Method::GET, path, None, None)
            .await
    }

    pub async fn post_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        self.request_json(Method::POST, path, Some(body), None)
            .await
    }

    #[allow(dead_code)]
    pub async fn patch_json<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        self.request_json(Method::PATCH, path, Some(body), None)
            .await
    }

    pub async fn post_json_idempotent<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
        idempotency_key: &str,
    ) -> Result<T> {
        self.request_json(Method::POST, path, Some(body), Some(idempotency_key))
            .await
    }

    pub async fn patch_json_idempotent<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
        idempotency_key: &str,
    ) -> Result<T> {
        self.request_json(Method::PATCH, path, Some(body), Some(idempotency_key))
            .await
    }

    pub async fn delete_json_idempotent<T: DeserializeOwned>(
        &self,
        path: &str,
        idempotency_key: &str,
    ) -> Result<T> {
        self.request_json::<(), T>(Method::DELETE, path, None, Some(idempotency_key))
            .await
    }

    async fn request_json<B: Serialize, T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
        idempotency_key: Option<&str>,
    ) -> Result<T> {
        let url = self.url(path)?;
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(token) = &self.token {
            let value = HeaderValue::from_str(&format!("Bearer {token}"))
                .context("invalid SLEI_DAEMON_TOKEN header value")?;
            headers.insert(AUTHORIZATION, value);
        }
        if let Some(idempotency_key) = idempotency_key {
            headers.insert(
                "idempotency-key",
                HeaderValue::from_str(idempotency_key)
                    .context("invalid idempotency-key header value")?,
            );
        }

        let mut request = self.client.request(method, url).headers(headers);
        if let Some(body) = body {
            request = request.json(body);
        }

        let response = request
            .send()
            .await
            .context("failed to reach slei daemon")?;
        let status = response.status();
        let body = response
            .text()
            .await
            .context("failed to read daemon response body")?;

        if !status.is_success() {
            bail!("daemon returned {status}: {body}");
        }

        serde_json::from_str(&body).with_context(|| format!("daemon returned invalid JSON: {body}"))
    }

    fn url(&self, path: &str) -> Result<Url> {
        self.base_url
            .join(path.trim_start_matches('/'))
            .with_context(|| format!("invalid daemon path: {path}"))
    }
}
