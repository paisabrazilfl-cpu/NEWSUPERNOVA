/**
 * Universal Agent Tool Catalog (BOS-AURA) — full taxonomy.
 *
 * Mirrors the agentic tool taxonomy (runtime, fs, git, web, browser, memory/RAG,
 * planning, sessions, automation, messaging, apis, devops, media, ui, catalog/mcp).
 *
 * Honesty rules (no fake success):
 *  - Tools with a real handler execute for real.
 *  - Tools needing creds/deps return `not_configured` until wired.
 *  - Shell / destructive / network / browser actions are permission-gated via
 *    ToolContext flags. A blocked tool says so; it never pretends.
 *  - Only tools that are actually AVAILABLE in the current context (real handler
 *    + gates satisfied) are exposed to the model (`openAiToolSpecs`), so the
 *    model can never call a tool that would just fail.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { exec as cpExec } from "node:child_process";
import { promisify } from "node:util";

const sh = promisify(cpExec);

export type Risk = "low" | "medium" | "high" | "destructive";

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  message?: string;
  error?: string | null;
}

export interface ToolDef {
  name: string;
  category: string;
  risk: Risk;
  description: string;
  inputSchema: Record<string, unknown>;
  enabledByDefault?: boolean;
  /** permission gates that must be satisfied for this tool to run / be exposed */
  needsShell?: boolean;
  needsNetwork?: boolean;
  needsBrowser?: boolean;
  needsDestructive?: boolean;
  needsEmail?: boolean;
  needsMessages?: boolean;
  needsDeploy?: boolean;
  /** env vars that must be present for this tool to be available */
  needsEnv?: string[];
  sourceFamily?: string;
}

