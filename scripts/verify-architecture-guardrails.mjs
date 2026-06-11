import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PRODUCTION_ROOTS = [
  "apps/desktop/src",
  "apps/desktop/src-tauri/src",
  "crates/slei-daemon/src",
];

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".rs",
  ".ts",
  ".tsx",
]);

const WRITER_PATTERN = /\b(?:fs::write|tokio::fs::write|writeFile|writeFileSync|fs\.writeFile|fs\.writeFileSync)\b/;
const WRITER_CALL_PATTERN = new RegExp(WRITER_PATTERN.source, "g");
const MUTABLE_PRODUCT_STATE_DIRS = new Set([
  "agents",
  "attachments",
  "cards",
  "channel-members",
  "channels",
  "conversations",
  "idempotency",
  "nodes",
  "runtime",
  "saved",
  "settings",
  "tasks",
]);
const TEST_MOCK_WORKSPACE_PATTERN = /\btestMockAgentWorkspace[A-Za-z0-9_]*\b/;
const DAEMON_BRIDGE_MOCK_PATTERN = /\bcreateDaemonBridgeMock\s*\(/;
const DAEMON_BRIDGE_MOCK_DEFINITION_PATTERN = /\b(?:export\s+)?function\s+createDaemonBridgeMock\s*\(/g;
const OLD_MOCK_WORKSPACE_PATTERN = /\bmockAgentWorkspace(?:Entries|FileContent)\b/g;
const PRODUCTION_FIXTURE_IMPORT_PATTERN = /["'`][^"'`]*(?:app\/fixtures|(?:\.\.\/)+test\/fixtures|(?:\.\/)?test\/fixtures|src\/test\/fixtures|apps\/desktop\/src\/test\/fixtures)[^"'`]*["'`]/g;
const UI_AGENT_RUNNER_PATTERN = /\b(?:runTaskAgentReply|runChannelAgentReply|taskAgentReplyPrompt|channelAgentReplyPrompt|createChannelTaskPlaceholder|createChannelAgentActivityMessages)\b/g;

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

export function isIgnoredPath(filePath) {
  const normalized = normalizePath(filePath);
  return (
    normalized.endsWith("apps/desktop/src/test/fixtures.ts")
    || normalized.includes(".test.")
    || normalized.includes("/test/")
    || normalized.includes("/tests/")
    || normalized.includes("/e2e/")
  );
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function pushViolation(violations, filePath, line, message) {
  violations.push({ filePath: normalizePath(filePath), line, message });
}

function addRegexViolations(violations, filePath, content, pattern, message) {
  for (const match of content.matchAll(pattern)) {
    pushViolation(violations, filePath, lineNumberAt(content, match.index ?? 0), message);
  }
}

function maskRangePreservingLines(content, start, end) {
  return (
    content.slice(0, start)
    + content.slice(start, end).replace(/[^\n]/g, " ")
    + content.slice(end)
  );
}

function findBalancedBlock(content, openBraceIndex) {
  let depth = 0;
  for (let index = openBraceIndex; index < content.length; index += 1) {
    const character = content[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return content.length;
}

function findBalancedParenthesis(content, openParenthesisIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openParenthesisIndex; index < content.length; index += 1) {
    const character = content[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return content.length;
}

function splitTopLevelArguments(argumentsText) {
  const args = [];
  let depth = 0;
  let quote = null;
  let escaped = false;
  let start = 0;

  for (let index = 0; index < argumentsText.length; index += 1) {
    const character = argumentsText[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      args.push(argumentsText.slice(start, index).trim());
      start = index + 1;
    }
  }

  args.push(argumentsText.slice(start).trim());
  return args;
}

function extractStringLiterals(expression) {
  const literals = [];

  for (let index = 0; index < expression.length; index += 1) {
    const quote = expression[index];
    if (quote !== "\"" && quote !== "'" && quote !== "`") continue;

    let literal = "";
    let escaped = false;

    for (index += 1; index < expression.length; index += 1) {
      const character = expression[index];

      if (escaped) {
        literal += character;
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === quote) {
        break;
      }

      literal += character;
    }

    literals.push(literal);
  }

  return literals;
}

function pathSegmentsForLiteral(literal) {
  const normalized = literal.replaceAll("\\\\", "/").replaceAll("\\", "/");
  return normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".");
}

function isMutableProductJsonPathSegments(segments) {
  if (segments.length < 2) return false;
  if (!MUTABLE_PRODUCT_STATE_DIRS.has(segments[0])) return false;
  return segments.at(-1)?.endsWith(".json") ?? false;
}

function isMutableProductStateDirSegments(segments) {
  if (segments.length < 1) return false;
  if (!MUTABLE_PRODUCT_STATE_DIRS.has(segments[0])) return false;
  return !(segments.at(-1)?.endsWith(".json") ?? false);
}

function expressionHasMutableProductJsonPath(expression) {
  const literals = extractStringLiterals(expression);
  if (literals.length === 0) return false;

  const joinedLiteralSegments = [];

  for (const literal of literals) {
    const segments = pathSegmentsForLiteral(literal);

    if (isMutableProductJsonPathSegments(segments)) {
      return true;
    }

    joinedLiteralSegments.push(...segments);
  }

  return isMutableProductJsonPathSegments(joinedLiteralSegments);
}

function expressionHasMutableProductStateDir(expression) {
  const literals = extractStringLiterals(expression);
  if (literals.length === 0) return false;

  const joinedLiteralSegments = [];

  for (const literal of literals) {
    const segments = pathSegmentsForLiteral(literal);

    if (isMutableProductStateDirSegments(segments)) {
      return true;
    }

    joinedLiteralSegments.push(...segments);
  }

  return isMutableProductStateDirSegments(joinedLiteralSegments);
}

function expressionHasJsonFilename(expression) {
  return extractStringLiterals(expression).some((literal) => (
    pathSegmentsForLiteral(literal).some((segment) => segment.endsWith(".json"))
  ));
}

function expressionReferencesAnyVariable(expression, variables) {
  return [...variables].some((variableName) => (
    new RegExp(`\\b${variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(expression)
  ));
}

function collectMutableJsonPathVariables(content) {
  const mutableStateDirVariables = new Set();
  const mutableJsonPathVariables = new Set();
  const bindingPattern = /\b(?:let|const|var)\s+(?:mut\s+)?([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*([^;]+);/g;

  let changed = true;
  while (changed) {
    changed = false;

    for (const match of content.matchAll(bindingPattern)) {
      const variableName = match[1];
      const expression = match[2];
      const referencesMutableStateDir = expressionReferencesAnyVariable(expression, mutableStateDirVariables);
      const referencesMutableJsonPath = expressionReferencesAnyVariable(expression, mutableJsonPathVariables);
      const hasJsonFilename = expressionHasJsonFilename(expression);

      if (
        !mutableJsonPathVariables.has(variableName)
        && (
          expressionHasMutableProductJsonPath(expression)
          || referencesMutableJsonPath
          || (referencesMutableStateDir && hasJsonFilename)
        )
      ) {
        mutableJsonPathVariables.add(variableName);
        changed = true;
      }

      if (
        !mutableStateDirVariables.has(variableName)
        && (
          expressionHasMutableProductStateDir(expression)
          || (referencesMutableStateDir && !hasJsonFilename)
        )
      ) {
        mutableStateDirVariables.add(variableName);
        changed = true;
      }
    }
  }

  return mutableJsonPathVariables;
}

function writerCallPathArgument(content, matchIndex, matchText) {
  const openParenthesisIndex = content.indexOf("(", matchIndex + matchText.length);
  if (openParenthesisIndex === -1) return null;

  const closeParenthesisIndex = findBalancedParenthesis(content, openParenthesisIndex);
  const callArguments = content.slice(openParenthesisIndex + 1, closeParenthesisIndex - 1);
  return splitTopLevelArguments(callArguments)[0] ?? null;
}

function isTaintedVariablePathArgument(pathArgument, taintedVariables) {
  const normalized = pathArgument
    .trim()
    .replace(/^&+/, "")
    .replace(/^\*+/, "")
    .trim();

  return taintedVariables.has(normalized);
}

function maskRustCfgTestBlocks(content) {
  let masked = content;
  const cfgPattern = /#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/g;
  const ranges = [];

  for (const match of content.matchAll(cfgPattern)) {
    const openBraceIndex = content.indexOf("{", (match.index ?? 0) + match[0].length);
    if (openBraceIndex === -1) continue;
    ranges.push([match.index ?? 0, findBalancedBlock(content, openBraceIndex)]);
  }

  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) {
    masked = maskRangePreservingLines(masked, start, end);
  }

  return masked;
}

function extractFunctionBody(content, functionName) {
  const functionPattern = new RegExp(`(?:export\\s+)?function\\s+${functionName}\\s*\\(`, "g");
  const match = functionPattern.exec(content);
  if (!match) return null;

  const openBraceIndex = content.indexOf("{", match.index + match[0].length);
  if (openBraceIndex === -1) return null;
  const end = findBalancedBlock(content, openBraceIndex);
  return {
    body: content.slice(openBraceIndex, end),
    startLine: lineNumberAt(content, openBraceIndex),
  };
}

function hasLegacyStateReference(body) {
  return expressionHasMutableProductJsonPath(body);
}

function isDocumentedNoopPersistHelper(body) {
  return (
    /\bOk\s*\(\s*\(\s*\)\s*\)/.test(body)
    && !WRITER_PATTERN.test(body)
    && !hasLegacyStateReference(body)
  );
}

function addLegacyWriteViolations(violations, filePath, content) {
  const reported = new Set();
  const taintedVariables = collectMutableJsonPathVariables(content);

  for (const match of content.matchAll(WRITER_CALL_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const pathArgument = writerCallPathArgument(content, matchIndex, match[0]);
    if (!pathArgument) continue;
    if (!expressionHasMutableProductJsonPath(pathArgument) && !isTaintedVariablePathArgument(pathArgument, taintedVariables)) {
      continue;
    }

    const line = lineNumberAt(content, matchIndex);
    const key = `${filePath}:${line}`;
    if (reported.has(key)) continue;
    reported.add(key);
    pushViolation(
      violations,
      filePath,
      line,
      "production legacy JSON state write is forbidden; route mutable product state through SQLite/daemon repositories",
    );
  }
}

function addPersistHelperViolations(violations, filePath, content) {
  const helperPattern = /\bfn\s+persist_local_agents_at_root\s*\(/g;
  for (const match of content.matchAll(helperPattern)) {
    const openBraceIndex = content.indexOf("{", (match.index ?? 0) + match[0].length);
    if (openBraceIndex === -1) {
      pushViolation(violations, filePath, lineNumberAt(content, match.index ?? 0), "legacy persist helper declaration is forbidden");
      continue;
    }
    const body = content.slice(openBraceIndex, findBalancedBlock(content, openBraceIndex));
    if (!isDocumentedNoopPersistHelper(body)) {
      pushViolation(
        violations,
        filePath,
        lineNumberAt(content, match.index ?? 0),
        "legacy persist helper must remain a documented no-op or be removed",
      );
    }
  }
}

function addOfflineBridgeMockViolations(violations, filePath, content) {
  for (const functionName of ["createOfflineDaemonBridge", "createDaemonBridge"]) {
    const section = extractFunctionBody(content, functionName);
    if (!section) continue;

    for (const [pattern, message] of [
      [TEST_MOCK_WORKSPACE_PATTERN, `${functionName} production path must not call test mock workspace helpers`],
      [DAEMON_BRIDGE_MOCK_PATTERN, `${functionName} production path must not call createDaemonBridgeMock`],
    ]) {
      const match = pattern.exec(section.body);
      if (!match) continue;

      pushViolation(
        violations,
        filePath,
        section.startLine + lineNumberAt(section.body, match.index) - 1,
        message,
      );
    }
  }
}

export function analyzeFile({ filePath, content }) {
  if (isIgnoredPath(filePath)) return [];

  const violations = [];
  const contentForRules = filePath.endsWith(".rs") ? maskRustCfgTestBlocks(content) : content;

  addRegexViolations(
    violations,
    filePath,
    contentForRules,
    /\bcreateSleiFixtures\s*\(/g,
    "production code must not call createSleiFixtures",
  );
  addRegexViolations(
    violations,
    filePath,
    contentForRules,
    /\bcreateDemoMembers\s*\(/g,
    "production code must not call createDemoMembers",
  );
  addRegexViolations(
    violations,
    filePath,
    contentForRules,
    PRODUCTION_FIXTURE_IMPORT_PATTERN,
    "production code must not import app/fixtures or test/fixtures, including type-only imports",
  );
  addRegexViolations(
    violations,
    filePath,
    contentForRules,
    OLD_MOCK_WORKSPACE_PATTERN,
    "production code must not reference legacy mockAgentWorkspace workspace helpers",
  );
  addRegexViolations(
    violations,
    filePath,
    contentForRules,
    DAEMON_BRIDGE_MOCK_DEFINITION_PATTERN,
    "production code must not define createDaemonBridgeMock; put daemon mocks under test-only paths",
  );
  addRegexViolations(
    violations,
    filePath,
    contentForRules,
    UI_AGENT_RUNNER_PATTERN,
    "production UI must not run agent/task orchestration locally; delegate execution to daemon and render daemon data",
  );

  addOfflineBridgeMockViolations(violations, filePath, contentForRules);
  addLegacyWriteViolations(violations, filePath, contentForRules);
  addPersistHelperViolations(violations, filePath, contentForRules);

  return violations;
}

async function collectSourceFiles(rootPath) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    const normalized = normalizePath(entryPath);
    if (entry.isDirectory()) {
      if (isIgnoredPath(`${normalized}/`)) continue;
      files.push(...await collectSourceFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push(entryPath);
  }

  return files;
}

export async function verifyArchitectureGuardrails({ cwd = process.cwd(), roots = PRODUCTION_ROOTS } = {}) {
  const violations = [];

  for (const root of roots) {
    const rootPath = path.join(cwd, root);
    const files = await collectSourceFiles(rootPath);

    for (const absolutePath of files) {
      const relativePath = normalizePath(path.relative(cwd, absolutePath));
      const content = await fs.readFile(absolutePath, "utf8");
      violations.push(...analyzeFile({ filePath: relativePath, content }));
    }
  }

  return violations.sort((left, right) => (
    left.filePath.localeCompare(right.filePath)
    || left.line - right.line
    || left.message.localeCompare(right.message)
  ));
}

async function main() {
  const violations = await verifyArchitectureGuardrails();

  if (violations.length > 0) {
    console.error("Architecture guardrail violations:");
    for (const violation of violations) {
      console.error(`- ${violation.filePath}:${violation.line}: ${violation.message}`);
    }
    process.exit(1);
  }

  console.log("Architecture guardrails passed.");
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
