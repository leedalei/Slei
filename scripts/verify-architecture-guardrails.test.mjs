import assert from "node:assert/strict";
import test from "node:test";

import { analyzeFile } from "./verify-architecture-guardrails.mjs";

function messagesFor(filePath, content) {
  return analyzeFile({ filePath, content }).map((violation) => violation.message);
}

test("ignores test and fixture paths", () => {
  const fixtureContent = [
    "import { createSleiFixtures } from '../app/fixtures';",
    "createSleiFixtures();",
    "fs::write(root.join(\"agents/index.json\"), body);",
  ].join("\n");

  assert.deepEqual(messagesFor("apps/desktop/src/features/chat/ChatPageView.test.tsx", fixtureContent), []);
  assert.deepEqual(messagesFor("apps/desktop/src/test/fixtures.ts", fixtureContent), []);
});

test("flags production fixture and app fixture dependencies", () => {
  const messages = messagesFor(
    "apps/desktop/src/features/chat/ChatPageView.tsx",
    [
      "import type { SleiFixtures } from '@/app/fixtures';",
      "createSleiFixtures();",
      "createDemoMembers();",
    ].join("\n"),
  );

  assert(messages.some((message) => message.includes("app/fixtures")));
  assert(messages.some((message) => message.includes("createSleiFixtures")));
  assert(messages.some((message) => message.includes("createDemoMembers")));
});

test("flags production imports from test fixtures", () => {
  const messages = messagesFor(
    "apps/desktop/src/features/chat/ChatPageView.tsx",
    [
      "import type { ChatFixture } from '../../test/fixtures';",
      "export function ChatPageView() { return null; }",
    ].join("\n"),
  );

  assert(messages.some((message) => message.includes("test/fixtures")));
});

test("flags legacy JSON state writes but allows legacy import and reset reads", () => {
  assert.deepEqual(
    messagesFor(
      "crates/slei-daemon/src/services/member_service.rs",
      [
        "fn import_legacy(root: &Path) {",
        "  let raw = fs::read_to_string(root.join(\"agents/index.json\"));",
        "  let _ = reset_paths(root.join(\"settings/preferences.json\"));",
        "}",
      ].join("\n"),
    ),
    [],
  );

  const messages = messagesFor(
    "crates/slei-daemon/src/services/member_service.rs",
    [
      "fn save(root: &Path, body: &str) {",
      "  let index_path = root.join(\"agents/index.json\");",
      "  fs::write(index_path, body).unwrap();",
      "}",
    ].join("\n"),
  );

  assert(messages.some((message) => message.includes("legacy JSON state write")));
});

test("flags production JSON writes for mutable product state paths", () => {
  for (const statePath of [
    "tasks/index.json",
    "channel-members/index.json",
    "nodes/index.json",
    "idempotency/index.json",
    "runtime/metadata.json",
  ]) {
    const messages = messagesFor(
      "crates/slei-daemon/src/services/task_service.rs",
      [
        "fn save(root: &Path, body: &str) {",
        `  fs::write(root.join("${statePath}"), body).unwrap();`,
        "}",
      ].join("\n"),
    );

    assert(
      messages.some((message) => message.includes("legacy JSON state write")),
      `expected ${statePath} write to be blocked`,
    );
  }
});

test("flags distant variable writes to production JSON state paths", () => {
  const rustMessages = messagesFor(
    "crates/slei-daemon/src/services/task_service.rs",
    [
      "fn save(root: &Path, body: &str) {",
      "  let index_path = root.join(\"tasks/index.json\");",
      ...Array.from({ length: 12 }, (_, index) => `  let value_${index} = ${index};`),
      "  fs::write(index_path, body).unwrap();",
      "}",
    ].join("\n"),
  );

  assert(rustMessages.some((message) => message.includes("legacy JSON state write")));

  const tsMessages = messagesFor(
    "apps/desktop/src/lib/persistence.ts",
    [
      "function save(root: string, body: string) {",
      "  const indexPath = join(root, \"channel-members/index.json\");",
      ...Array.from({ length: 12 }, (_, index) => `  const value${index} = ${index};`),
      "  writeFile(indexPath, body);",
      "}",
    ].join("\n"),
  );

  assert(tsMessages.some((message) => message.includes("legacy JSON state write")));
});

test("flags JSON writes built from mutable state directories and JSON filenames", () => {
  const rustMessages = messagesFor(
    "crates/slei-daemon/src/services/agent_service.rs",
    [
      "fn save(root: &Path, body: &str) {",
      "  let agents_dir = root.join(\"agents\");",
      "  let index_path = agents_dir.join(\"index.json\");",
      "  fs::write(index_path, body).unwrap();",
      "}",
    ].join("\n"),
  );

  assert(rustMessages.some((message) => message.includes("legacy JSON state write")));

  const tsMessages = messagesFor(
    "apps/desktop/src/lib/persistence.ts",
    [
      "function save(root: string, body: string) {",
      "  const agentsDir = join(root, \"agents\");",
      "  const indexPath = join(agentsDir, fileNameFor(\"index.json\"));",
      "  writeFile(indexPath, body);",
      "}",
    ].join("\n"),
  );

  assert(tsMessages.some((message) => message.includes("legacy JSON state write")));
});