export interface ToolContext {
  workspace: string;
  allowNetwork: boolean;
  allowShell: boolean;
  allowDestructive: boolean;
  allowBrowser: boolean;
  allowEmail: boolean;
  allowMessages: boolean;
  allowDeploy: boolean;
  env: Record<string, string>;
  memory: Record<string, unknown>;
  audit: Array<Record<string, unknown>>;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult> | ToolResult;

// ── schema helpers ───────────────────────────────────────────────────────────
function obj(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}
const S = (description: string, def?: string) => (def === undefined ? { type: "string", description } : { type: "string", description, default: def });
const I = (description: string, def?: number) => (def === undefined ? { type: "integer", description } : { type: "integer", description, default: def });
const B = (description: string, def?: boolean) => (def === undefined ? { type: "boolean", description } : { type: "boolean", description, default: def });
const A = (description: string, items: Record<string, unknown>) => ({ type: "array", description, items });

function ok(data?: unknown, message = "ok"): ToolResult { return { ok: true, data, message, error: null }; }
function fail(error: string, message: string, data?: unknown): ToolResult { return { ok: false, error, message, data }; }

function d(name: string, category: string, risk: Risk, description: string, inputSchema: Record<string, unknown>, opts: Partial<ToolDef> = {}): ToolDef {
  return { name, category, risk, description, inputSchema, enabledByDefault: false, sourceFamily: "taxonomy", ...opts };
}

// ── catalog (full taxonomy) ──────────────────────────────────────────────────
export const TOOL_DEFS: ToolDef[] = [
  // 1. runtime / execution (shell-gated)
  d("exec", "runtime", "high", "Run a shell command in the workspace.", obj({ command: S("Command."), timeout_sec: I("Timeout.", 60) }, ["command"]), { needsShell: true }),
  d("bash", "runtime", "high", "Alias for exec.", obj({ command: S("Command."), timeout_sec: I("Timeout.", 60) }, ["command"]), { needsShell: true }),
  d("execute_shell", "runtime", "high", "Run a shell command.", obj({ command: S("Command."), timeout_sec: I("Timeout.", 60) }, ["command"]), { needsShell: true }),
  d("subprocess", "runtime", "high", "Run a subprocess command.", obj({ command: S("Command."), timeout_sec: I("Timeout.", 60) }, ["command"]), { needsShell: true }),
  d("code_execution", "runtime", "high", "Execute code (python/node/bash) in the workspace.", obj({ language: { type: "string", enum: ["python", "javascript", "bash"] }, code: S("Code."), timeout_sec: I("Timeout.", 60) }, ["language", "code"]), { needsShell: true }),
  d("execute_python_code", "runtime", "high", "Execute Python code.", obj({ code: S("Python code."), timeout_sec: I("Timeout.", 60) }, ["code"]), { needsShell: true }),
  d("execute_python_file", "runtime", "high", "Execute a Python file.", obj({ path: S("Path."), timeout_sec: I("Timeout.", 120) }, ["path"]), { needsShell: true }),
  d("process", "runtime", "high", "Declared: long-running process control.", obj({ action: S("start/status/kill") }, ["action"]), {}),
  d("terminal_session", "runtime", "high", "Declared: interactive terminal session.", obj({ action: S("Action.") }, ["action"]), {}),
  d("sandbox_run", "runtime", "high", "Run a command in an ephemeral temp dir.", obj({ command: S("Command."), timeout_sec: I("Timeout.", 60) }, ["command"]), { needsShell: true }),
  d("container_exec", "runtime", "high", "Declared: docker container exec.", obj({ image: S("Image."), command: S("Command.") }, ["image", "command"]), { needsShell: true }),

  // 2. filesystem (real, sandboxed)
  d("read_file", "fs", "low", "Read a workspace file.", obj({ path: S("Path."), max_chars: I("Max chars.") }, ["path"]), { enabledByDefault: true }),
  d("write_file", "fs", "medium", "Write a workspace file.", obj({ path: S("Path."), content: S("Content."), overwrite: B("Overwrite.", true) }, ["path", "content"]), { enabledByDefault: true }),
  d("edit_file", "fs", "medium", "Replace exact text in a file.", obj({ path: S("Path."), old_text: S("Old."), new_text: S("New.") }, ["path", "old_text", "new_text"]), { enabledByDefault: true }),
  d("apply_patch", "fs", "medium", "Apply a unified diff (git apply).", obj({ patch: S("Patch.") }, ["patch"]), { needsShell: true }),
  d("list_directory", "fs", "low", "List a workspace folder.", obj({ path: S("Path.", "."), recursive: B("Recursive.", false) }), { enabledByDefault: true }),
  d("search_files", "fs", "low", "Find files by substring.", obj({ pattern: S("Substring."), path: S("Root.", ".") }, ["pattern"]), { enabledByDefault: true }),
  d("grep_files", "fs", "low", "Search file contents by regex.", obj({ pattern: S("Regex."), path: S("Root.", "."), max_matches: I("Max.", 80) }, ["pattern"]), { enabledByDefault: true }),
  d("file_exists", "fs", "low", "Check path existence.", obj({ path: S("Path.") }, ["path"]), { enabledByDefault: true }),
  d("make_directory", "fs", "medium", "Create a directory.", obj({ path: S("Path.") }, ["path"]), { enabledByDefault: true }),
  d("delete_path", "fs", "destructive", "Delete a file/dir.", obj({ path: S("Path."), recursive: B("Recursive.", false) }, ["path"]), { needsDestructive: true }),
  d("diff_render", "fs", "low", "Render a unified diff of two strings.", obj({ before: S("Before."), after: S("After.") }, ["before", "after"]), { enabledByDefault: true }),
  d("open_file", "fs", "low", "Read a file into agent context memory.", obj({ path: S("Path."), key: S("Context key.") }, ["path"]), { enabledByDefault: true }),
  d("open_folder", "fs", "low", "Read a folder listing into context memory.", obj({ path: S("Path.", "."), key: S("Context key.") }), { enabledByDefault: true }),
  d("close_context_item", "fs", "low", "Remove a context memory item.", obj({ key: S("Key.") }, ["key"]), { enabledByDefault: true }),

  // 3. git / repo (shell-gated, + GitHub API)
  d("git_status", "git", "low", "git status.", obj({ path: S("Repo.", ".") }), { needsShell: true }),
  d("git_diff", "git", "low", "git diff.", obj({ path: S("Repo.", "."), staged: B("Staged.", false) }), { needsShell: true }),
  d("git_branch", "git", "low", "git branch.", obj({ path: S("Repo.", "."), all: B("All.", false) }), { needsShell: true }),
  d("git_checkout", "git", "medium", "git checkout.", obj({ branch: S("Branch."), path: S("Repo.", "."), create: B("Create.", false) }, ["branch"]), { needsShell: true }),
  d("git_commit", "git", "medium", "git add -A && commit.", obj({ message: S("Message."), path: S("Repo.", ".") }, ["message"]), { needsShell: true }),
  d("git_push", "git", "high", "git push.", obj({ path: S("Repo.", "."), remote: S("Remote.", "origin"), branch: S("Branch.") }), { needsShell: true }),
  d("git_pull", "git", "medium", "git pull.", obj({ path: S("Repo.", "."), remote: S("Remote.", "origin"), branch: S("Branch.") }), { needsShell: true }),
  d("git_clone", "git", "medium", "git clone.", obj({ url: S("URL."), directory: S("Dir.") }, ["url"]), { needsShell: true }),
  d("clone_repository", "git", "medium", "Alias for git_clone.", obj({ url: S("URL."), directory: S("Dir.") }, ["url"]), { needsShell: true }),
  d("run_precommit", "git", "medium", "Run pre-commit hooks.", obj({ path: S("Repo.", ".") }), { needsShell: true }),
  d("create_pull_request", "git", "high", "Create a GitHub PR.", obj({ repo: S("owner/repo."), title: S("Title."), body: S("Body."), head: S("Head."), base: S("Base.", "main") }, ["repo", "title", "head"]), { needsNetwork: true, needsEnv: ["GITHUB_TOKEN"] }),
  d("create_issue", "git", "medium", "Create a GitHub issue.", obj({ repo: S("owner/repo."), title: S("Title."), body: S("Body.") }, ["repo", "title"]), { needsNetwork: true, needsEnv: ["GITHUB_TOKEN"] }),
  d("comment_issue", "git", "medium", "Comment on a GitHub issue/PR.", obj({ repo: S("owner/repo."), issue_number: I("Number."), body: S("Body.") }, ["repo", "issue_number", "body"]), { needsNetwork: true, needsEnv: ["GITHUB_TOKEN"] }),
  d("read_issue", "git", "low", "Read a GitHub issue.", obj({ repo: S("owner/repo."), issue_number: I("Number.") }, ["repo", "issue_number"]), { needsNetwork: true }),
  d("read_pr", "git", "low", "Read a GitHub PR.", obj({ repo: S("owner/repo."), pull_number: I("Number.") }, ["repo", "pull_number"]), { needsNetwork: true }),
  d("inspect_ci", "git", "low", "List GitHub Actions runs.", obj({ repo: S("owner/repo."), ref: S("Ref.", "main") }, ["repo"]), { needsNetwork: true }),

  // 4. web / research
  d("web_search", "web", "medium", "Web search (DuckDuckGo).", obj({ query: S("Query."), max_results: I("Max.", 8) }, ["query"]), { enabledByDefault: true, needsNetwork: true }),
  d("duckduckgo_search", "web", "medium", "DuckDuckGo HTML search.", obj({ query: S("Query."), max_results: I("Max.", 8) }, ["query"]), { needsNetwork: true }),
  d("web_fetch", "web", "medium", "Fetch readable text from a URL.", obj({ url: S("URL."), max_chars: I("Max chars.", 16000) }, ["url"]), { enabledByDefault: true, needsNetwork: true }),
  d("read_website", "web", "medium", "Fetch + summarize a webpage.", obj({ url: S("URL."), question: S("Focus.") }, ["url"]), { needsNetwork: true }),
  d("summarize_page", "web", "low", "Fetch a URL and summarize.", obj({ url: S("URL."), max_sentences: I("Sentences.", 8) }, ["url"]), { needsNetwork: true }),
  d("extract_links", "web", "low", "Extract links from HTML.", obj({ html: S("HTML."), base_url: S("Base URL.") }, ["html"]), { enabledByDefault: true }),
  d("hackernews_search", "web", "low", "Search Hacker News (Algolia).", obj({ query: S("Query."), max_results: I("Max.", 10) }, ["query"]), { needsNetwork: true }),
  d("github_search", "web", "low", "Search GitHub (repos/code/issues).", obj({ query: S("Query."), search_type: S("Type.", "repositories"), max_results: I("Max.", 10) }, ["query"]), { needsNetwork: true }),
  d("reddit_search", "web", "low", "Search Reddit JSON.", obj({ query: S("Query."), subreddit: S("Subreddit."), max_results: I("Max.", 10) }, ["query"]), { needsNetwork: true }),
  d("crawl_site", "web", "medium", "Shallow single-domain crawl.", obj({ start_url: S("URL."), max_pages: I("Max pages.", 5) }, ["start_url"]), { needsNetwork: true }),
  // Firecrawl (real, global — every agent gets these when FIRECRAWL_API_KEY is set)
  d("firecrawl_scrape", "web", "medium", "Scrape a URL to clean markdown via Firecrawl.", obj({ url: S("URL."), only_main: B("Main content only.", true) }, ["url"]), { enabledByDefault: true, needsNetwork: true, needsEnv: ["FIRECRAWL_API_KEY"] }),
  d("firecrawl_map", "web", "low", "Map all discoverable URLs on a site via Firecrawl.", obj({ url: S("URL."), search: S("Optional filter.") }, ["url"]), { needsNetwork: true, needsEnv: ["FIRECRAWL_API_KEY"] }),
  d("firecrawl_search", "web", "medium", "Web search with scraped page content via Firecrawl.", obj({ query: S("Query."), limit: I("Limit.", 5) }, ["query"]), { needsNetwork: true, needsEnv: ["FIRECRAWL_API_KEY"] }),
  d("firecrawl_crawl", "web", "high", "Crawl a site (async, polled) via Firecrawl.", obj({ url: S("URL."), limit: I("Max pages.", 20) }, ["url"]), { needsNetwork: true, needsEnv: ["FIRECRAWL_API_KEY"] }),
  d("google_search", "web", "medium", "Google CSE (needs keys).", obj({ query: S("Query.") }, ["query"]), { needsNetwork: true, needsEnv: ["GOOGLE_API_KEY", "GOOGLE_CSE_ID"] }),
  d("news_search", "web", "medium", "News search (needs key).", obj({ query: S("Query.") }, ["query"]), { needsNetwork: true, needsEnv: ["NEWSAPI_KEY"] }),
  d("x_search", "web", "medium", "Declared: X/Twitter search.", obj({ query: S("Query.") }, ["query"]), {}),
  d("youtube_transcript", "web", "low", "Declared: YouTube transcript.", obj({ video_id: S("Video id.") }, ["video_id"]), {}),

  // 5. browser / ui (Steel-backed; playwright declared)
  d("browser_scrape", "browser", "high", "Scrape a page via Steel.", obj({ url: S("URL.") }, ["url"]), { needsNetwork: true, needsEnv: ["STEEL_API_KEY"] }),
  d("browser_screenshot", "browser", "high", "Screenshot a page via Steel.", obj({ url: S("URL."), fullPage: B("Full page.", false) }, ["url"]), { needsNetwork: true, needsEnv: ["STEEL_API_KEY"] }),
  d("browser_open", "browser", "high", "Declared: open page (Playwright).", obj({ url: S("URL.") }, ["url"]), { needsBrowser: true }),
  d("browser_click", "browser", "high", "Declared: click (Playwright).", obj({ selector: S("Selector.") }, ["selector"]), { needsBrowser: true }),
  d("browser_type", "browser", "high", "Declared: type (Playwright).", obj({ selector: S("Selector."), text: S("Text.") }, ["selector", "text"]), { needsBrowser: true }),
  d("browser_evaluate", "browser", "high", "Declared: evaluate JS (Playwright).", obj({ script: S("Script.") }, ["script"]), { needsBrowser: true }),
  d("playwright_open", "browser", "high", "Declared: Playwright open.", obj({ url: S("URL.") }, ["url"]), { needsBrowser: true }),
  d("playwright_click", "browser", "high", "Declared: Playwright click.", obj({ selector: S("Selector.") }, ["selector"]), { needsBrowser: true }),
  d("playwright_screenshot", "browser", "medium", "Declared: Playwright screenshot.", obj({ path: S("Path.") }, ["path"]), { needsBrowser: true }),
  d("accessibility_snapshot", "browser", "low", "Declared: a11y snapshot.", obj({}), { needsBrowser: true }),

  // 6. memory / rag (real, local)
  d("memory_get", "memory", "low", "Get a memory item.", obj({ key: S("Key.") }, ["key"]), { enabledByDefault: true }),
  d("memory_put", "memory", "low", "Save a memory item.", obj({ key: S("Key."), value: { description: "JSON value." } }, ["key", "value"]), { enabledByDefault: true }),
  d("memory_search", "memory", "low", "Search memory.", obj({ query: S("Query."), limit: I("Limit.", 5) }, ["query"]), { enabledByDefault: true }),
  d("memory_delete", "memory", "low", "Delete a memory item.", obj({ key: S("Key.") }, ["key"]), { enabledByDefault: true }),
  d("vector_upsert", "memory", "low", "Upsert into a local vector store.", obj({ collection: S("Collection."), id: S("Id."), text: S("Text.") }, ["collection", "id", "text"]), { enabledByDefault: true }),
  d("vector_search", "memory", "low", "Search a local vector store (bag-of-words cosine).", obj({ collection: S("Collection."), query: S("Query."), limit: I("Limit.", 5) }, ["collection", "query"]), { enabledByDefault: true }),
  d("vector_delete", "memory", "low", "Delete from local vector store.", obj({ collection: S("Collection."), id: S("Id.") }, ["collection", "id"]), { enabledByDefault: true }),
  d("knowledge_graph_write", "memory", "low", "Write a KG triple.", obj({ subject: S("S."), predicate: S("P."), object: S("O.") }, ["subject", "predicate", "object"]), { enabledByDefault: true }),
  d("knowledge_graph_query", "memory", "low", "Query KG triples.", obj({ subject: S("S."), predicate: S("P."), object: S("O.") }), { enabledByDefault: true }),
  d("document_index", "memory", "low", "Chunk + index a workspace file.", obj({ path: S("Path."), collection: S("Collection.", "documents") }, ["path"]), { enabledByDefault: true }),
  d("retrieve_context", "memory", "low", "Retrieve from indexed docs.", obj({ query: S("Query."), collection: S("Collection.", "documents"), limit: I("Limit.", 5) }, ["query"]), { enabledByDefault: true }),
  d("compress_context", "memory", "low", "Summarize memory keys.", obj({ keys: A("Keys.", { type: "string" }), max_chars: I("Max.", 4000) }), { enabledByDefault: true }),

  // 7. planning / control (real)
  d("update_plan", "control", "low", "Publish a visible step plan.", obj({ steps: A("Steps.", obj({ step: S("Step."), status: { type: "string", enum: ["pending", "in_progress", "completed"] } }, ["step", "status"])) }, ["steps"]), { enabledByDefault: true }),
  d("finish", "control", "low", "Finish with a final answer.", obj({ answer: S("Answer.") }, ["answer"]), { enabledByDefault: true }),
  d("ask_user", "control", "low", "Ask the user a question.", obj({ question: S("Question.") }, ["question"]), { enabledByDefault: true }),
  d("reflect", "control", "low", "Record a reflection/risk check.", obj({ observation: S("Observation."), goal: S("Goal.") }, ["observation"]), { enabledByDefault: true }),
  d("replan", "control", "low", "Produce a recovery plan.", obj({ goal: S("Goal."), failed_step: S("Failed step."), reason: S("Reason.") }, ["goal"]), { enabledByDefault: true }),
  d("verify_step", "control", "low", "Verify a step (file_exists/text_in_file).", obj({ check_type: S("Check."), target: S("Target."), expected: S("Expected.") }, ["check_type", "target"]), { enabledByDefault: true }),
  d("mark_task_done", "control", "low", "Mark a task done.", obj({ task_id: S("Task id.") }, ["task_id"]), { enabledByDefault: true }),
  d("mark_task_failed", "control", "low", "Mark a task failed.", obj({ task_id: S("Task id."), reason: S("Reason.") }, ["task_id", "reason"]), { enabledByDefault: true }),
  d("stop_run", "control", "low", "Stop the run.", obj({ reason: S("Reason.", "stopped") }), { enabledByDefault: true }),
  d("yield_control", "control", "low", "Yield control.", obj({ message: S("Message.") }), { enabledByDefault: true }),

  // 8. sessions / multi-agent (delegation handlers injected by executor)
  d("delegate_to_agent", "agents", "medium", "Delegate a task to another agent (runs its own tool loop).", obj({ agent: S("Agent name."), task: S("Task.") }, ["agent", "task"]), {}),
  d("agent_send", "agents", "medium", "Send a task to another agent.", obj({ agent: S("Agent name."), message: S("Message.") }, ["agent", "message"]), {}),
  d("agents_list", "agents", "low", "List known agents (from session memory).", obj({}), { enabledByDefault: true }),
  d("spawn_subagent", "agents", "medium", "Record a spawned subagent.", obj({ name: S("Name."), goal: S("Goal.") }, ["name", "goal"]), { enabledByDefault: true }),
  d("handoff_to_agent", "agents", "low", "Record a handoff.", obj({ agent_id: S("Agent."), task: S("Task.") }, ["agent_id", "task"]), { enabledByDefault: true }),
  d("supervisor_route", "agents", "low", "Pick the best agent for a task.", obj({ task: S("Task."), agents: A("Agents.", { type: "object" }) }, ["task", "agents"]), { enabledByDefault: true }),
  d("team_vote", "agents", "low", "Tally votes.", obj({ question: S("Q."), votes: A("Votes.", { type: "object" }) }, ["question", "votes"]), { enabledByDefault: true }),
  d("critique_agent", "agents", "low", "Heuristic critique of an output.", obj({ output: S("Output.") }, ["output"]), { enabledByDefault: true }),
  d("sessions_list", "sessions", "low", "List sessions in memory.", obj({}), { enabledByDefault: true }),
  d("sessions_send", "sessions", "low", "Append a message to a session.", obj({ session_id: S("Id."), message: S("Message.") }, ["session_id", "message"]), { enabledByDefault: true }),
  d("sessions_spawn", "sessions", "low", "Spawn a session record.", obj({ prompt: S("Prompt.") }, ["prompt"]), { enabledByDefault: true }),

  // 9. automation / scheduler (local store)
  d("cron_create", "automation", "medium", "Create a cron job record.", obj({ name: S("Name."), schedule: S("Schedule."), task: { description: "Task." } }, ["name", "schedule", "task"]), { enabledByDefault: true }),
  d("cron_list", "automation", "low", "List cron jobs.", obj({}), { enabledByDefault: true }),
  d("cron_delete", "automation", "low", "Delete a cron job.", obj({ job_id: S("Job id.") }, ["job_id"]), { enabledByDefault: true }),
  d("heartbeat_respond", "automation", "low", "Record a heartbeat.", obj({ status: S("Status.", "alive") }), { enabledByDefault: true }),
  d("queue_task", "automation", "low", "Queue a task.", obj({ task: { description: "Task." }, priority: I("Priority.", 5) }, ["task"]), { enabledByDefault: true }),

  // 10. messaging / productivity
  d("slack_send_message", "messaging", "medium", "Post to a Slack incoming webhook.", obj({ text: S("Text."), webhook_url: S("Webhook.") }, ["text"]), { needsNetwork: true, needsMessages: true }),
  d("discord_send_message", "messaging", "medium", "Post to a Discord webhook.", obj({ content: S("Content."), webhook_url: S("Webhook.") }, ["content"]), { needsNetwork: true, needsMessages: true }),
  d("telegram_send_message", "messaging", "medium", "Send a Telegram message.", obj({ chat_id: S("Chat id."), text: S("Text.") }, ["chat_id", "text"]), { needsNetwork: true, needsMessages: true, needsEnv: ["TELEGRAM_BOT_TOKEN"] }),
  d("draft_email", "messaging", "low", "Draft an email (stored locally).", obj({ to: A("To.", { type: "string" }), subject: S("Subject."), body: S("Body.") }, ["to", "subject", "body"]), { enabledByDefault: true }),
  d("send_email", "messaging", "high", "Declared: send email (SMTP).", obj({ to: A("To.", { type: "string" }), subject: S("Subject."), body: S("Body.") }, ["to", "subject", "body"]), { needsEmail: true }),
  d("calendar_create_event", "messaging", "high", "Declared: create calendar event.", obj({ title: S("Title."), start_iso: S("Start."), end_iso: S("End.") }, ["title", "start_iso", "end_iso"]), {}),
  d("sms_send", "messaging", "high", "Declared: send SMS (Twilio).", obj({ to: S("To."), body: S("Body.") }, ["to", "body"]), { needsMessages: true }),
  d("whatsapp_send_message", "messaging", "high", "Declared: WhatsApp.", obj({ to: S("To."), body: S("Body.") }, ["to", "body"]), {}),

  // 11. apis / data
  d("http_request", "api", "high", "Make an HTTP request.", obj({ method: S("Method."), url: S("URL."), headers: { description: "Headers." }, body: { description: "Body." } }, ["method", "url"]), { needsNetwork: true }),
  d("api_get", "api", "medium", "HTTP GET.", obj({ url: S("URL."), headers: { description: "Headers." } }, ["url"]), { needsNetwork: true }),
  d("api_post", "api", "high", "HTTP POST.", obj({ url: S("URL."), body: { description: "Body." }, headers: { description: "Headers." } }, ["url"]), { needsNetwork: true }),
  d("webhook_send", "api", "medium", "POST a webhook payload.", obj({ url: S("URL."), payload: { description: "Payload." } }, ["url", "payload"]), { needsNetwork: true }),
  d("openapi_call", "api", "high", "Call base_url + path.", obj({ base_url: S("Base."), path: S("Path."), method: S("Method.", "GET"), body: { description: "Body." } }, ["base_url", "path"]), { needsNetwork: true }),
  d("database_query", "api", "high", "Declared: generic DB query.", obj({ connection: S("Conn."), query: S("Query.") }, ["connection", "query"]), {}),
  d("postgres_query", "api", "high", "Declared: Postgres query.", obj({ dsn: S("DSN."), query: S("Query.") }, ["dsn", "query"]), {}),
  d("sqlite_query", "api", "high", "Declared: SQLite query.", obj({ path: S("Path."), query: S("Query.") }, ["path", "query"]), {}),
  d("redis_get", "api", "medium", "Declared: Redis get.", obj({ key: S("Key.") }, ["key"]), {}),
  d("redis_set", "api", "medium", "Declared: Redis set.", obj({ key: S("Key."), value: S("Value.") }, ["key", "value"]), {}),

  // 12. devops / deployment (shell-gated)
  d("run_tests", "devops", "medium", "Run a test command.", obj({ command: S("Command.", "pnpm test"), path: S("Path.", "."), timeout_sec: I("Timeout.", 600) }), { needsShell: true }),
  d("run_build", "devops", "medium", "Run a build command.", obj({ command: S("Command.", "pnpm build"), path: S("Path.", "."), timeout_sec: I("Timeout.", 900) }), { needsShell: true }),
  d("run_typecheck", "devops", "medium", "Run a typecheck command.", obj({ command: S("Command.", "pnpm typecheck"), path: S("Path.", ".") }), { needsShell: true }),
  d("run_lint", "devops", "medium", "Run a lint command.", obj({ command: S("Command.", "pnpm lint"), path: S("Path.", ".") }), { needsShell: true }),
  d("docker_build", "devops", "high", "docker build.", obj({ tag: S("Tag."), path: S("Path.", ".") }, ["tag"]), { needsShell: true }),
  d("docker_run", "devops", "high", "docker run.", obj({ image: S("Image."), args: S("Args.", "") }, ["image"]), { needsShell: true }),
  d("read_logs", "devops", "low", "Run a log command.", obj({ command: S("Command.") }, ["command"]), { needsShell: true }),
  d("check_health", "devops", "low", "HTTP health check.", obj({ url: S("URL."), expected_status: I("Status.", 200) }, ["url"]), { needsNetwork: true }),
  d("deploy_service", "devops", "high", "Declared: deploy.", obj({ provider: S("Provider."), service: S("Service."), environment: S("Env.") }, ["provider", "service", "environment"]), { needsDeploy: true }),
  d("rollback_deploy", "devops", "high", "Declared: rollback.", obj({ provider: S("Provider."), service: S("Service."), environment: S("Env.") }, ["provider", "service", "environment"]), { needsDeploy: true }),
  d("restart_service", "devops", "high", "Run a restart command.", obj({ command: S("Command.") }, ["command"]), { needsShell: true }),

  // 13. media / multimodal (declared — need providers)
  d("image_analyze", "media", "low", "Basic image file inspection.", obj({ path: S("Path."), prompt: S("Prompt.") }, ["path"]), { enabledByDefault: true }),
  d("image_generate", "media", "medium", "Declared: image generation.", obj({ prompt: S("Prompt.") }, ["prompt"]), {}),
  d("video_generate", "media", "medium", "Declared: video generation.", obj({ prompt: S("Prompt.") }, ["prompt"]), {}),
  d("music_generate", "media", "medium", "Declared: music generation.", obj({ prompt: S("Prompt.") }, ["prompt"]), {}),
  d("audio_transcribe", "media", "medium", "Declared: audio transcription.", obj({ path: S("Path.") }, ["path"]), {}),
  d("tts", "media", "medium", "Declared: text-to-speech.", obj({ text: S("Text.") }, ["text"]), {}),
  d("pdf_extract", "media", "low", "Declared: PDF text extraction.", obj({ path: S("Path.") }, ["path"]), {}),
  d("ocr", "media", "low", "Declared: OCR.", obj({ path: S("Path.") }, ["path"]), {}),

  // 14. ui / canvas / generative interface (real, local)
  d("canvas_render", "ui", "low", "Render content to a canvas file + memory.", obj({ content: S("Content."), format: S("Format.", "markdown"), path: S("Path.", "canvas.md") }, ["content"]), { enabledByDefault: true }),
  d("canvas_update", "ui", "low", "Update the canvas.", obj({ content: S("Content."), mode: { type: "string", enum: ["append", "replace"] } }, ["content"]), { enabledByDefault: true }),
  d("dashboard_update", "ui", "low", "Update a dashboard key.", obj({ key: S("Key."), value: { description: "Value." } }, ["key", "value"]), { enabledByDefault: true }),
  d("artifact_create", "ui", "low", "Create a named artifact file.", obj({ name: S("Name."), content: S("Content.") }, ["name", "content"]), { enabledByDefault: true }),
  d("table_render", "ui", "low", "Render rows as a markdown table.", obj({ rows: A("Rows.", { type: "object" }), output_path: S("Path.") }, ["rows"]), { enabledByDefault: true }),
  d("chart_generate", "ui", "medium", "Declared: chart image generation.", obj({ data: A("Data.", { type: "object" }), x: S("X."), y: S("Y.") }, ["data", "x", "y"]), {}),

  // 15. tool catalog / mcp / plugins
  d("tool_search", "tool_catalog", "low", "Search the tool catalog.", obj({ query: S("Query.") }, ["query"]), { enabledByDefault: true }),
  d("tool_describe", "tool_catalog", "low", "Describe one tool.", obj({ name: S("Name.") }, ["name"]), { enabledByDefault: true }),
  d("tool_search_code", "tool_catalog", "low", "Search tool signatures.", obj({ query: S("Query."), language: S("Lang.", "typescript") }, ["query"]), { enabledByDefault: true }),
  d("mcp_list_servers", "mcp", "low", "List configured MCP servers (memory).", obj({}), { enabledByDefault: true }),
  d("mcp_list_tools", "mcp", "low", "List MCP tools (memory).", obj({ server: S("Server.") }), { enabledByDefault: true }),
  d("mcp_call_tool", "mcp", "high", "Declared: call an MCP tool.", obj({ server: S("Server."), tool: S("Tool."), arguments: { description: "Args." } }, ["server", "tool", "arguments"]), {}),
  d("plugin_install", "mcp", "medium", "Record a plugin install (trusted only).", obj({ name: S("Name."), source: S("Source."), trusted: B("Trusted.", false) }, ["name", "source"]), { enabledByDefault: true }),
  d("plugin_enable", "mcp", "low", "Enable a plugin.", obj({ name: S("Name.") }, ["name"]), { enabledByDefault: true }),
  d("plugin_disable", "mcp", "low", "Disable a plugin.", obj({ name: S("Name.") }, ["name"]), { enabledByDefault: true }),
  d("skill_load", "mcp", "low", "Load a skill file into memory.", obj({ path: S("Path.") }, ["path"]), { enabledByDefault: true }),
  d("skill_scan", "mcp", "low", "Scan a skill file for risk patterns.", obj({ path: S("Path.") }, ["path"]), { enabledByDefault: true }),
  d("skill_verify", "mcp", "low", "Verify a skill (scan + gate).", obj({ path: S("Path.") }, ["path"]), { enabledByDefault: true }),
];

// ── registry ─────────────────────────────────────────────────────────────────
export class ToolRegistry {
  private defs = new Map<string, ToolDef>();
  private handlers = new Map<string, ToolHandler>();

