/**
 * Open the current Pi session as a Markdown transcript in Neovim.
 *
 * Commands:
 *   /nvim         Open the latest request and its response in Neovim.
 *   /nvim branch  Open the complete active branch.
 *   /nvim all     Open every stored entry, including other branches.
 *
 * The generated file is kept in the system temporary directory so it can be
 * inspected or edited after Neovim exits.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type JsonObject = Record<string, unknown>;

type ContentBlock = {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	name?: unknown;
	id?: unknown;
	arguments?: unknown;
	mimeType?: unknown;
};

type SessionEntry = {
	type?: unknown;
	message?: JsonObject;
	command?: unknown;
	output?: unknown;
	exitCode?: unknown;
	cancelled?: unknown;
	truncated?: unknown;
	customType?: unknown;
	content?: unknown;
	data?: unknown;
	summary?: unknown;
	fromId?: unknown;
	provider?: unknown;
	modelId?: unknown;
	thinkingLevel?: unknown;
	label?: unknown;
	targetId?: unknown;
	name?: unknown;
	timestamp?: unknown;
};

type NvimResult = {
	status: number | null;
	error?: Error;
};

let streamingAssistantMessage: JsonObject | undefined;

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asObject(value: unknown): JsonObject | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as JsonObject;
}

function renderContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";

	const sections: string[] = [];
	for (const value of content) {
		const block = asObject(value) as ContentBlock | undefined;
		if (!block) continue;

		switch (block.type) {
			case "text": {
				const text = asString(block.text)?.trim();
				if (text) sections.push(text);
				break;
			}
			case "thinking":
			case "toolCall":
				// Keep the transcript focused on the visible conversation.
				break;
			case "image": {
				const mimeType = asString(block.mimeType) ?? "unknown type";
				sections.push(`_[Image omitted from text transcript: ${mimeType}]_`);
				break;
			}
			default: {
				const text = asString(block.text);
				if (text) sections.push(text.trim());
			}
		}
	}

	return sections.filter(Boolean).join("\n\n");
}

function roleLabel(role: string): string {
	return role === "assistant" ? "Assistant" : "User";
}

function renderMessage(message: JsonObject): string {
	const role = asString(message.role);
	if (role !== "user" && role !== "assistant") return "";

	const body = renderContent(message.content);
	if (!body) return "";
	return `# ${roleLabel(role)}\n\n${body}`;
}

function renderEntry(entry: SessionEntry): string {
	if (asString(entry.type) !== "message" || !entry.message) return "";
	return renderMessage(entry.message);
}

function buildMarkdown(entries: SessionEntry[]): string {
	const sections = entries.map(renderEntry).filter(Boolean);
	return sections.length > 0 ? `${sections.join("\n\n")}\n` : "";
}

function parseScope(args: string): "last" | "all" | "branch" {
	const tokens = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.includes("all")) return "all";
	if (tokens.includes("branch") || tokens.includes("current")) return "branch";
	return "last";
}

function latestRequestAndResponse(branch: SessionEntry[]): SessionEntry[] {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const message = branch[index]?.message;
		if (asString(message?.role) === "user") return branch.slice(index);
	}
	return branch;
}

function tempTranscriptPath(ctx: ExtensionContext): string {
	const sessionId = ctx.sessionManager.getSessionId().replace(/[^a-zA-Z0-9._-]/g, "-");
	return join(tmpdir(), `pi-session-${sessionId || Date.now()}.md`);
}

async function openInNvim(filePath: string, ctx: ExtensionContext): Promise<NvimResult | undefined> {
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) ctx.ui.notify("Opening a session in Neovim requires interactive TUI mode.", "warning");
		return undefined;
	}

	return ctx.ui.custom<NvimResult>((tui, _theme, _keybindings, done) => {
		tui.stop();
		let result: NvimResult = { status: null };

		try {
			process.stdout.write("\x1b[2J\x1b[H");
			const child = spawnSync("nvim", ["--", filePath], {
				cwd: ctx.cwd,
				env: process.env,
				stdio: "inherit",
			});
			result = { status: child.status, error: child.error };
		} catch (error) {
			result = { status: null, error: error instanceof Error ? error : new Error(String(error)) };
		} finally {
			tui.start();
			tui.requestRender(true);
			done(result);
		}

		return { render: () => [], invalidate: () => undefined };
	});
}

function entriesForScope(ctx: ExtensionContext, scope: "last" | "all" | "branch"): SessionEntry[] {
	const rawEntries = scope === "all"
		? ctx.sessionManager.getEntries()
		: ctx.sessionManager.getBranch();
	const selectedEntries = rawEntries as unknown as SessionEntry[];
	const entries = scope === "last"
		? latestRequestAndResponse(selectedEntries)
		: selectedEntries;

	if (!streamingAssistantMessage) return entries;

	return [
		...entries,
		{
			type: "message",
			timestamp: new Date().toISOString(),
			message: streamingAssistantMessage,
		},
	];
}

async function openSession(ctx: ExtensionContext, args: string): Promise<void> {
	const scope = parseScope(args);
	const entries = entriesForScope(ctx, scope);

	if (entries.length === 0) {
		if (ctx.hasUI) ctx.ui.notify("The current session has no entries to open.", "warning");
		return;
	}

	const filePath = tempTranscriptPath(ctx);
	const markdown = buildMarkdown(entries);
	if (!markdown) {
		if (ctx.hasUI) ctx.ui.notify("No visible user or assistant text found in the selected session.", "warning");
		return;
	}

	try {
		writeFileSync(filePath, markdown, { encoding: "utf8", mode: 0o600 });
		chmodSync(filePath, 0o600);
	} catch (error) {
		if (ctx.hasUI) ctx.ui.notify(`Could not write ${filePath}: ${String(error)}`, "error");
		return;
	}

	const result = await openInNvim(filePath, ctx);
	if (!result) return;

	if (result.error) {
		if (ctx.hasUI) ctx.ui.notify(`Could not start nvim: ${result.error.message}`, "error");
		return;
	}
	if (result.status !== 0) {
		if (ctx.hasUI) ctx.ui.notify(`nvim exited with status ${result.status ?? "unknown"}.`, "warning");
		return;
	}
	if (ctx.hasUI) ctx.ui.notify(`Session transcript: ${filePath}`, "info");
}

export default function (pi: ExtensionAPI) {
	pi.on("message_start", (event) => {
		const message = asObject(event.message);
		if (asString(message?.role) === "assistant") streamingAssistantMessage = message;
	});

	pi.on("message_update", (event) => {
		const message = asObject(event.message);
		if (asString(message?.role) === "assistant") streamingAssistantMessage = message;
	});

	pi.on("message_end", (event) => {
		const message = asObject(event.message);
		if (asString(message?.role) === "assistant") streamingAssistantMessage = undefined;
	});

	pi.registerCommand("nvim", {
		description: "Open the latest Pi request and response in Neovim. Use /nvim all for full history.",
		handler: async (args, ctx: ExtensionCommandContext) => {
			await openSession(ctx, args);
		},
	});

	pi.registerShortcut("ctrl+n", {
		description: "Open the latest Pi request and response in Neovim",
		handler: async (ctx) => {
			await openSession(ctx, "");
		},
	});
}