test("allows legitimate JSON assets, protocol contracts, and legacy read cleanup paths", () => {
  assert.deepEqual(
    messagesFor(
      "crates/slei-daemon/src/services/import_service.rs",
      [
        "fn import_legacy(root: &Path) {",
        "  let tasks = fs::read_to_string(root.join(\"tasks/index.json\"));",
        "  let members = fs::read_to_string(root.join(\"channel-members/index.json\"));",
        "  let _ = fs::remove_file(root.join(\"runtime/metadata.json\"));",
        "}",
      ].join("\n"),
    ),
    [],
  );

  assert.deepEqual(
    messagesFor(
      "crates/slei-daemon/src/resources.rs",
      [
        "fn load_assets(root: &Path, body: &str) {",
        "  let asset = fs::read_to_string(root.join(\"resources/default-agent-assets/assistant.json\"));",
        "  let locale = fs::read_to_string(root.join(\"i18n/zh-CN.json\"));",
        "  let contract = fs::read_to_string(root.join(\"protocol/contracts/daemon.json\"));",
        "}",
      ].join("\n"),
    ),
    [],
  );
});

test("allows testMock helpers only in test paths and not offline bridge", () => {
  assert.deepEqual(
    messagesFor(
      "apps/desktop/src/test/daemon-bridge-mock.ts",
      [
        "export function createDaemonBridgeMock() {",
        "  return { listAgentWorkspace: () => testMockAgentWorkspaceEntries() };",
        "}",
        "function testMockAgentWorkspaceEntries() { return []; }",
      ].join("\n"),
    ),
    [],
  );

  const productionMessages = messagesFor(
    "apps/desktop/src/lib/daemon-bridge.ts",
    [
      "export function createDaemonBridgeMock() {",
      "  return { listAgentWorkspace: () => testMockAgentWorkspaceEntries() };",
      "}",
      "function testMockAgentWorkspaceEntries() { return []; }",
    ].join("\n"),
  );
  assert(productionMessages.some((message) => message.includes("define createDaemonBridgeMock")));

  const messages = messagesFor(
    "apps/desktop/src/lib/daemon-bridge.ts",
    [
      "export function createOfflineDaemonBridge() {",
      "  return { listAgentWorkspace: () => testMockAgentWorkspaceEntries() };",
      "}",
      "function testMockAgentWorkspaceEntries() { return []; }",
    ].join("\n"),
  );

  assert(messages.some((message) => message.includes("test mock workspace helper")));
});

test("flags production UI agent orchestration helpers", () => {
  const messages = messagesFor(
    "apps/desktop/src/app/SleiApp.tsx",
    [
      "function runTaskAgentReply() {}",
      "function createChannelTaskPlaceholder() {}",
    ].join("\n"),
  );

  assert(messages.some((message) => message.includes("delegate execution to daemon")));
});

test("flags legacy coordinator control plane symbols in production paths", () => {
  const messages = messagesFor(
    "crates/slei-daemon/src/state.rs",
    [
      "use crate::services::coordinator_service::CoordinatorService;",
      "const ID: &str = \"agent_global_coordinator\";",
      "let table = \"coordinator_runtime_runs\";",
    ].join("\n"),
  );

  assert(messages.some((message) => message.includes("legacy coordinator control plane")));
});

test("flags legacy coordinator action names in production UI helpers", () => {
  const messages = messagesFor(
    "apps/desktop/src/app/SleiApp.tsx",
    [
      "function createChannelAgentActivityMessages(outcome, channelId, members) {",
      "  if (outcome.action !== 'request_agent_reply') return [];",
      "  return [{ toolCall: 'coordinator_routing', channelId }];",
      "}",
    ].join("\n"),
  );

  assert(messages.some((message) => message.includes("legacy coordinator control plane")));
});

test("allows production UI daemon broadcast outcome activity rendering helpers", () => {
  assert.deepEqual(
    messagesFor(
      "apps/desktop/src/app/SleiApp.tsx",
      [
        "function createChannelAgentActivityMessages(outcome, channelId, members) {",
        "  if (outcome.action !== 'broadcast_delivered') return [];",
        "  return [{ toolCall: 'channel_agent_reply', channelId }];",
        "}",
      ].join("\n"),
    ),
    [],
  );
});

test("flags production bridge paths delegated to daemon bridge mock", () => {
  const createDaemonBridgeMessages = messagesFor(
    "apps/desktop/src/lib/daemon-bridge.ts",
    [
      "export function createDaemonBridge() {",
      "  return createDaemonBridgeMock({ reason: 'offline' });",
      "}",
      "export function createDaemonBridgeMock() { return {}; }",
    ].join("\n"),
  );

  assert(createDaemonBridgeMessages.some((message) => message.includes("createDaemonBridgeMock")));

  const createOfflineDaemonBridgeMessages = messagesFor(
    "apps/desktop/src/lib/daemon-bridge.ts",
    [
      "export function createOfflineDaemonBridge() {",
      "  return createDaemonBridgeMock();",
      "}",
      "export function createDaemonBridgeMock() { return {}; }",
    ].join("\n"),
  );

  assert(createOfflineDaemonBridgeMessages.some((message) => message.includes("createDaemonBridgeMock")));
});