  constructor(defs: ToolDef[] = TOOL_DEFS) {
    for (const def of defs) this.defs.set(def.name, def);
    this.registerDefaults();
  }

  /** Allow the executor to inject real handlers (e.g. agent delegation). */
  register(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  list(): ToolDef[] { return Array.from(this.defs.values()); }

  private gatesSatisfied(def: ToolDef, ctx: ToolContext): boolean {
    if (def.needsShell && !ctx.allowShell) return false;
    if (def.needsNetwork && !ctx.allowNetwork) return false;
    if (def.needsBrowser && !ctx.allowBrowser) return false;
    if (def.needsDestructive && !ctx.allowDestructive) return false;
    if (def.needsEmail && !ctx.allowEmail) return false;
    if (def.needsMessages && !ctx.allowMessages) return false;
    if (def.needsDeploy && !ctx.allowDeploy) return false;
    if (def.needsEnv && !def.needsEnv.every((k) => ctx.env[k])) return false;
    return true;
  }

  private isReal(name: string): boolean {
    const h = this.handlers.get(name);
    return Boolean(h) && h !== handleNotConfigured;
  }

  /** Tools actually available in this context: real handler + gates satisfied. */
  availableDefs(ctx: ToolContext): ToolDef[] {
    return this.list().filter((def) => this.isReal(def.name) && this.gatesSatisfied(def, ctx));
  }

  openAiToolSpecs(ctx: ToolContext): Array<Record<string, unknown>> {
    return this.availableDefs(ctx).map((def) => ({
      type: "function",
      function: { name: def.name, description: def.description, parameters: def.inputSchema },
    }));
  }

  describe(name: string): ToolResult {
    const def = this.defs.get(name);
    return def ? ok(def, name) : fail("unknown_tool", `No tool named ${name}`);
  }

  search(query: string): ToolResult {
    const q = query.toLowerCase();
    const matches = this.list().filter((def) => `${def.name} ${def.category} ${def.description}`.toLowerCase().includes(q));
    return ok(matches.map((m) => ({ name: m.name, category: m.category, risk: m.risk, real: this.isReal(m.name) })), `Found ${matches.length} tools.`);
  }

  async invoke(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const def = this.defs.get(name);
    if (!def) return fail("unknown_tool", `No tool named ${name}`);
    if (!this.gatesSatisfied(def, ctx)) {
      const reason = def.needsShell && !ctx.allowShell ? "shell_blocked"
        : def.needsNetwork && !ctx.allowNetwork ? "network_blocked"
        : def.needsDestructive && !ctx.allowDestructive ? "destructive_blocked"
        : def.needsBrowser && !ctx.allowBrowser ? "browser_blocked"
        : def.needsEmail && !ctx.allowEmail ? "email_blocked"
        : def.needsMessages && !ctx.allowMessages ? "messages_blocked"
        : def.needsDeploy && !ctx.allowDeploy ? "deploy_blocked"
        : "not_configured";
      return fail(reason, `${name} is gated/unconfigured in this context.`);
    }
    ctx.audit.push({ ts: Date.now(), event: "tool_call", name, args: redact(args) });
    const handler = this.handlers.get(name) ?? handleNotConfigured;
    try {
      const res = await handler(args, ctx);
      ctx.audit.push({ ts: Date.now(), event: "tool_result", name, ok: res.ok });
      return res;
    } catch (err) {
      return fail("handler_error", String(err));
    }
  }

  // ── default handler wiring ──────────────────────────────────────────────
  private registerDefaults(): void {
    const H = this.handlers;
    // fs
    H.set("read_file", handleRead); H.set("open_file", handleOpenFile);
    H.set("write_file", handleWrite); H.set("edit_file", handleEdit);
    H.set("list_directory", handleList); H.set("open_folder", handleOpenFolder);
    H.set("search_files", handleSearchFiles); H.set("grep_files", handleGrep);
    H.set("file_exists", handleExists); H.set("make_directory", handleMkdir);
    H.set("delete_path", handleDelete); H.set("diff_render", handleDiff);
    H.set("close_context_item", (a, c) => { const k = String(a.key); const had = k in c.memory; delete c.memory[k]; return ok({ key: k, existed: had }, "closed"); });
    // runtime / shell
    for (const n of ["exec", "bash", "execute_shell", "subprocess"]) H.set(n, handleShell);
    H.set("sandbox_run", handleShell);
    H.set("code_execution", handleCodeExec);
    H.set("execute_python_code", (a, c) => handleCodeExec({ language: "python", code: a.code, timeout_sec: a.timeout_sec }, c));
    H.set("execute_python_file", (a, c) => handleShell({ command: `python ${shq(String(a.path))}`, timeout_sec: a.timeout_sec }, c));
    H.set("container_exec", (a, c) => handleShell({ command: `docker run --rm -v ${shq(c.workspace)}:/workspace -w /workspace ${shq(String(a.image))} ${a.command ?? ""}`, timeout_sec: a.timeout_sec }, c));
    H.set("apply_patch", handleApplyPatch);
    // git (shell)
    H.set("git_status", (a, c) => git(c, "status --short --branch", a.path));
    H.set("git_diff", (a, c) => git(c, a.staged ? "diff --cached" : "diff", a.path));
    H.set("git_branch", (a, c) => git(c, a.all ? "branch -a" : "branch --show-current", a.path));
    H.set("git_checkout", (a, c) => git(c, `checkout ${a.create ? "-b " : ""}${shq(String(a.branch))}`, a.path));
    H.set("git_commit", handleGitCommit);
    H.set("git_push", (a, c) => git(c, `push ${shq(String(a.remote ?? "origin"))}${a.branch ? " " + shq(String(a.branch)) : ""}`, a.path));
    H.set("git_pull", (a, c) => git(c, `pull ${shq(String(a.remote ?? "origin"))}${a.branch ? " " + shq(String(a.branch)) : ""}`, a.path));
    H.set("git_clone", (a, c) => handleShell({ command: `git clone ${shq(String(a.url))} ${a.directory ? shq(String(a.directory)) : ""}`, timeout_sec: 600 }, c));
    H.set("clone_repository", H.get("git_clone")!);
    H.set("run_precommit", (a, c) => git(c, "", a.path).then(() => handleShell({ command: "pre-commit run --all-files", timeout_sec: 600 }, c)));
    // github api
    H.set("create_pull_request", (a, c) => gh(c, "POST", `repos/${a.repo}/pulls`, { title: a.title, body: a.body, head: a.head, base: a.base ?? "main" }));
    H.set("create_issue", (a, c) => gh(c, "POST", `repos/${a.repo}/issues`, { title: a.title, body: a.body }));
    H.set("comment_issue", (a, c) => gh(c, "POST", `repos/${a.repo}/issues/${a.issue_number}/comments`, { body: a.body }));
    H.set("read_issue", (a, c) => gh(c, "GET", `repos/${a.repo}/issues/${a.issue_number}`));
    H.set("read_pr", (a, c) => gh(c, "GET", `repos/${a.repo}/pulls/${a.pull_number}`));
    H.set("inspect_ci", (a, c) => gh(c, "GET", `repos/${a.repo}/actions/runs?branch=${encodeURIComponent(String(a.ref ?? "main"))}`));
    H.set("github_search", (a, c) => gh(c, "GET", `search/${a.search_type ?? "repositories"}?q=${encodeURIComponent(String(a.query))}&per_page=${a.max_results ?? 10}`));
    // web
    H.set("web_fetch", handleWebFetch);
    H.set("web_search", handleDuckDuckGo); H.set("duckduckgo_search", handleDuckDuckGo);
    H.set("read_website", handleReadWebsite); H.set("summarize_page", handleReadWebsite);
    H.set("extract_links", handleExtractLinks);
    H.set("hackernews_search", (a, c) => httpJson(c, "GET", `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(String(a.query))}&tags=story&hitsPerPage=${a.max_results ?? 10}`));
    H.set("reddit_search", handleRedditSearch);
    H.set("crawl_site", handleCrawl);
    // firecrawl
    H.set("firecrawl_scrape", handleFirecrawlScrape);
    H.set("firecrawl_map", handleFirecrawlMap);
    H.set("firecrawl_search", handleFirecrawlSearch);
    H.set("firecrawl_crawl", handleFirecrawlCrawl);
    // browser (steel)
    H.set("browser_scrape", handleSteelScrape); H.set("browser_screenshot", handleSteelScreenshot);
    // memory / rag
    H.set("memory_get", (a, c) => ok({ key: a.key, value: c.memory[String(a.key)] }, "get"));
    H.set("memory_put", (a, c) => { c.memory[String(a.key)] = a.value; return ok({ key: a.key, saved: true }, "put"); });
    H.set("memory_search", handleMemorySearch);
    H.set("memory_delete", (a, c) => { const k = String(a.key); const had = k in c.memory; delete c.memory[k]; return ok({ key: k, existed: had }, "deleted"); });
    H.set("vector_upsert", handleVectorUpsert); H.set("vector_search", handleVectorSearch); H.set("vector_delete", handleVectorDelete);
    H.set("knowledge_graph_write", handleKgWrite); H.set("knowledge_graph_query", handleKgQuery);
    H.set("document_index", handleDocIndex); H.set("retrieve_context", (a, c) => handleVectorSearch({ collection: a.collection ?? "documents", query: a.query, limit: a.limit }, c));
    H.set("compress_context", handleCompress);
    // planning / control
    H.set("update_plan", (a, c) => { c.memory._plan = a.steps; return ok({ steps: a.steps }, "plan"); });
    H.set("finish", (a) => ok({ final: a.answer }, "finished"));
    H.set("ask_user", (a) => ok({ question: a.question }, "user_input_required"));
    H.set("reflect", handleReflect); H.set("replan", handleReplan); H.set("verify_step", handleVerifyStep);
    H.set("mark_task_done", (a, c) => { const t = (c.memory._tasks ??= {}) as Record<string, unknown>; t[String(a.task_id)] = { status: "done" }; return ok(t[String(a.task_id)], "done"); });
    H.set("mark_task_failed", (a, c) => { const t = (c.memory._tasks ??= {}) as Record<string, unknown>; t[String(a.task_id)] = { status: "failed", reason: a.reason }; return ok(t[String(a.task_id)], "failed"); });
    H.set("stop_run", (a, c) => { c.memory._stop = { reason: a.reason ?? "stopped" }; return ok(c.memory._stop, "stopped"); });
    H.set("yield_control", (a) => ok({ message: a.message ?? "yield" }, "yielded"));
    // agents / sessions (delegate_to_agent + agent_send injected by executor)
    H.set("agents_list", (_a, c) => ok((c.memory._agents ?? []), "agents"));
    H.set("spawn_subagent", (a, c) => { const arr = (c.memory._subagents ??= []) as unknown[]; const rec = { id: `sub_${Date.now()}`, name: a.name, goal: a.goal }; arr.push(rec); return ok(rec, "spawned"); });
    H.set("handoff_to_agent", (a, c) => { const arr = (c.memory._handoffs ??= []) as unknown[]; const rec = { agent: a.agent_id, task: a.task }; arr.push(rec); return ok(rec, "handoff"); });
    H.set("supervisor_route", handleSupervisorRoute); H.set("team_vote", handleTeamVote); H.set("critique_agent", handleCritique);
    H.set("sessions_list", (_a, c) => ok((c.memory._sessions ?? {}), "sessions"));
    H.set("sessions_send", (a, c) => { const s = (c.memory._sessions ??= {}) as Record<string, unknown[]>; (s[String(a.session_id)] ??= []).push({ message: a.message }); return ok({ session_id: a.session_id }, "sent"); });
    H.set("sessions_spawn", (a, c) => { const s = (c.memory._sessions ??= {}) as Record<string, unknown>; const id = `sess_${Date.now()}`; s[id] = { prompt: a.prompt }; return ok({ session_id: id }, "spawned"); });
    // automation
    H.set("cron_create", (a, c) => { const j = (c.memory._cron ??= {}) as Record<string, unknown>; const id = `cron_${Date.now()}`; j[id] = { name: a.name, schedule: a.schedule, task: a.task, enabled: true }; return ok({ job_id: id }, "created"); });
    H.set("cron_list", (_a, c) => ok((c.memory._cron ?? {}), "cron"));
    H.set("cron_delete", (a, c) => { const j = (c.memory._cron ??= {}) as Record<string, unknown>; const had = String(a.job_id) in j; delete j[String(a.job_id)]; return ok({ existed: had }, "deleted"); });
    H.set("heartbeat_respond", (a, c) => { c.memory._heartbeat = { status: a.status ?? "alive", ts: Date.now() }; return ok(c.memory._heartbeat, "beat"); });
    H.set("queue_task", (a, c) => { const q = (c.memory._queue ??= []) as unknown[]; const rec = { task: a.task, priority: a.priority ?? 5 }; q.push(rec); return ok(rec, "queued"); });
    // messaging
    H.set("slack_send_message", (a, c) => { const url = String(a.webhook_url ?? c.env.SLACK_WEBHOOK_URL ?? ""); return url ? httpJson(c, "POST", url, { text: a.text }) : Promise.resolve(fail("not_configured", "SLACK_WEBHOOK_URL missing")); });
    H.set("discord_send_message", (a, c) => { const url = String(a.webhook_url ?? c.env.DISCORD_WEBHOOK_URL ?? ""); return url ? httpJson(c, "POST", url, { content: a.content }) : Promise.resolve(fail("not_configured", "DISCORD_WEBHOOK_URL missing")); });
    H.set("telegram_send_message", (a, c) => httpJson(c, "POST", `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: a.chat_id, text: a.text }));
    H.set("draft_email", (a, c) => { const d2 = (c.memory._drafts ??= {}) as Record<string, unknown>; const id = `draft_${Date.now()}`; d2[id] = { to: a.to, subject: a.subject, body: a.body }; return ok({ draft_id: id }, "drafted"); });
    // apis
    H.set("http_request", (a, c) => httpJson(c, String(a.method), String(a.url), a.body, a.headers as Record<string, string> | undefined));
    H.set("api_get", (a, c) => httpJson(c, "GET", String(a.url), undefined, a.headers as Record<string, string> | undefined));
    H.set("api_post", (a, c) => httpJson(c, "POST", String(a.url), a.body, a.headers as Record<string, string> | undefined));
    H.set("webhook_send", (a, c) => httpJson(c, "POST", String(a.url), a.payload));
    H.set("openapi_call", (a, c) => httpJson(c, String(a.method ?? "GET"), `${String(a.base_url).replace(/\/$/, "")}/${String(a.path).replace(/^\//, "")}`, a.body));
    // devops (shell)
    H.set("run_tests", (a, c) => handleShell({ command: a.command ?? "pnpm test", timeout_sec: a.timeout_sec ?? 600 }, c));
    H.set("run_build", (a, c) => handleShell({ command: a.command ?? "pnpm build", timeout_sec: a.timeout_sec ?? 900 }, c));
    H.set("run_typecheck", (a, c) => handleShell({ command: a.command ?? "pnpm typecheck", timeout_sec: 600 }, c));
    H.set("run_lint", (a, c) => handleShell({ command: a.command ?? "pnpm lint", timeout_sec: 600 }, c));
    H.set("docker_build", (a, c) => handleShell({ command: `docker build -t ${shq(String(a.tag))} .`, timeout_sec: 1200 }, c));
    H.set("docker_run", (a, c) => handleShell({ command: `docker run --rm ${shq(String(a.image))} ${a.args ?? ""}`, timeout_sec: 600 }, c));
    H.set("read_logs", (a, c) => handleShell({ command: a.command, timeout_sec: 60 }, c));
    H.set("restart_service", (a, c) => handleShell({ command: a.command, timeout_sec: 300 }, c));
    H.set("check_health", handleHealth);
    // media
    H.set("image_analyze", handleImageAnalyze);
    // ui / canvas
    H.set("canvas_render", handleCanvasRender); H.set("canvas_update", handleCanvasUpdate);
    H.set("dashboard_update", (a, c) => { const dd = (c.memory._dashboard ??= {}) as Record<string, unknown>; dd[String(a.key)] = a.value; return ok(dd, "dashboard"); });
    H.set("artifact_create", handleArtifact); H.set("table_render", handleTable);
    // catalog / mcp / plugins
    H.set("tool_search", (a) => this.search(String(a.query ?? "")));
    H.set("tool_describe", (a) => this.describe(String(a.name ?? "")));
    H.set("tool_search_code", (a) => { const r = this.search(String(a.query ?? "")); const names = (r.data as { name: string }[]).map((x) => `async function ${x.name}(args): Promise<ToolResult> {}`); return ok(names, "signatures"); });
    H.set("mcp_list_servers", (_a, c) => ok((c.memory._mcp ?? {}), "servers"));
    H.set("mcp_list_tools", (a, c) => ok(((c.memory._mcp ?? {}) as Record<string, { tools?: unknown }>)[String(a.server ?? "")]?.tools ?? [], "tools"));
    H.set("plugin_install", (a, c) => { if (a.trusted !== true) return fail("approval_required", "Set trusted=true after manual review."); const p = (c.memory._plugins ??= {}) as Record<string, unknown>; p[String(a.name)] = { source: a.source, enabled: false }; return ok(p[String(a.name)], "recorded"); });
    H.set("plugin_enable", (a, c) => { const p = (c.memory._plugins ??= {}) as Record<string, { enabled?: boolean }>; if (!p[String(a.name)]) return fail("not_found", "Unknown plugin"); p[String(a.name)].enabled = true; return ok(p[String(a.name)], "enabled"); });
    H.set("plugin_disable", (a, c) => { const p = (c.memory._plugins ??= {}) as Record<string, { enabled?: boolean }>; if (!p[String(a.name)]) return fail("not_found", "Unknown plugin"); p[String(a.name)].enabled = false; return ok(p[String(a.name)], "disabled"); });
    H.set("skill_load", handleSkillLoad); H.set("skill_scan", handleSkillScan); H.set("skill_verify", handleSkillVerify);

    // everything declared but unwired -> not_configured
    for (const name of this.defs.keys()) if (!H.has(name)) H.set(name, handleNotConfigured);
  }
}

// ── shared helpers ───────────────────────────────────────────────────────────
function redact(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) out[k] = /token|secret|password|api[_-]?key|authorization|cookie/i.test(k) ? "***REDACTED***" : v;
  return out;
}
function shq(s: string): string { return `'${s.replace(/'/g, "'\\''")}'`; }
function wsPath(ctx: ToolContext, raw: string): string {
  const base = path.resolve(ctx.workspace);
  const target = path.resolve(base, raw);
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error(`Path escapes workspace: ${raw}`);
  return target;
}
function htmlToText(raw: string, max = 16000): string {
  return raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function bow(text: string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const w of text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []) m[w] = (m[w] ?? 0) + 1;
  return m;
}
function cosine(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) { dot += (a[k] ?? 0) * (b[k] ?? 0); }
  for (const v of Object.values(a)) na += v * v;
  for (const v of Object.values(b)) nb += v * v;
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function handleShell(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const command = String(a.command ?? "");
  if (!command) return fail("missing_command", "No command.");
  const timeout = Number(a.timeout_sec ?? 60) * 1000;
  try {
    const { stdout, stderr } = await sh(command, { cwd: c.workspace, timeout, env: { ...process.env, ...c.env }, maxBuffer: 10 * 1024 * 1024 });
    return ok({ stdout, stderr, returncode: 0 }, "command_completed");
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    if (e.killed) return fail("timeout", `Timed out after ${a.timeout_sec ?? 60}s`);
    return { ok: false, error: "nonzero_exit", message: "command_failed", data: { stdout: e.stdout ?? "", stderr: e.stderr ?? "", returncode: e.code ?? 1 } };
  }
}
async function handleCodeExec(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const lang = String(a.language);
  const ext = lang === "python" ? "py" : lang === "javascript" ? "js" : "sh";
  const file = path.join(c.workspace, `.snippet_${Date.now()}.${ext}`);
  await fs.writeFile(file, String(a.code), "utf-8");
  const cmd = lang === "python" ? `python ${shq(file)}` : lang === "javascript" ? `node ${shq(file)}` : `bash ${shq(file)}`;
  try { return await handleShell({ command: cmd, timeout_sec: a.timeout_sec }, c); }
  finally { await fs.rm(file).catch(() => {}); }
}
async function git(c: ToolContext, args: string, p: unknown): Promise<ToolResult> {
  if (!args) return ok({}, "noop");
  return handleShell({ command: `git -C ${shq(wsPath(c, String(p ?? ".")))} ${args}`, timeout_sec: 300 }, c);
}
async function handleGitCommit(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const repo = shq(wsPath(c, String(a.path ?? ".")));
  const add = await handleShell({ command: `git -C ${repo} add -A`, timeout_sec: 60 }, c);
  if (!add.ok) return add;
  return handleShell({ command: `git -C ${repo} commit -m ${shq(String(a.message))}`, timeout_sec: 120 }, c);
}
async function handleApplyPatch(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const file = path.join(c.workspace, `.patch_${Date.now()}.diff`);
  await fs.writeFile(file, String(a.patch), "utf-8");
  try { return await handleShell({ command: `git apply --whitespace=fix ${shq(file)}`, timeout_sec: 60 }, c); }
  finally { await fs.rm(file).catch(() => {}); }
}
async function gh(c: ToolContext, method: string, pathPart: string, body?: unknown): Promise<ToolResult> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "bos-aura-agent", "X-GitHub-Api-Version": "2022-11-28" };
  if (c.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${c.env.GITHUB_TOKEN}`;
  return httpJson(c, method, `https://api.github.com/${pathPart}`, body, headers);
}
async function httpJson(c: ToolContext, method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<ToolResult> {
  try {
    const h: Record<string, string> = { "User-Agent": "bos-aura-agent", ...(headers ?? {}) };
    let payload: string | undefined;
    if (body !== undefined && body !== null) { payload = typeof body === "string" ? body : JSON.stringify(body); if (!h["Content-Type"]) h["Content-Type"] = "application/json"; }
    const r = await fetch(url, { method: method.toUpperCase(), headers: h, body: payload });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: r.ok, data: { status: r.status, json, text: text.slice(0, 8000) }, message: r.ok ? "http_ok" : `http_${r.status}`, error: r.ok ? null : "http_error" };
  } catch (err) { return fail("fetch_failed", String(err)); }
}

// fs handlers
async function handleRead(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const p = wsPath(c, String(a.path));
  try { let t = await fs.readFile(p, "utf-8"); if (a.max_chars) t = t.slice(0, Number(a.max_chars)); return ok({ path: p, content: t, chars: t.length }, "read"); } catch { return fail("not_found", p); }
}
async function handleOpenFile(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const r = await handleRead(a, c); if (!r.ok) return r;
  const key = String(a.key ?? `context:file:${a.path}`); c.memory[key] = r.data; return ok({ key }, "opened");
}
async function handleWrite(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const p = wsPath(c, String(a.path)); const overwrite = a.overwrite !== false;
  try { await fs.access(p); if (!overwrite) return fail("exists", "Set overwrite=true."); } catch { /* ok */ }
  await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, String(a.content ?? ""), "utf-8");
  return ok({ path: p }, "written");
}
async function handleEdit(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const p = wsPath(c, String(a.path)); let t: string;
  try { t = await fs.readFile(p, "utf-8"); } catch { return fail("not_found", p); }
  if (!t.includes(String(a.old_text))) return fail("old_text_not_found", "Exact text not found.");
  await fs.writeFile(p, t.replace(String(a.old_text), String(a.new_text)), "utf-8"); return ok({ path: p }, "edited");
}
async function handleList(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const p = wsPath(c, String(a.path ?? "."));
  try {
    if (a.recursive) { const all = await walk(p); return ok(all.map((f) => path.relative(c.workspace, f)), `${all.length} files`); }
    const e = await fs.readdir(p, { withFileTypes: true }); return ok(e.map((x) => ({ name: x.name, type: x.isDirectory() ? "dir" : "file" })), `${e.length} items`);
  } catch { return fail("not_found", p); }
}
async function handleOpenFolder(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const r = await handleList(a, c); if (!r.ok) return r; const key = String(a.key ?? `context:folder:${a.path ?? "."}`); c.memory[key] = r.data; return ok({ key }, "opened");
}
async function walk(root: string, acc: string[] = []): Promise<string[]> {
  let entries; try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) { const full = path.join(root, e.name); if (e.isDirectory()) await walk(full, acc); else acc.push(full); }
  return acc;
}
async function handleSearchFiles(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const root = wsPath(c, String(a.path ?? ".")); const pat = String(a.pattern ?? "").replace(/\*/g, "");
  const files = (await walk(root)).filter((f) => f.includes(pat)).map((f) => path.relative(c.workspace, f));
  return ok(files, `${files.length} matches`);
}
async function handleGrep(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const root = wsPath(c, String(a.path ?? ".")); const re = new RegExp(String(a.pattern), "i"); const max = Number(a.max_matches ?? 80);
  const out: Array<Record<string, unknown>> = [];
  for (const f of await walk(root)) { let t: string; try { t = await fs.readFile(f, "utf-8"); } catch { continue; } const lines = t.split(/\r?\n/); for (let i = 0; i < lines.length; i++) { if (re.test(lines[i])) { out.push({ path: path.relative(c.workspace, f), line: i + 1, text: lines[i].slice(0, 400) }); if (out.length >= max) return ok(out, `${out.length} matches`); } } }
  return ok(out, `${out.length} matches`);
}
async function handleExists(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const p = wsPath(c, String(a.path)); try { const st = await fs.stat(p); return ok({ exists: true, is_file: st.isFile(), is_dir: st.isDirectory() }, p); } catch { return ok({ exists: false }, p); }
}
async function handleMkdir(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const p = wsPath(c, String(a.path)); await fs.mkdir(p, { recursive: true }); return ok({ path: p }, "created");
}
async function handleDelete(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const p = wsPath(c, String(a.path)); try { await fs.rm(p, { recursive: a.recursive === true }); return ok({ path: p }, "deleted"); } catch (err) { return fail("delete_failed", String(err)); }
}
function handleDiff(a: Record<string, unknown>): ToolResult {
  const before = String(a.before).split("\n"); const after = String(a.after).split("\n");
  const out: string[] = ["--- before", "+++ after"];
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) { if (before[i] !== after[i]) { if (before[i] !== undefined) out.push(`- ${before[i]}`); if (after[i] !== undefined) out.push(`+ ${after[i]}`); } else if (before[i] !== undefined) out.push(`  ${before[i]}`); }
  return ok({ diff: out.join("\n") }, "diff");
}

// web handlers
async function handleWebFetch(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  try { const r = await fetch(String(a.url), { headers: { "User-Agent": "bos-aura-agent" } }); if (!r.ok) return fail("http_error", `HTTP ${r.status}`); const text = htmlToText(await r.text(), Number(a.max_chars ?? 16000)); return ok({ url: a.url, text }, `fetched ${text.length} chars`); } catch (err) { return fail("fetch_failed", String(err)); }
}
async function handleReadWebsite(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const r = await handleWebFetch({ url: a.url, max_chars: 24000 }, c); if (!r.ok) return r;
  const text = (r.data as { text: string }).text; const sentences = text.split(/(?<=[.!?])\s+/).slice(0, Number(a.max_sentences ?? 8)).join(" ");
  return ok({ url: a.url, summary: sentences, text }, "read");
}
async function handleDuckDuckGo(a: Record<string, unknown>): Promise<ToolResult> {
  try {
    const r = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(String(a.query))}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    const markup = await r.text(); const max = Number(a.max_results ?? 8);
    const results: Array<{ title: string; url: string }> = [];
    const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g; let m: RegExpExecArray | null;
    while ((m = re.exec(markup)) && results.length < max) {
      let href = m[1]; const qs = new URL(href, "https://duckduckgo.com").searchParams.get("uddg"); if (qs) href = qs;
      results.push({ title: htmlToText(m[2], 200), url: href });
    }
    return ok(results, `${results.length} results`);
  } catch (err) { return fail("search_failed", String(err)); }
}
function handleExtractLinks(a: Record<string, unknown>): ToolResult {
  const links = new Set<string>(); const re = /href=["']([^"'#][^"']*)["']/gi; let m: RegExpExecArray | null;
  while ((m = re.exec(String(a.html)))) { try { links.add(a.base_url ? new URL(m[1], String(a.base_url)).href : m[1]); } catch { links.add(m[1]); } }
  return ok([...links], `${links.size} links`);
}
async function handleRedditSearch(a: Record<string, unknown>): Promise<ToolResult> {
  try {
    const base = a.subreddit ? `https://www.reddit.com/r/${a.subreddit}/search.json` : "https://www.reddit.com/search.json";
    const r = await fetch(`${base}?q=${encodeURIComponent(String(a.query))}&limit=${a.max_results ?? 10}${a.subreddit ? "&restrict_sr=on" : ""}`, { headers: { "User-Agent": "bos-aura-agent/1.0" } });
    const data = await r.json() as { data?: { children?: { data: Record<string, unknown> }[] } };
    const posts = (data.data?.children ?? []).map((ch) => ({ title: ch.data.title, subreddit: ch.data.subreddit, url: `https://reddit.com${ch.data.permalink}`, score: ch.data.score }));
    return ok(posts, `${posts.length} results`);
  } catch (err) { return fail("reddit_failed", String(err)); }
}
async function handleCrawl(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const start = String(a.start_url); const maxPages = Number(a.max_pages ?? 5); const origin = new URL(start).origin;
  const seen = new Set<string>(); const queue = [start]; const pages: Array<Record<string, unknown>> = [];
  while (queue.length && pages.length < maxPages) {
    const url = queue.shift()!; if (seen.has(url)) continue; seen.add(url);
    const r = await handleWebFetch({ url, max_chars: 4000 }, c); if (!r.ok) continue;
    pages.push({ url, text: (r.data as { text: string }).text });
  }
  return ok({ pages, visited: [...seen] }, `crawled ${pages.length} pages`);
}

// steel browser (auth via Steel-Api-Key header)
const STEEL_BASE = "https://api.steel.dev/v1";
function steelHeaders(c: ToolContext): Record<string, string> {
  return { "Steel-Api-Key": String(c.env.STEEL_API_KEY ?? ""), "Content-Type": "application/json" };
}
async function handleSteelScrape(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  try {
    const r = await fetch(`${STEEL_BASE}/scrape`, { method: "POST", headers: steelHeaders(c), body: JSON.stringify({ url: a.url, format: ["markdown"] }) });
    const data = await r.json() as { content?: { markdown?: string }; metadata?: unknown };
    return r.ok ? ok({ url: a.url, markdown: data.content?.markdown ?? "", metadata: data.metadata }, "scraped") : fail("steel_error", `HTTP ${r.status}`, data);
  } catch (err) { return fail("steel_failed", String(err)); }
}
async function handleSteelScreenshot(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  try { const r = await fetch(`${STEEL_BASE}/screenshot`, { method: "POST", headers: steelHeaders(c), body: JSON.stringify({ url: a.url, fullPage: a.fullPage === true }) }); return r.ok ? ok({ url: a.url, captured: true }, "captured") : fail("steel_error", `HTTP ${r.status}`); } catch (err) { return fail("steel_failed", String(err)); }
}

// firecrawl (auth via Bearer)
const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";
function fcHeaders(c: ToolContext): Record<string, string> {
  return { Authorization: `Bearer ${c.env.FIRECRAWL_API_KEY ?? ""}`, "Content-Type": "application/json" };
}
async function handleFirecrawlScrape(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  try {
    const r = await fetch(`${FIRECRAWL_BASE}/scrape`, { method: "POST", headers: fcHeaders(c), body: JSON.stringify({ url: a.url, formats: ["markdown"], onlyMainContent: a.only_main !== false }) });
    const data = await r.json() as { success?: boolean; data?: { markdown?: string; metadata?: unknown } };
    return r.ok && data.success ? ok({ url: a.url, markdown: data.data?.markdown ?? "", metadata: data.data?.metadata }, "scraped") : fail("firecrawl_error", `HTTP ${r.status}`, data);
  } catch (err) { return fail("firecrawl_failed", String(err)); }
}
async function handleFirecrawlMap(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = { url: a.url }; if (a.search) body.search = a.search;
    const r = await fetch(`${FIRECRAWL_BASE}/map`, { method: "POST", headers: fcHeaders(c), body: JSON.stringify(body) });
    const data = await r.json() as { success?: boolean; links?: unknown[] };
    return r.ok && data.success ? ok({ url: a.url, links: data.links ?? [] }, `${(data.links ?? []).length} links`) : fail("firecrawl_error", `HTTP ${r.status}`, data);
  } catch (err) { return fail("firecrawl_failed", String(err)); }
}
async function handleFirecrawlSearch(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  try {
    const r = await fetch(`${FIRECRAWL_BASE}/search`, { method: "POST", headers: fcHeaders(c), body: JSON.stringify({ query: a.query, limit: Number(a.limit ?? 5) }) });
    const data = await r.json() as { success?: boolean; data?: unknown };
    return r.ok ? ok({ query: a.query, results: data.data ?? data }, "searched") : fail("firecrawl_error", `HTTP ${r.status}`, data);
  } catch (err) { return fail("firecrawl_failed", String(err)); }
}
async function handleFirecrawlCrawl(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  try {
    const start = await fetch(`${FIRECRAWL_BASE}/crawl`, { method: "POST", headers: fcHeaders(c), body: JSON.stringify({ url: a.url, limit: Number(a.limit ?? 20) }) });
    const started = await start.json() as { success?: boolean; id?: string };
    if (!start.ok || !started.id) return fail("firecrawl_error", `HTTP ${start.status}`, started);
    // Poll a bounded number of times (crawl is async).
    for (let i = 0; i < 10; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const poll = await fetch(`${FIRECRAWL_BASE}/crawl/${started.id}`, { headers: fcHeaders(c) });
      const status = await poll.json() as { status?: string; data?: unknown[]; completed?: number; total?: number };
      if (status.status === "completed") return ok({ url: a.url, pages: status.data ?? [], count: (status.data ?? []).length }, "crawled");
    }
    return ok({ url: a.url, id: started.id, status: "in_progress", note: "Crawl still running; poll with the id." }, "crawl_started");
  } catch (err) { return fail("firecrawl_failed", String(err)); }
}

// memory / rag
function handleMemorySearch(a: Record<string, unknown>, c: ToolContext): ToolResult {
  const q = String(a.query ?? "").toLowerCase(); const limit = Number(a.limit ?? 5); const out: Array<Record<string, unknown>> = [];
  for (const [k, v] of Object.entries(c.memory)) { if (k.startsWith("_")) continue; if (`${k} ${JSON.stringify(v)}`.toLowerCase().includes(q)) { out.push({ key: k, value: v }); if (out.length >= limit) break; } }
  return ok(out, `${out.length} matches`);
}
function vecStore(c: ToolContext, col: string): Record<string, { text: string; vector: Record<string, number> }> {
  const root = (c.memory._vectors ??= {}) as Record<string, Record<string, { text: string; vector: Record<string, number> }>>;
  return (root[col] ??= {});
}
function handleVectorUpsert(a: Record<string, unknown>, c: ToolContext): ToolResult {
  vecStore(c, String(a.collection))[String(a.id)] = { text: String(a.text), vector: bow(String(a.text)) }; return ok({ collection: a.collection, id: a.id }, "upserted");
}
function handleVectorSearch(a: Record<string, unknown>, c: ToolContext): ToolResult {
  const store = vecStore(c, String(a.collection)); const qv = bow(String(a.query));
  const scored = Object.entries(store).map(([id, rec]) => ({ id, score: cosine(qv, rec.vector), text: rec.text })).sort((x, y) => y.score - x.score).slice(0, Number(a.limit ?? 5));
  return ok(scored, "vector_search");
}
function handleVectorDelete(a: Record<string, unknown>, c: ToolContext): ToolResult {
  const store = vecStore(c, String(a.collection)); const had = String(a.id) in store; delete store[String(a.id)]; return ok({ existed: had }, "deleted");
}
function handleKgWrite(a: Record<string, unknown>, c: ToolContext): ToolResult {
  const t = (c.memory._kg ??= []) as unknown[]; const triple = { subject: a.subject, predicate: a.predicate, object: a.object }; t.push(triple); return ok(triple, "kg_write");
}
function handleKgQuery(a: Record<string, unknown>, c: ToolContext): ToolResult {
  const t = (c.memory._kg ?? []) as Array<Record<string, unknown>>;
  const out = t.filter((x) => (!a.subject || x.subject === a.subject) && (!a.predicate || x.predicate === a.predicate) && (!a.object || x.object === a.object));
  return ok(out, `${out.length} triples`);
}
async function handleDocIndex(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const r = await handleRead({ path: a.path }, c); if (!r.ok) return r; const text = (r.data as { content: string }).content; const col = String(a.collection ?? "documents");
  const ids: string[] = []; for (let i = 0, n = 0; i < text.length; i += 1200, n++) { const id = `${a.path}#${n}`; vecStore(c, col)[id] = { text: text.slice(i, i + 1200), vector: bow(text.slice(i, i + 1200)) }; ids.push(id); }
  return ok({ collection: col, chunks: ids }, "indexed");
}
function handleCompress(a: Record<string, unknown>, c: ToolContext): ToolResult {
  const keys = (a.keys as string[] | undefined) ?? Object.keys(c.memory).filter((k) => !k.startsWith("_"));
  const blob = keys.map((k) => `[${k}] ${JSON.stringify(c.memory[k])}`).join(" ");
  return ok({ compressed: blob.replace(/\s+/g, " ").slice(0, Number(a.max_chars ?? 4000)), keys }, "compressed");
}

// planning / control
function handleReflect(a: Record<string, unknown>, c: ToolContext): ToolResult {
  const obs = String(a.observation); const risks = /error|failed|exception|timeout|denied/i.test(obs) ? ["failure_signal"] : [];
  const rec = { goal: a.goal, observation: obs, risks, recommendation: risks.length ? "replan_or_retry" : "continue" };
  ((c.memory._reflections ??= []) as unknown[]).push(rec); return ok(rec, "reflected");
}
function handleReplan(a: Record<string, unknown>, c: ToolContext): ToolResult {
  const plan = [{ step: "review_goal", status: "pending" }, { step: "inspect_state", status: "pending" }, { step: "retry_failed", status: "pending", failed_step: a.failed_step }, { step: "verify", status: "pending" }];
  c.memory._plan = plan; return ok({ goal: a.goal, plan }, "replanned");
}
async function handleVerifyStep(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const t = String(a.check_type);
  if (t === "file_exists") return handleExists({ path: a.target }, c);
  if (t === "text_in_file") { const r = await handleRead({ path: a.target }, c); if (!r.ok) return r; const found = a.expected ? (r.data as { content: string }).content.includes(String(a.expected)) : false; return { ok: found, data: { found }, message: found ? "verified" : "not_verified", error: found ? null : "missing_text" }; }
  return fail("unsupported_check", "Supported: file_exists, text_in_file");
}
function handleSupervisorRoute(a: Record<string, unknown>): ToolResult {
  const words = new Set(String(a.task).toLowerCase().match(/\w+/g) ?? []);
  const scored = (a.agents as Array<Record<string, unknown>>).map((ag) => ({ agent: ag, score: [...words].filter((w) => `${ag.name} ${ag.role} ${ag.skills}`.toLowerCase().includes(w)).length })).sort((x, y) => y.score - x.score);
  return ok({ chosen: scored[0]?.agent ?? null, scores: scored }, "routed");
}
function handleTeamVote(a: Record<string, unknown>): ToolResult {
  const tally: Record<string, number> = {}; for (const v of a.votes as Array<{ choice: string }>) tally[v.choice] = (tally[v.choice] ?? 0) + 1;
  const winner = Object.entries(tally).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null; return ok({ tally, winner }, "voted");
}
function handleCritique(a: Record<string, unknown>): ToolResult {
  const out = String(a.output); const findings: string[] = [];
  if (out.trim().length < 50) findings.push("too_short"); if (out.includes("TODO")) findings.push("contains_todo"); if (!/test|verify|evidence/i.test(out)) findings.push("no_verification");
  return ok({ findings, score: Math.max(0, 10 - findings.length * 2) }, "critiqued");
}

// devops / media / ui
async function handleHealth(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  try { const r = await fetch(String(a.url)); const good = r.status === Number(a.expected_status ?? 200); return { ok: good, data: { status: r.status }, message: good ? "healthy" : "unhealthy", error: good ? null : "bad_status" }; } catch (err) { return fail("health_failed", String(err)); }
}
async function handleImageAnalyze(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const p = wsPath(c, String(a.path)); try { const st = await fs.stat(p); return ok({ path: p, bytes: st.size, ext: path.extname(p), note: "Basic file inspection only; wire a vision model for content analysis." }, "image_observed"); } catch { return fail("not_found", p); }
}
async function handleCanvasRender(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const p = wsPath(c, String(a.path ?? "canvas.md")); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, String(a.content), "utf-8");
  c.memory._canvas = { content: a.content, format: a.format ?? "markdown", path: p }; return ok(c.memory._canvas, "rendered");
}
function handleCanvasUpdate(a: Record<string, unknown>, c: ToolContext): ToolResult {
  const canvas = (c.memory._canvas ??= { content: "" }) as { content: string };
  canvas.content = a.mode === "append" ? `${canvas.content}\n${a.content}` : String(a.content); return ok(canvas, "updated");
}
async function handleArtifact(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const rel = `artifacts/${String(a.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`; const p = wsPath(c, rel);
  await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, String(a.content), "utf-8");
  ((c.memory._artifacts ??= []) as unknown[]).push({ name: a.name, path: p }); return ok({ name: a.name, path: p }, "artifact");
}
function handleTable(a: Record<string, unknown>): ToolResult {
  const rows = a.rows as Array<Record<string, unknown>>; if (!rows.length) return ok({ table: "" }, "empty");
  const headers = Object.keys(rows[0]); let table = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n`;
  for (const r of rows) table += `| ${headers.map((h) => String(r[h] ?? "")).join(" | ")} |\n`; return ok({ table }, "table");
}

// skills
async function handleSkillLoad(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const r = await handleRead({ path: a.path }, c); if (!r.ok) return r; const id = `skill_${Date.now()}`;
  ((c.memory._skills ??= {}) as Record<string, unknown>)[id] = { path: a.path, content: (r.data as { content: string }).content, verified: false }; return ok({ skill_id: id }, "loaded");
}
async function handleSkillScan(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const r = await handleRead({ path: a.path }, c); if (!r.ok) return r; const text = (r.data as { content: string }).content; const flags: string[] = [];
  const pats: Record<string, RegExp> = { shell: /\b(exec|subprocess|os\.system|rm\s+-rf|child_process)\b/i, secret: /\b(API_KEY|TOKEN|PASSWORD|SECRET|process\.env)\b/i, network: /\b(fetch\(|requests\.|urllib|https?:\/\/)\b/i, injection: /ignore previous|system prompt|exfiltrate/i };
  for (const [n, re] of Object.entries(pats)) if (re.test(text)) flags.push(n);
  return ok({ path: a.path, flags, safe_to_auto_enable: flags.length === 0 }, "scanned");
}
async function handleSkillVerify(a: Record<string, unknown>, c: ToolContext): Promise<ToolResult> {
  const scan = await handleSkillScan(a, c); if (!scan.ok) return scan; const flags = (scan.data as { flags: string[] }).flags;
  return { ok: flags.length === 0, data: scan.data, message: flags.length === 0 ? "verified" : "failed_verification", error: flags.length === 0 ? null : "risk_flags" };
}

function handleNotConfigured(a: Record<string, unknown>): ToolResult {
  return fail("not_configured", "Declared but not wired. Add a real handler with credentials, policy, and verification.", { args_received: redact(a) });
}

// Shared singleton registry.
export const registry = new ToolRegistry();
