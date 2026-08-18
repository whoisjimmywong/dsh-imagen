import { SessionId } from "@deepseek-ai/dsh-session";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";

//#region src/rpc.ts
/** Private loopback RPC names shared by the Host and browser halves. */
const IMAGEN_RPC_CHANNEL = "/dsh-imagen";
/** Versioned endpoints: live progress, durable image reads, model listing. */
const IMAGEN_RPC_ENDPOINT = {
	progress: "imagen/progress",
	image: "imagen/image",
	models: "imagen/models"
};

//#endregion
//#region src/client.ts
const MAX_REDIRECTS = 3;
const MAX_ERROR_BYTES = 8192;
/** HTTP/protocol failure with a stable retry decision. */
var ImageApiError = class extends Error {
	status;
	code;
	retryable;
	constructor(message, options = {}) {
		super(message, options.cause === void 0 ? void 0 : { cause: options.cause });
		this.name = "ImageApiError";
		this.status = options.status;
		this.code = options.code;
		this.retryable = options.retryable ?? false;
	}
};
/** Validate an API base URL before a credential can be sent to it. */
function validateBaseUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError("baseUrl must be a valid http(s) URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new TypeError("baseUrl must use https, or http for a loopback host");
	if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw new TypeError("baseUrl must not contain credentials, a query, or a fragment");
	const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
	if (url.protocol !== "https:" && !loopback) throw new TypeError("baseUrl must use https outside loopback");
	return url.href.replace(/\/+$/u, "");
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function outputFormat(value, fallback) {
	return value === "png" || value === "jpeg" || value === "webp" ? value : fallback;
}
function usage(value) {
	if (!isRecord$1(value)) return void 0;
	const inputTokens = value.input_tokens;
	const outputTokens = value.output_tokens;
	const totalTokens = value.total_tokens;
	if ([
		inputTokens,
		outputTokens,
		totalTokens
	].every((item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0)) return {
		inputTokens,
		outputTokens,
		totalTokens
	};
}
function providerError(value) {
	const error = isRecord$1(value) && isRecord$1(value.error) ? value.error : isRecord$1(value) ? value : void 0;
	const code = typeof error?.code === "string" ? error.code : void 0;
	const message = typeof error?.message === "string" && error.message.trim() !== "" ? error.message : "Image API request failed.";
	return {
		...code === void 0 ? {} : { code },
		message
	};
}
function safeProviderMessage(status, value) {
	const detail = providerError(value);
	const message = detail.message.toLowerCase();
	return new ImageApiError(detail.message, {
		status,
		...detail.code === void 0 ? {} : { code: detail.code },
		retryable: status === 429 || status >= 500 || message.includes("timeout") || message.includes("temporar")
	});
}
function base64Bytes(value, maximum) {
	const maximumChars = Math.ceil(maximum / 3) * 4 + 8;
	if (value.length === 0 || value.length > maximumChars || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new ImageApiError("Provider returned invalid or oversized image data.");
	const bytes = Buffer.from(value, "base64");
	if (bytes.byteLength === 0 || bytes.byteLength > maximum) throw new ImageApiError("Provider returned invalid or oversized image data.");
	return bytes;
}
async function boundedResponseText(response, maximumBytes, signal, truncate) {
	if (response.body === null) return "";
	const reader = response.body.getReader();
	const chunks = [];
	let totalBytes = 0;
	let reachedEnd = false;
	let cancelled = false;
	const abort = () => {
		reader.cancel(signal.reason).catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) {
				reachedEnd = true;
				break;
			}
			const remaining = maximumBytes - totalBytes;
			if (value.byteLength > remaining) {
				if (truncate && remaining > 0) chunks.push(value.subarray(0, remaining));
				cancelled = true;
				await reader.cancel("response byte limit reached");
				if (!truncate) throw new ImageApiError("Image API response exceeded its byte limit.");
				break;
			}
			chunks.push(value);
			totalBytes += value.byteLength;
		}
	} finally {
		signal.removeEventListener("abort", abort);
		if (!reachedEnd && !cancelled) try {
			await reader.cancel(signal.reason);
		} catch {}
		reader.releaseLock();
	}
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}
async function responseErrorBody(response, signal) {
	const text = await boundedResponseText(response, MAX_ERROR_BYTES, signal, true);
	if (text === "") return {};
	try {
		return JSON.parse(text);
	} catch {
		return { message: text };
	}
}
function ssePayload(chunk) {
	const data = chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
	if (data === "" || data === "[DONE]") return void 0;
	try {
		return JSON.parse(data);
	} catch {
		throw new ImageApiError("Provider returned malformed streaming JSON.", { retryable: true });
	}
}
async function* readSse(body, signal, maximumEventChars, maximumTotalBytes) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let totalBytes = 0;
	let reachedEnd = false;
	const abort = () => {
		reader.cancel(signal.reason).catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) {
				reachedEnd = true;
				break;
			}
			totalBytes += value.byteLength;
			if (totalBytes > maximumTotalBytes) throw new ImageApiError("Image stream exceeded its byte limit.");
			buffer += decoder.decode(value, { stream: true }).replaceAll("\r", "");
			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				if (boundary > maximumEventChars) throw new ImageApiError("Image stream event exceeded its byte limit.");
				const payload$1 = ssePayload(buffer.slice(0, boundary));
				buffer = buffer.slice(boundary + 2);
				if (payload$1 !== void 0) yield payload$1;
				boundary = buffer.indexOf("\n\n");
			}
			if (buffer.length > maximumEventChars) throw new ImageApiError("Image stream event exceeded its byte limit.");
		}
		buffer += decoder.decode().replaceAll("\r", "");
		const payload = ssePayload(buffer.trim());
		if (payload !== void 0) yield payload;
	} finally {
		signal.removeEventListener("abort", abort);
		if (!reachedEnd) try {
			await reader.cancel(signal.reason);
		} catch {}
		reader.releaseLock();
	}
}
async function parsedJson(response, signal, maximumBytes) {
	const text = await boundedResponseText(response, maximumBytes, signal, false);
	if (text === "") return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new ImageApiError("Provider returned malformed image JSON.", { retryable: true });
	}
}
function retryDelay(response, base, attempt) {
	const raw = response?.headers.get("retry-after");
	if (raw !== null && raw !== void 0) {
		const seconds = Number(raw);
		if (Number.isFinite(seconds) && seconds >= 0) return Math.min(3e4, seconds * 1e3);
		const date = Date.parse(raw);
		if (Number.isFinite(date)) return Math.min(3e4, Math.max(0, date - Date.now()));
	}
	return Math.min(1e4, base * 2 ** Math.max(0, attempt - 1));
}
function wait(ms, signal) {
	return new Promise((resolve$1, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve$1();
		}, ms);
		const abort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			reject(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
	});
}
/** Download a provider image URL with bounded size and https-only hops. */
async function downloadImageUrl(url, maxBytes, signal, fetchImpl = fetch) {
	let current = url;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
		let parsed;
		try {
			parsed = new URL(current);
		} catch {
			throw new ImageApiError("Provider returned an invalid image URL.");
		}
		if (parsed.protocol !== "https:") {
			if (!(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")) throw new ImageApiError("Provider image URL must use https.");
		}
		const response = await fetchImpl(current, {
			method: "GET",
			redirect: "manual",
			signal
		});
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			if (location === null) throw new ImageApiError("Provider image URL redirected without a location.");
			current = new URL(location, current).href;
			continue;
		}
		if (!response.ok) throw new ImageApiError(`Provider image download failed with status ${response.status}.`, {
			status: response.status,
			retryable: response.status === 429 || response.status >= 500
		});
		if (response.body === null) throw new ImageApiError("Provider returned an empty image body.");
		const reader = response.body.getReader();
		const chunks = [];
		let totalBytes = 0;
		const abort = () => {
			reader.cancel(signal.reason).catch(() => {});
		};
		signal.addEventListener("abort", abort, { once: true });
		try {
			while (true) {
				signal.throwIfAborted();
				const { done, value } = await reader.read();
				signal.throwIfAborted();
				if (done) break;
				totalBytes += value.byteLength;
				if (totalBytes > maxBytes) {
					await reader.cancel("image byte limit reached");
					throw new ImageApiError("Provider image download exceeded its byte limit.");
				}
				chunks.push(value);
			}
		} finally {
			signal.removeEventListener("abort", abort);
			reader.releaseLock();
		}
		const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		if (bytes.byteLength === 0) throw new ImageApiError("Provider returned an empty image body.");
		return bytes;
	}
	throw new ImageApiError("Provider image URL exceeded the redirect limit.");
}
/** OpenAI-compatible image client with redirect rejection and bounded retries. */
var ImageClient = class {
	endpoint;
	editEndpoint;
	modelsEndpoint;
	fetchImpl;
	constructor(options) {
		this.options = options;
		const baseUrl = validateBaseUrl(options.baseUrl);
		this.endpoint = `${baseUrl}/images/generations`;
		this.editEndpoint = `${baseUrl}/images/edits`;
		this.modelsEndpoint = `${baseUrl}/models`;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}
	/** Discover model ids from `GET /models` (no matching here — see models.ts). */
	async listModelIds(signal) {
		const response = await this.fetchImpl(this.modelsEndpoint, {
			method: "GET",
			redirect: "error",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${this.options.apiKey}`
			},
			signal
		});
		if (!response.ok) throw safeProviderMessage(response.status, await responseErrorBody(response, signal));
		const value = await parsedJson(response, signal, 4 * 1024 * 1024);
		if (!isRecord$1(value) || !Array.isArray(value.data)) return [];
		return value.data.map((entry) => isRecord$1(entry) && typeof entry.id === "string" ? entry.id : void 0).filter((id) => id !== void 0);
	}
	/** Parse one response payload into images, downloading URL results. */
	async imagesFromPayload(value, fallbackFormat, signal) {
		if (!isRecord$1(value) || !Array.isArray(value.data)) throw new ImageApiError("Provider returned no usable image data.", { retryable: true });
		const images = [];
		for (const entry of value.data) {
			if (!isRecord$1(entry)) continue;
			let data;
			let format = outputFormat(entry.output_format, fallbackFormat);
			if (typeof entry.b64_json === "string") data = base64Bytes(entry.b64_json, this.options.maxImageBytes);
			else if (typeof entry.url === "string") data = await downloadImageUrl(entry.url, this.options.maxImageBytes, signal, this.fetchImpl);
			if (data === void 0) continue;
			const size = typeof entry.size === "string" ? entry.size : void 0;
			const quality = typeof entry.quality === "string" ? entry.quality : void 0;
			images.push({
				data,
				format,
				...size === void 0 ? {} : { size },
				...quality === void 0 ? {} : { quality }
			});
		}
		if (images.length === 0) throw new ImageApiError("Provider returned no usable image data.", { retryable: true });
		return images;
	}
	/** One request with retries; `buildBody` returns the JSON body and URL flag. */
	async withRetries(path, headers, body, signal, onProgress, maximumJsonBytes) {
		let lastError;
		for (let attempt = 1; attempt <= this.options.maxRetries + 1; attempt += 1) {
			signal.throwIfAborted();
			onProgress({
				kind: "requesting",
				attempt
			});
			let response;
			try {
				response = await this.fetchImpl(path, {
					method: "POST",
					redirect: "error",
					headers,
					body,
					signal
				});
				if (!response.ok) throw safeProviderMessage(response.status, await responseErrorBody(response, signal));
				onProgress({
					kind: "generating",
					attempt
				});
				return response;
			} catch (error) {
				if (signal.aborted) throw signal.reason;
				lastError = error;
				if (!(error instanceof ImageApiError ? error.retryable : true) || attempt > this.options.maxRetries) throw error;
				onProgress({
					kind: "retrying",
					attempt
				});
				await wait(retryDelay(response, this.options.retryBaseMs, attempt), signal);
			}
		}
		throw lastError;
	}
	/** Text-to-image: `POST /images/generations`. */
	async generate(request, signal, onProgress) {
		const baseBody = {
			model: request.model,
			prompt: request.prompt,
			n: request.n,
			response_format: "b64_json",
			...request.size === void 0 ? {} : { size: request.size },
			...request.quality === void 0 ? {} : { quality: request.quality },
			...request.stream === true ? { stream: true } : {},
			...request.extra ?? {}
		};
		const headers = {
			accept: request.stream === true ? "text/event-stream" : "application/json",
			authorization: `Bearer ${this.options.apiKey}`,
			"content-type": "application/json"
		};
		const maximumJsonBytes = Math.ceil(this.options.maxImageBytes * request.n / 3) * 4 + 65536;
		let value;
		let response = await this.withRetries(this.endpoint, headers, JSON.stringify(baseBody), signal, onProgress, maximumJsonBytes);
		if (request.stream === true && (response.headers.get("content-type") ?? "").includes("text/event-stream")) {
			const streamed = await this.fromStream(response, request, signal, onProgress);
			return {
				images: streamed.images,
				...streamed.usage === void 0 ? {} : { usage: streamed.usage }
			};
		}
		value = await parsedJson(response, signal, maximumJsonBytes);
		const parsedUsage = usage(isRecord$1(value) ? value.usage : void 0);
		return {
			images: await this.imagesFromPayload(value, request.outputFormat, signal),
			...parsedUsage === void 0 ? {} : { usage: parsedUsage }
		};
	}
	/** Parse an SSE stream into images, surfacing partial frames via onProgress. */
	async fromStream(response, request, signal, onProgress) {
		if (response.body === null) throw new ImageApiError("Provider returned an empty image stream.", { retryable: true });
		const maximumEventChars = Math.ceil(this.options.maxImageBytes / 3) * 4 + 16384;
		const maximumTotalBytes = maximumEventChars * 8 + 65536;
		const images = [];
		let overallUsage;
		let attempt = 1;
		for await (const raw of readSse(response.body, signal, maximumEventChars, maximumTotalBytes)) {
			if (!isRecord$1(raw)) continue;
			if (raw.type === "error") throw safeProviderMessage(502, raw);
			if (raw.type === "image_generation.partial_image" && typeof raw.b64_json === "string") {
				base64Bytes(raw.b64_json, this.options.maxImageBytes);
				onProgress({
					kind: "partial",
					attempt,
					index: typeof raw.partial_image_index === "number" ? raw.partial_image_index : 0,
					format: outputFormat(raw.output_format, request.outputFormat),
					data: raw.b64_json
				});
			}
			if (raw.type === "image_generation.completed" && typeof raw.b64_json === "string") {
				images.push({
					data: base64Bytes(raw.b64_json, this.options.maxImageBytes),
					format: outputFormat(raw.output_format, request.outputFormat),
					...typeof raw.size === "string" ? { size: raw.size } : {},
					...typeof raw.quality === "string" ? { quality: raw.quality } : {}
				});
				overallUsage = usage(raw.usage) ?? overallUsage;
			}
		}
		if (images.length === 0) throw new ImageApiError("Provider ended the image stream before completion.", { retryable: true });
		return {
			images,
			...overallUsage === void 0 ? {} : { usage: overallUsage }
		};
	}
	/** Image-to-image: `POST /images/edits` with multipart form data. */
	async edit(request, references, signal, onProgress) {
		const form = new FormData();
		for (const reference of references) form.append("image", new Blob([reference.data], { type: reference.mediaType }), reference.filename);
		form.append("model", request.model);
		form.append("prompt", request.prompt);
		if (request.size !== void 0) form.append("size", request.size);
		if (request.quality !== void 0) form.append("quality", request.quality);
		form.append("n", String(request.n));
		form.append("response_format", "b64_json");
		if (request.extra !== void 0) {
			for (const [key, value$1] of Object.entries(request.extra)) if (typeof value$1 === "string" || typeof value$1 === "number" || typeof value$1 === "boolean") form.append(key, String(value$1));
		}
		const headers = {
			accept: "application/json",
			authorization: `Bearer ${this.options.apiKey}`
		};
		const maximumJsonBytes = Math.ceil(this.options.maxImageBytes * request.n / 3) * 4 + 65536;
		const value = await parsedJson(await this.withRetries(this.editEndpoint, headers, form, signal, onProgress, maximumJsonBytes), signal, maximumJsonBytes);
		const parsedUsage = usage(isRecord$1(value) ? value.usage : void 0);
		return {
			images: await this.imagesFromPayload(value, request.outputFormat, signal),
			...parsedUsage === void 0 ? {} : { usage: parsedUsage }
		};
	}
};

//#endregion
//#region src/config.ts
/** Settings document namespace owned by this plugin. */
const IMAGEN_SETTINGS_NAMESPACE = settingsNamespace("imagen");
/** Configuration schema with the documented defaults. */
const Config = z.object({
	sources: z.dict(z.object({
		baseUrl: z.string(),
		credential: z.string(),
		model: z.string()
	})).default({}),
	defaultSource: z.string(),
	save: z.object({
		enabled: z.boolean().default(true),
		dir: z.string().default("generated-images"),
		nameTemplate: z.string().default("{prompt}-{timestamp}")
	}),
	discovery: z.object({
		enabled: z.boolean().default(true),
		extraPatterns: z.array(z.string()).default([]),
		cacheTtlMs: z.number().default(3e5)
	}),
	defaults: z.object({
		size: z.string(),
		quality: z.string(),
		outputFormat: z.union([
			"png",
			"jpeg",
			"webp"
		]).default("png"),
		n: z.number().min(1).max(4).step(1).default(1)
	}),
	limits: z.object({
		timeoutMs: z.number().min(1e4).max(6e5).step(1).default(12e4),
		maxRetries: z.number().min(0).max(5).step(1).default(2),
		retryBaseMs: z.number().min(100).max(3e4).step(1).default(1e3),
		maxConcurrent: z.number().min(1).max(8).step(1).default(2),
		maxImageBytes: z.number().min(65536).max(268435456).step(1).default(2e7),
		maxReferenceBytes: z.number().min(16384).max(268435456).step(1).default(1e7)
	})
});
const DEFAULT_OUTPUT_FORMAT = "png";
const VALID_QUALITY = new Set([
	"auto",
	"low",
	"medium",
	"high"
]);
/** Validate one source definition; returns the normalized source or throws. */
function resolveSource(value) {
	const baseUrl = validateBaseUrl(value.baseUrl);
	let credential;
	try {
		credential = credentialRef(value.credential.trim());
	} catch (error) {
		throw new TypeError(`source.credential "${value.credential}" is not a valid credential reference`, { cause: error });
	}
	const model = value.model?.trim();
	if (model !== void 0 && model.length === 0) throw new TypeError("source.model must not be empty when provided");
	return {
		baseUrl,
		credential,
		...model === void 0 || model === "" ? {} : { model }
	};
}
/**
* Validate and normalize a config object (partial inputs receive the same
* defaults the schemastery schema applies). Configuration mistakes fail loud
* at plugin load.
* @param config - parsed config with defaults applied.
* @returns the fully defaulted, validated configuration.
*/
function resolveConfig(config = {}) {
	const sources = {};
	const rawSources = config.sources ?? {};
	for (const [name$1, source] of Object.entries(rawSources)) {
		if (name$1.trim() === "") throw new TypeError("source names must not be empty");
		sources[name$1] = resolveSource(source);
	}
	const save = config.save ?? {};
	const discovery = config.discovery ?? {};
	const defaults = config.defaults ?? {};
	const limits = config.limits ?? {};
	const saveDir = (save.dir ?? "generated-images").trim();
	if (saveDir === "" || saveDir === "." || saveDir === ".." || saveDir.includes("..")) throw new TypeError("save.dir must be a plain relative directory inside the workspace");
	const nameTemplate = (save.nameTemplate ?? "{prompt}-{timestamp}").trim();
	if (nameTemplate === "") throw new TypeError("save.nameTemplate must not be empty");
	const extraPatterns = (discovery.extraPatterns ?? []).map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
	const size = defaults.size?.trim();
	if (size !== void 0 && size !== "" && !/^(\d{2,4})x(\d{2,4})$/.test(size)) throw new TypeError("defaults.size must be auto or WIDTHxHEIGHT");
	const quality = defaults.quality?.trim();
	if (quality !== void 0 && quality !== "" && !VALID_QUALITY.has(quality)) throw new TypeError("defaults.quality must be one of auto, low, medium, high");
	const outputFormat$1 = defaults.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
	const n = defaults.n ?? 1;
	if (!Number.isInteger(n) || n < 1 || n > 4) throw new TypeError("defaults.n must be an integer between 1 and 4");
	const defaultSource = config.defaultSource?.trim();
	if (defaultSource !== void 0 && defaultSource !== "" && Object.keys(sources).length > 0 && sources[defaultSource] === void 0) throw new TypeError(`defaultSource "${defaultSource}" is not a configured source`);
	const timeoutMs = limits.timeoutMs ?? 12e4;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1e4 || timeoutMs > 6e5) throw new TypeError("limits.timeoutMs must be an integer between 10000 and 600000");
	const maxRetries = limits.maxRetries ?? 2;
	if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new TypeError("limits.maxRetries must be an integer between 0 and 5");
	const retryBaseMs = limits.retryBaseMs ?? 1e3;
	if (!Number.isInteger(retryBaseMs) || retryBaseMs < 100 || retryBaseMs > 3e4) throw new TypeError("limits.retryBaseMs must be an integer between 100 and 30000");
	const maxConcurrent = limits.maxConcurrent ?? 2;
	if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8) throw new TypeError("limits.maxConcurrent must be an integer between 1 and 8");
	const maxImageBytes = limits.maxImageBytes ?? 2e7;
	if (!Number.isInteger(maxImageBytes) || maxImageBytes < 65536 || maxImageBytes > 268435456) throw new TypeError("limits.maxImageBytes must be an integer between 65536 and 268435456");
	const maxReferenceBytes = limits.maxReferenceBytes ?? 1e7;
	if (!Number.isInteger(maxReferenceBytes) || maxReferenceBytes < 16384 || maxReferenceBytes > 268435456) throw new TypeError("limits.maxReferenceBytes must be an integer between 16384 and 268435456");
	const cacheTtlMs = discovery.cacheTtlMs ?? 3e5;
	if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 1e3 || cacheTtlMs > 36e5) throw new TypeError("discovery.cacheTtlMs must be an integer between 1000 and 3600000");
	return {
		sources,
		...defaultSource !== void 0 && defaultSource !== "" ? { defaultSource } : {},
		save: {
			enabled: save.enabled ?? true,
			dir: saveDir,
			nameTemplate
		},
		discovery: {
			enabled: discovery.enabled ?? true,
			extraPatterns,
			cacheTtlMs
		},
		defaults: {
			...size !== void 0 && size !== "" ? { size } : {},
			...quality !== void 0 && quality !== "" ? { quality } : {},
			outputFormat: outputFormat$1,
			n
		},
		limits: {
			timeoutMs,
			maxRetries,
			retryBaseMs,
			maxConcurrent,
			maxImageBytes,
			maxReferenceBytes
		}
	};
}

//#endregion
//#region src/models.ts
/**
* Image-model discovery for OpenAI-compatible endpoints: list `GET /models`,
* keep ids that look like image generators (name-pattern matching, no
* hardcoded model lists), and let deployments add their own patterns.
* @module dsh-imagen/models
*/
/** Curated substrings that mark an id as an image generator. */
const IMAGE_TOKENS = [
	"image",
	"img",
	"draw",
	"t2i",
	"i2i",
	"txt2img",
	"img2img",
	"dall",
	"dalle",
	"gpt-image",
	"flux",
	"sdxl",
	"sd3",
	"sd-3",
	"stable",
	"diffusion",
	"imagen",
	"pixart",
	"kolors",
	"cogview",
	"seedream",
	"wanx",
	"wan2",
	"wan-2",
	"hunyuan-image",
	"jimeng",
	"doubao",
	"recraft",
	"ideogram",
	"leonardo",
	"playground",
	"firefly",
	"photoreal",
	"pixel-art",
	"midjourney",
	"nano-banana",
	"gemini-image",
	"art-gen",
	"agnes-image",
	"step-image",
	"qwen-image"
];
/** Substrings that positively mark a model as NOT an image generator. */
const EXCLUDE_TOKENS = [
	"vision",
	"understand",
	"vlm",
	"ocr",
	"chat",
	"embed",
	"rerank",
	"whisper",
	"tts",
	"asr",
	"caption",
	"describe",
	"audio",
	"video",
	"rerank",
	"instruct",
	"agent",
	"tool",
	"reasoning"
];
function hasToken(value, tokens) {
	const lower = value.toLowerCase();
	return tokens.some((token) => lower.includes(token));
}
/** Whether a model id should be treated as an image generator. */
function matchesImageModel(id, extraPatterns = []) {
	if (id.trim() === "") return false;
	if (hasToken(id, EXCLUDE_TOKENS)) return false;
	if (hasToken(id, IMAGE_TOKENS)) return true;
	if (extraPatterns.length > 0) for (const pattern of extraPatterns) try {
		if (new RegExp(pattern, "i").test(id)) return true;
	} catch {}
	return false;
}
/** Filter and sort a raw `GET /models` id list into image model ids. */
function discoverImageModels(ids, extraPatterns = []) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const id of ids) {
		if (typeof id !== "string" || seen.has(id)) continue;
		seen.add(id);
		if (matchesImageModel(id, extraPatterns)) result.push(id);
	}
	return result.sort();
}
/** Parse the common `{data: [{id, ...}]}` shape of an OpenAI-compatible models list. */
function modelIdsFromPayload(value) {
	if (typeof value !== "object" || value === null) return [];
	const data = value.data;
	if (!Array.isArray(data)) return [];
	const ids = [];
	for (const entry of data) if (typeof entry === "object" && entry !== null) {
		const id = entry.id;
		if (typeof id === "string" && id !== "") ids.push(id);
	}
	return ids;
}

//#endregion
//#region src/save.ts
/** Normalize a prompt into a filesystem-safe slug (empty input → `image`). */
function slugify(value, maximum = 40) {
	return value.normalize("NFKD").replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, maximum).toLowerCase() || "image";
}
/** Timestamp in the compact `YYYYMMDD-HHMMSS` form. */
function timestampLabel(date = /* @__PURE__ */ new Date()) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
/** Render a naming template (`{prompt}`, `{timestamp}`) into a stem. */
function renderNameTemplate(template, prompt, date = /* @__PURE__ */ new Date()) {
	return template.replace(/\{prompt\}/gu, slugify(prompt)).replace(/\{timestamp\}/gu, timestampLabel(date)).replace(/[\\/:*?"<>|]+/gu, "-");
}
function extensionOf(format) {
	return format === "jpeg" ? "jpg" : format;
}
/** Assert `candidate` resolves strictly inside `root`; throws otherwise. */
function assertInside(root, candidate) {
	const absolute = resolve(candidate);
	const base = resolve(root);
	if (absolute !== base && !absolute.startsWith(base + sep)) throw new Error(`path escapes the workspace: ${absolute}`);
	return absolute;
}
/** Resolve and validate the save directory inside a workspace. */
function resolveSaveDir(workspace, dir) {
	const resolved = assertInside(workspace, join(workspace, dir));
	if (resolved === resolve(workspace)) throw new Error("save.dir must not resolve to the workspace root itself");
	return resolved;
}
/**
* Find the first non-colliding absolute path for `stem.ext` inside `dir`,
* appending `-2`, `-3`, … when the name is already taken.
*/
async function uniquePath(dir, stem, format) {
	const extension = extensionOf(format);
	let candidate = join(dir, `${stem}.${extension}`);
	let index = 2;
	while (true) try {
		await mkdir(dirname(candidate), { recursive: true });
		await (await import("node:fs/promises").then((m) => m.open(candidate, "wx"))).close();
		return candidate;
	} catch (error) {
		if (error.code === "EEXIST") {
			candidate = join(dir, `${stem}-${index}.${extension}`);
			index += 1;
			continue;
		}
		throw error;
	}
}
/** Atomically write bytes to `path` via a sibling temp file + rename. */
async function atomicWrite(path, data) {
	const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(temp, data);
	await rename(temp, path);
}
/**
* Claim a unique path inside `dir` and write `data` atomically.
* @returns the absolute path, the workspace-relative path and byte count.
*/
async function saveImageFile(workspace, dir, prompt, template, format, data, explicitName) {
	const path = await uniquePath(resolveSaveDir(workspace, dir), explicitName !== void 0 && explicitName !== "" ? slugify(explicitName, 64) : renderNameTemplate(template, prompt), format);
	await atomicWrite(path, data);
	return {
		path,
		relPath: relative(resolve(workspace), path).split(sep).join("/"),
		bytes: data.byteLength
	};
}

//#endregion
//#region src/probe.ts
function u16(bytes, offset) {
	return (bytes[offset] << 8 | bytes[offset + 1]) >>> 0;
}
function u32(bytes, offset) {
	return (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
}
function ascii(bytes, offset, length) {
	let out = "";
	for (let index = 0; index < length; index += 1) out += String.fromCharCode(bytes[offset + index]);
	return out;
}
function pngDimensions(bytes) {
	if (bytes.length < 24) return void 0;
	const signature = [
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	];
	for (let index = 0; index < signature.length; index += 1) if (bytes[index] !== signature[index]) return void 0;
	if (ascii(bytes, 12, 4) !== "IHDR") return void 0;
	return {
		width: u32(bytes, 16),
		height: u32(bytes, 20)
	};
}
function jpegDimensions(bytes) {
	if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return void 0;
	let offset = 2;
	while (offset + 9 < bytes.length) {
		if (bytes[offset] !== 255) {
			offset += 1;
			continue;
		}
		const marker = bytes[offset + 1];
		if (marker === 216 || marker >= 208 && marker <= 215 || marker === 1) {
			offset += 2;
			continue;
		}
		if (marker === 217 || marker === 218) return void 0;
		const length = u16(bytes, offset + 2);
		if (length < 2) return void 0;
		if ((marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207) && offset + 9 < bytes.length) return {
			height: u16(bytes, offset + 5),
			width: u16(bytes, offset + 7)
		};
		offset += 2 + length;
	}
}
function webpDimensions(bytes) {
	if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return void 0;
	const chunk = ascii(bytes, 12, 4);
	if (chunk === "VP8 " && bytes.length >= 30) return {
		width: u16(bytes, 26) & 16383,
		height: u16(bytes, 28) & 16383
	};
	if (chunk === "VP8L" && bytes.length >= 25) {
		const bits = (bytes[21] | bytes[22] << 8 | bytes[23] << 16 | bytes[24] << 24) >>> 0;
		return {
			width: (bits & 16383) + 1,
			height: (bits >> 14 & 16383) + 1
		};
	}
	if (chunk === "VP8X" && bytes.length >= 30) {
		const bits = (bytes[24] | bytes[25] << 8 | bytes[26] << 16 | bytes[27] << 24) >>> 0;
		return {
			width: (bits & 16777215) + 1,
			height: (bits >> 24 & 16777215) + 1
		};
	}
}
function gifDimensions(bytes) {
	if (bytes.length < 10 || ascii(bytes, 0, 3) !== "GIF") return void 0;
	return {
		width: u16(bytes, 6),
		height: u16(bytes, 8)
	};
}
/** Probe image dimensions from header bytes; `undefined` when unrecognized. */
function probeDimensions(bytes) {
	if (bytes.length < 12) return void 0;
	return pngDimensions(bytes) ?? jpegDimensions(bytes) ?? webpDimensions(bytes) ?? gifDimensions(bytes);
}
/** Best-effort media type from header bytes; defaults to `application/octet-stream`. */
function sniffMediaType(bytes) {
	if (bytes.length >= 8) {
		if (bytes[0] === 137 && ascii(bytes, 1, 3) === "PNG") return "image/png";
		if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
		if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
		if (ascii(bytes, 0, 3) === "GIF") return "image/gif";
	}
	return "application/octet-stream";
}
/** Map an output format to its media type. */
function mediaTypeOf(format) {
	return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

//#endregion
//#region src/types.ts
/**
* Shared vocabulary between the Host tool and the browser card.
* @module dsh-imagen/types
*/
/** Schema tag of the canonical tool result. */
const RESULT_SCHEMA = "dsh.imagen.result.v1";
/** Schema tag carried in `presentationMeta` so the browser card can replay. */
const PRESENTATION_SCHEMA = "dsh.imagen.presentation.v1";
/** Schema tag of the marker JSON embedded in the rendered text (Code Mode replay). */
const REFERENCE_SCHEMA = "dsh.imagen.reference.v1";
/** Marker prefix written before the JSON reference line in rendered text. */
const REFERENCE_MARKER = "\n@dsh-imagen:";

//#endregion
//#region src/index.ts
/** Cordis plugin name. */
const name = "imagen";
/** Required Host services. */
const inject = [
	"tools",
	"credentials",
	"connection",
	"sessionPersistence"
];
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeString(value, maximum) {
	return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : void 0;
}
function referenceValue(value) {
	return {
		schema: REFERENCE_SCHEMA,
		callId: value.callId,
		source: value.source,
		model: value.model,
		images: value.images,
		savedTo: value.savedTo,
		...value.size === void 0 ? {} : { size: value.size },
		...value.quality === void 0 ? {} : { quality: value.quality },
		outputFormat: value.outputFormat,
		elapsedMs: value.elapsedMs,
		...value.usage === void 0 ? {} : { usage: value.usage }
	};
}
function referenceFromText(value) {
	if (typeof value !== "string") return void 0;
	const start = value.indexOf(REFERENCE_MARKER);
	if (start < 0) return void 0;
	const line = value.slice(start + REFERENCE_MARKER.length).split("\n", 1)[0];
	if (line === void 0 || line.length > 8192) return void 0;
	try {
		const parsed = JSON.parse(line);
		if (!isRecord(parsed) || parsed.schema !== REFERENCE_SCHEMA || typeof parsed.callId !== "string" || !Array.isArray(parsed.images)) return;
		return parsed;
	} catch {
		return;
	}
}
function referenceFromContent(content) {
	if (!Array.isArray(content)) return void 0;
	for (const block of content) {
		if (!isRecord(block) || block.type !== "text") continue;
		const parsed = referenceFromText(block.text);
		if (parsed !== void 0) return parsed;
	}
}
/** Paths a session is authorized to read for one generation call. */
function authorizedPaths(events, callId) {
	const paths = /* @__PURE__ */ new Set();
	for (const event of events) {
		if (!isRecord(event) || !isRecord(event.data)) continue;
		if (event.type === "tool/result") {
			const meta = isRecord(event.data.meta) && event.data.meta.schema === PRESENTATION_SCHEMA ? event.data.meta : void 0;
			const result = isRecord(meta?.result) && meta.result.callId === callId ? meta.result : void 0;
			if (result !== void 0 && Array.isArray(result.images)) {
				for (const image of result.images) if (isRecord(image) && typeof image.path === "string") paths.add(image.path);
			}
		}
		if (event.type === "tool/code-dispatch" && event.data.name === "generate_image" && event.data.subCallId === callId) {
			const marker = referenceFromContent(event.data.content);
			if (marker !== void 0) for (const image of marker.images) paths.add(image.path);
		}
	}
	return [...paths];
}
function progressOf(entry) {
	if (entry === void 0) return {
		state: "missing",
		revision: 0,
		attempt: 0,
		startedAt: 0
	};
	return {
		state: entry.state,
		revision: entry.revision,
		attempt: entry.attempt,
		startedAt: entry.startedAt,
		...entry.source === void 0 ? {} : { source: entry.source },
		...entry.model === void 0 ? {} : { model: entry.model },
		...entry.partial === void 0 ? {} : { partial: entry.partial }
	};
}
function rpcError(message) {
	return {
		ok: false,
		error: {
			code: "internal",
			message,
			details: {}
		}
	};
}
function isImageMime(value) {
	return value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/gif";
}
/** Narrow a model-supplied `[image attachment 鈥` JSON into a typed ref. */
function parseAttachmentRef(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("reference_images.attachment must be the JSON of an [image attachment 鈥 note");
	}
	if (!isRecord(parsed)) throw new Error("reference_images.attachment must be the JSON of an [image attachment 鈥 note");
	const attachmentId = safeString(parsed.attachmentId, 512);
	if (attachmentId === void 0 || !isImageMime(parsed.mediaType)) throw new Error("reference_images.attachment must include a valid attachmentId and mediaType");
	return {
		attachmentId,
		mediaType: parsed.mediaType
	};
}
/** Register the image tools, the settings section and the loopback channel. */
function apply(ctx, config = {}) {
	if (Object.keys(config.sources ?? {}).length > 0) resolveConfig(config);
	let current = () => config;
	installSettingsSection(ctx, IMAGEN_SETTINGS_NAMESPACE, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {},
		validate: (value) => {
			if (Object.keys(value.sources ?? {}).length > 0) resolveConfig(value);
		}
	});
	const spec = () => resolveConfig(current());
	const active = /* @__PURE__ */ new Map();
	const savedRegistry = /* @__PURE__ */ new Map();
	const modelCache = /* @__PURE__ */ new Map();
	const inFlight = /* @__PURE__ */ new Set();
	const lifetime = new AbortController();
	let stopping = false;
	const keyOf = (sessionId, callId) => `${sessionId}\u0000${callId}`;
	ctx.effect(() => async () => {
		stopping = true;
		lifetime.abort(new DOMException("dsh-imagen was unloaded", "AbortError"));
		await Promise.allSettled([...inFlight]);
	}, "imagen: abort and drain active generations");
	ctx.effect(() => ctx.connection.rpc.handle(IMAGEN_RPC_CHANNEL, async (endpoint, payload, signal) => {
		if (!isRecord(payload)) return rpcError("A JSON object is required.");
		const sessionId = safeString(payload.sessionId, 256);
		const callId = safeString(payload.callId, 512);
		if (sessionId === void 0 || callId === void 0) return rpcError("Valid sessionId and callId values are required.");
		if (endpoint === IMAGEN_RPC_ENDPOINT.progress) return {
			ok: true,
			value: progressOf(active.get(keyOf(sessionId, callId)))
		};
		if (endpoint === IMAGEN_RPC_ENDPOINT.image) {
			const path = safeString(payload.path, 4096);
			if (path === void 0) return rpcError("A valid image path is required.");
			let authorized = savedRegistry.get(path)?.sessionId === sessionId && savedRegistry.get(path)?.callId === callId;
			if (!authorized) try {
				authorized = authorizedPaths((await ctx.sessionPersistence.inspect(SessionId(sessionId), signal)).events, callId).includes(path);
			} catch {
				return rpcError("The image session could not be inspected.");
			}
			if (!authorized) return rpcError("The image is not authorized by this session.");
			try {
				const data = await readFile(path);
				if (data.byteLength > spec().limits.maxImageBytes) return rpcError("The saved image exceeds the read limit.");
				const bytes = new Uint8Array(data);
				const dimensions = probeDimensions(bytes);
				return {
					ok: true,
					value: {
						mediaType: sniffMediaType(bytes),
						width: dimensions?.width,
						height: dimensions?.height,
						data: Buffer.from(bytes).toString("base64")
					}
				};
			} catch {
				return rpcError("The saved image could not be read.");
			}
		}
		if (endpoint === IMAGEN_RPC_ENDPOINT.models) {
			const sourceName = safeString(payload.source, 128);
			if (sourceName === void 0) return rpcError("A valid source name is required.");
			try {
				return {
					ok: true,
					value: {
						source: sourceName,
						models: (await discoverForSource(spec(), sourceName, ctx, modelCache, signal)).map((id) => ({
							id,
							discovered: true
						}))
					}
				};
			} catch (error) {
				return rpcError(error instanceof Error ? error.message : "Model discovery failed.");
			}
		}
		return rpcError(`Unknown image generation endpoint: ${endpoint}`);
	}, { authority: "loopback" }), "imagen: loopback progress and image RPC");
	ctx.tools.register(defineTool({
		name: "generate_image",
		description: "Generate images through a user-configured OpenAI-compatible image API. Use this when the user asks to create, draw, render, illustrate, design or edit an image, or to produce a visual for documentation, slides, or a report. Generation runs against one configured `source` (list them with list_image_models when unsure), resolves the model automatically when the source does not pin one, and every produced image is automatically saved into the workspace save directory (default `generated-images/`) unless `save` is set to \"none\". For image editing or style-transfer, pass `reference_images` (existing workspace files, https URLs, or attachment JSON) and the provider's images/edits endpoint is used; the just-generated files from a previous call are valid references via their saved path. The finished image appears in the conversation card with preview and download.",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "Detailed image prompt. Preserve user constraints and describe subject, composition, style, lighting, palette, text, and exclusions as relevant. For edits, describe the desired change relative to the reference image(s)."
			},
			source: {
				type: "string",
				description: "Name of the configured image source (see list_image_models). Defaults to the configured default source."
			},
			model: {
				type: "string",
				description: "Image model id; overrides the source model or auto-discovery. List candidates with list_image_models."
			},
			size: {
				type: "string",
				description: "Requested size, e.g. 1024x1024, 1280x800. Omit for the provider default."
			},
			quality: {
				type: "string",
				enum: [
					"auto",
					"low",
					"medium",
					"high"
				],
				description: "Quality tier. Omit for the provider default."
			},
			output_format: {
				type: "string",
				enum: [
					"png",
					"jpeg",
					"webp"
				],
				description: "Output format. Omit for the configured default (png)."
			},
			n: {
				type: "integer",
				description: "Number of images to generate (1鈥?). Omit for the configured default."
			},
			reference_images: {
				type: "array",
				description: "Optional reference images for image-to-image: each is {path} (workspace-relative or absolute), {url} (https), or {attachment} (the JSON of an [image attachment 鈥 note).",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						path: {
							type: "string",
							description: "Workspace-relative or absolute path of an existing image file."
						},
						url: {
							type: "string",
							description: "https URL of an image."
						},
						attachment: {
							type: "string",
							description: "The JSON of an [image attachment 鈥 note."
						}
					}
				}
			},
			extra: {
				type: "object",
				additionalProperties: true,
				description: "Optional provider-specific passthrough parameters (e.g. negative_prompt, steps, cfg_scale, seed). Values must be strings, numbers, or booleans."
			},
			save: {
				type: "string",
				description: "\"auto\" (default) saves into the configured save directory; \"none\" skips file saving; \"workspace:<rel-dir>\" saves into that directory instead."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					schema: {
						type: "string",
						const: RESULT_SCHEMA,
						required: true
					},
					callId: {
						type: "string",
						required: true
					},
					source: {
						type: "string",
						required: true
					},
					model: {
						type: "string",
						required: true
					},
					prompt: {
						type: "string",
						required: true
					},
					images: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: {
									type: "string",
									required: true
								},
								relPath: {
									type: "string",
									required: true
								},
								mediaType: {
									type: "string",
									enum: [
										"image/png",
										"image/jpeg",
										"image/webp"
									],
									required: true
								},
								format: {
									type: "string",
									enum: [
										"png",
										"jpeg",
										"webp"
									],
									required: true
								},
								bytes: {
									type: "integer",
									required: true
								},
								width: { type: "integer" },
								height: { type: "integer" }
							}
						}
					},
					savedTo: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					size: { type: "string" },
					quality: { type: "string" },
					outputFormat: {
						type: "string",
						enum: [
							"png",
							"jpeg",
							"webp"
						],
						required: true
					},
					elapsedMs: {
						type: "integer",
						required: true
					},
					usage: {
						type: "object",
						additionalProperties: false,
						properties: {
							inputTokens: {
								type: "integer",
								required: true
							},
							outputTokens: {
								type: "integer",
								required: true
							},
							totalTokens: {
								type: "integer",
								required: true
							}
						}
					},
					references: {
						type: "array",
						items: { type: "string" }
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Generated ${value.images.length} image(s) with ${value.model} on ${value.source} (${value.images.map((image) => `${image.width ?? "?"}脳${image.height ?? "?"}`).join(", ")}, ${value.outputFormat.toUpperCase()}, ${(value.elapsedMs / 1e3).toFixed(1)}s). Saved to ${value.savedTo.join(", ") || "no file (save=none)"}.\n${REFERENCE_MARKER}${JSON.stringify(referenceValue(value))}`
			}],
			presentationMeta: (_args, value) => ({
				schema: PRESENTATION_SCHEMA,
				result: value
			})
		},
		finalizeContent(exec, result) {
			if (exec.parent !== void 0 || result.isError) return void 0;
			let changed = false;
			const content = result.content.map((block) => {
				if (block.type !== "text") return block;
				const marker = block.text.indexOf(`\n${REFERENCE_MARKER}`);
				if (marker < 0) return block;
				changed = true;
				return {
					type: "text",
					text: block.text.slice(0, marker)
				};
			});
			return changed ? content : void 0;
		},
		timeoutMs: 6e5,
		isConcurrencySafe: () => true,
		presentCall(args) {
			return {
				card: "generic",
				title: "Generate image",
				kind: "other",
				rawInput: {
					prompt: args.prompt,
					source: args.source,
					size: args.size,
					n: args.n
				}
			};
		},
		presentResult(_args, result) {
			return {
				card: "generic",
				title: result.isError ? "Image generation failed" : "Generated image"
			};
		},
		async execute(args, exec) {
			const sessionId = exec.agent?.session.header.id;
			if (sessionId === void 0) throw new Error("generate_image requires a calling DSH agent session");
			const workspace = exec.agent?.session.header.cwd;
			if (workspace === void 0) throw new Error("generate_image requires a session workspace");
			if (stopping) throw new DOMException("dsh-imagen is stopping", "AbortError");
			const resolved = spec();
			const prompt = args.prompt.trim();
			if (prompt.length === 0 || prompt.length > 32e3) throw new Error("prompt must contain 1鈥?2000 characters");
			if (Buffer.byteLength(prompt, "utf8") > 64e3) throw new Error("prompt must not exceed 64000 UTF-8 bytes");
			const n = args.n ?? resolved.defaults.n;
			if (!Number.isInteger(n) || n < 1 || n > 4) throw new Error("n must be an integer between 1 and 4");
			const sourceNames = Object.keys(resolved.sources);
			if (sourceNames.length === 0) throw new Error("No image source is configured. Add a source in Settings 鈫?鎻掍欢閰嶇疆 鈫?imagen, or in cordis.patch.yml.");
			const sourceName = args.source?.trim() || resolved.defaultSource || sourceNames[0];
			const source = resolved.sources[sourceName];
			if (source === void 0) throw new Error(`Source "${sourceName}" is not configured. Configured sources: ${sourceNames.join(", ")}`);
			const size = args.size?.trim() || resolved.defaults.size;
			const quality = args.quality?.trim() || resolved.defaults.quality;
			const outputFormat$1 = args.output_format ?? resolved.defaults.outputFormat;
			if (active.size >= resolved.limits.maxConcurrent) throw new Error("Too many image generations are already running. Try again after one finishes.");
			const callId = String(exec.callId);
			const operationKey = keyOf(String(sessionId), callId);
			const entry = {
				sessionId: String(sessionId),
				callId,
				revision: 1,
				attempt: 1,
				startedAt: Date.now(),
				state: "requesting",
				source: sourceName
			};
			active.set(operationKey, entry);
			let finishOperation;
			const operationDone = new Promise((resolveDone) => {
				finishOperation = resolveDone;
			});
			inFlight.add(operationDone);
			const requestSignal = AbortSignal.any([
				lifetime.signal,
				exec.signal,
				AbortSignal.timeout(resolved.limits.timeoutMs)
			]);
			try {
				entry.state = "discovering";
				entry.revision += 1;
				const discovered = source.model === void 0 ? await discoverForSource(resolved, sourceName, ctx, modelCache, requestSignal) : void 0;
				const model = args.model?.trim() || source.model || discovered?.[0] || "";
				if (model === "") throw new Error(`No image model is available on source "${sourceName}". Pass model=, pin source.model, or fix model discovery.`);
				entry.model = model;
				entry.revision += 1;
				const apiKey = await resolveApiKey(ctx, source.credential);
				requestSignal.throwIfAborted();
				const client = new ImageClient({
					baseUrl: source.baseUrl,
					apiKey,
					model,
					maxImageBytes: resolved.limits.maxImageBytes,
					maxRetries: resolved.limits.maxRetries,
					retryBaseMs: resolved.limits.retryBaseMs
				});
				let references = [];
				if (Array.isArray(args.reference_images) && args.reference_images.length > 0) {
					references = [];
					for (const reference of args.reference_images) references.push(await loadReference(ctx, workspace, reference, resolved.limits.maxReferenceBytes, requestSignal));
					entry.revision += 1;
				}
				const onProgress = (progress) => {
					entry.revision += 1;
					entry.attempt = progress.attempt;
					if (progress.kind === "requesting" || progress.kind === "retrying") {
						entry.state = "requesting";
						delete entry.partial;
					} else if (progress.kind === "partial") {
						entry.state = "generating";
						entry.partial = {
							index: progress.index,
							format: progress.format,
							data: progress.data
						};
					} else entry.state = "generating";
				};
				const request = {
					prompt,
					model,
					n,
					outputFormat: outputFormat$1,
					...size === void 0 ? {} : { size },
					...quality === void 0 ? {} : { quality },
					...args.extra !== void 0 && args.extra !== null ? { extra: scalarExtra(args.extra) } : {}
				};
				const generated = references.length > 0 ? await client.edit(request, references.map(toReferenceImage), requestSignal, onProgress) : await client.generate(request, requestSignal, onProgress);
				entry.state = "saving";
				entry.revision += 1;
				requestSignal.throwIfAborted();
				const saveMode = parseSaveMode(args.save, resolved);
				const images = [];
				const savedTo = [];
				for (const image of generated.images) {
					const format = image.format;
					const dimensions = probeDimensions(image.data);
					if (saveMode.kind === "auto") {
						const saved = await saveImageFile(workspace, resolved.save.dir, prompt, resolved.save.nameTemplate, format, image.data);
						savedRegistry.set(saved.path, {
							sessionId: String(sessionId),
							callId
						});
						images.push({
							path: saved.path,
							relPath: saved.relPath,
							mediaType: mediaTypeOf(format),
							format,
							bytes: saved.bytes,
							...dimensions === void 0 ? {} : {
								width: dimensions.width,
								height: dimensions.height
							}
						});
						savedTo.push(saved.relPath);
					} else if (saveMode.kind === "dir") {
						const saved = await saveImageFile(workspace, saveMode.dir, prompt, resolved.save.nameTemplate, format, image.data);
						savedRegistry.set(saved.path, {
							sessionId: String(sessionId),
							callId
						});
						images.push({
							path: saved.path,
							relPath: saved.relPath,
							mediaType: mediaTypeOf(format),
							format,
							bytes: saved.bytes,
							...dimensions === void 0 ? {} : {
								width: dimensions.width,
								height: dimensions.height
							}
						});
						savedTo.push(saved.relPath);
					} else images.push({
						path: "",
						relPath: "",
						mediaType: mediaTypeOf(format),
						format,
						bytes: image.data.byteLength,
						...dimensions === void 0 ? {} : {
							width: dimensions.width,
							height: dimensions.height
						}
					});
				}
				requestSignal.throwIfAborted();
				const usage$1 = generated.usage;
				return {
					schema: RESULT_SCHEMA,
					callId,
					source: sourceName,
					model,
					prompt,
					images,
					savedTo,
					...size === void 0 ? {} : { size },
					...quality === void 0 ? {} : { quality },
					outputFormat: outputFormat$1,
					elapsedMs: Math.max(0, Date.now() - entry.startedAt),
					...usage$1 === void 0 ? {} : { usage: usage$1 },
					...references.length > 0 ? { references: references.map((reference) => reference.filename) } : {}
				};
			} catch (error) {
				if (error instanceof ImageApiError) ctx.logger.warn(`generate_image provider failure${error.status === void 0 ? "" : ` (${error.status})`}: ${error.message}`);
				throw error;
			} finally {
				active.delete(operationKey);
				finishOperation?.();
				inFlight.delete(operationDone);
			}
		}
	}));
	ctx.tools.register(defineTool({
		name: "list_image_models",
		description: "List the image models available on a configured source. Use this to discover which models an image source offers (auto-detected via GET /v1/models plus any models pinned in configuration), so generate_image can target a specific model.",
		parameters: { source: {
			type: "string",
			description: "Name of the configured image source. Defaults to the configured default source."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					source: {
						type: "string",
						required: true
					},
					models: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: {
									type: "string",
									required: true
								},
								discovered: {
									type: "boolean",
									required: true
								}
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Image models on ${value.source}: ${value.models.map((model) => model.id).join(", ") || "(none discovered)"}`
			}]
		},
		presentCall(args) {
			return {
				card: "generic",
				title: "List image models",
				kind: "read",
				rawInput: args
			};
		},
		async execute(args, exec) {
			const resolved = spec();
			const sourceNames = Object.keys(resolved.sources);
			if (sourceNames.length === 0) throw new Error("No image source is configured.");
			const sourceName = args.source?.trim() || resolved.defaultSource || sourceNames[0];
			if (resolved.sources[sourceName] === void 0) throw new Error(`Source "${sourceName}" is not configured. Configured sources: ${sourceNames.join(", ")}`);
			return {
				source: sourceName,
				models: (await discoverForSource(resolved, sourceName, ctx, modelCache, AbortSignal.any([
					lifetime.signal,
					exec.signal,
					AbortSignal.timeout(resolved.limits.timeoutMs)
				]))).map((id) => ({
					id,
					discovered: true
				}))
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "save_generated_image",
		description: "Copy an existing generated image file (or any workspace image) to another workspace location. Use this when the user asks to store a specific generated image somewhere specific, e.g. docs/cover.png. The source must be inside the session workspace. Collisions are auto-numbered unless overwrite is true.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "Absolute or workspace-relative path of the existing image file to copy."
			},
			target: {
				type: "string",
				description: "Workspace-relative destination directory or file path. Defaults to the configured save directory."
			},
			overwrite: {
				type: "boolean",
				description: "Allow overwriting the destination file when target names an existing file (default false)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					relPath: {
						type: "string",
						required: true
					},
					bytes: {
						type: "integer",
						required: true
					},
					overwritten: {
						type: "boolean",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Saved image to ${value.relPath} (${value.bytes} bytes).`
			}]
		},
		presentCall(args) {
			return {
				card: "generic",
				title: "Save image",
				kind: "write",
				rawInput: args
			};
		},
		async execute(args, exec) {
			const sessionId = exec.agent?.session.header.id;
			if (sessionId === void 0) throw new Error("save_generated_image requires a calling DSH agent session");
			const workspace = exec.agent?.session.header.cwd;
			if (workspace === void 0) throw new Error("save_generated_image requires a session workspace");
			const resolved = spec();
			const source = await readFile(isAbsolute(args.path) ? assertInside(workspace, args.path) : assertInside(workspace, resolve(workspace, args.path)));
			const bytes = new Uint8Array(source);
			if (bytes.byteLength === 0) throw new Error("the source image is empty");
			const format = formatFromBytes(bytes);
			const target = args.target?.trim();
			let destPath;
			let overwritten = false;
			if (target !== void 0 && /\.(png|jpe?g|webp)$/i.test(target) && !target.includes("/") && !target.includes("\\")) destPath = assertInside(workspace, resolve(workspace, target));
			else destPath = (await saveImageFile(workspace, target !== void 0 && target !== "" ? target : resolved.save.dir, "", resolved.save.nameTemplate, format, bytes)).path;
			try {
				await import("node:fs/promises").then((m) => m.access(destPath));
				throw new Error(`destination already exists: ${relativePath(workspace, destPath)} (pass overwrite: true to replace it)`);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			await import("node:fs/promises").then((m) => m.writeFile(destPath, bytes));
			savedRegistry.set(destPath, {
				sessionId: String(sessionId),
				callId: String(exec.callId)
			});
			return {
				path: destPath,
				relPath: relativePath(workspace, destPath),
				bytes: bytes.byteLength,
				overwritten
			};
		}
	}));
}
/** Resolve a source's credential through the DSH credentials seam. */
async function resolveApiKey(ctx, ref) {
	const credentials = ctx.get("credentials");
	if (credentials === void 0) throw new Error("No credentials service is mounted; configure a DSH credential for this source.");
	const resolved = await credentials.resolve(ref);
	if (resolved === void 0) throw new Error(`No credential is configured for ${String(ref)}. Store it in DSH credentials before generating.`);
	return resolved.value;
}
/** Discover (and cache) the image model ids of a source. */
async function discoverForSource(resolved, sourceName, ctx, cache, signal) {
	const source = resolved.sources[sourceName];
	if (source === void 0) throw new Error(`Source "${sourceName}" is not configured.`);
	if (source.model !== void 0) return [source.model];
	if (!resolved.discovery.enabled) throw new Error(`Source "${sourceName}" pins no model and model discovery is disabled; configure source.model or enable discovery.`);
	const cached = cache.get(sourceName);
	if (cached !== void 0 && Date.now() - cached.at < resolved.discovery.cacheTtlMs) {
		if (cached.models.length === 0) throw new Error(`No image models were discovered on source "${sourceName}". Configure source.model or add discovery.extraPatterns.`);
		return cached.models;
	}
	const apiKey = await resolveApiKey(ctx, source.credential);
	const discovered = discoverImageModels(await new ImageClient({
		baseUrl: source.baseUrl,
		apiKey,
		model: source.model ?? "",
		maxImageBytes: resolved.limits.maxImageBytes,
		maxRetries: resolved.limits.maxRetries,
		retryBaseMs: resolved.limits.retryBaseMs
	}).listModelIds(signal), resolved.discovery.extraPatterns);
	cache.set(sourceName, {
		models: discovered,
		at: Date.now()
	});
	if (discovered.length === 0) throw new Error(`No image models were discovered on source "${sourceName}". Configure source.model or add discovery.extraPatterns.`);
	return discovered;
}
/** Load one reference image (path / url / attachment) with size bounds. */
async function loadReference(ctx, workspace, reference, maxBytes, signal) {
	if (reference.path !== void 0) {
		const abs = isAbsolute(reference.path) ? assertInside(workspace, reference.path) : assertInside(workspace, resolve(workspace, reference.path));
		const data = await readFile(abs);
		if (data.byteLength === 0) throw new Error(`reference image is empty: ${reference.path}`);
		if (data.byteLength > maxBytes) throw new Error(`reference image exceeds the ${maxBytes} byte limit: ${reference.path}`);
		const bytes = new Uint8Array(data);
		return {
			data: bytes,
			filename: abs.split(/[\\/]/u).pop() ?? "reference",
			mediaType: sniffMediaType(bytes)
		};
	}
	if (reference.url !== void 0) {
		const url = new URL(reference.url);
		const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
		if (url.protocol !== "https:" && !loopback) throw new Error("reference image URLs must use https.");
		const bytes = await downloadImageUrl(reference.url, maxBytes, signal);
		return {
			data: bytes,
			filename: url.pathname.split("/").pop() || "reference",
			mediaType: sniffMediaType(bytes)
		};
	}
	if (reference.attachment !== void 0) {
		const parsed = parseAttachmentRef(reference.attachment);
		const attachments = ctx.get("attachments");
		if (attachments === void 0) throw new Error("no attachment service is mounted; pass a file path or URL instead");
		const stored = await attachments.readImage({
			attachmentId: parsed.attachmentId,
			mediaType: parsed.mediaType,
			bytes: 0,
			width: 0,
			height: 0
		}, signal);
		if (stored.data.byteLength > maxBytes) throw new Error("reference attachment exceeds the byte limit");
		return {
			data: new Uint8Array(stored.data),
			filename: stored.ref.name ?? "reference",
			mediaType: stored.ref.mediaType
		};
	}
	throw new Error("each reference_images entry needs exactly one of path, url, or attachment");
}
function toReferenceImage(reference) {
	return reference;
}
/** Interpret the `save` argument. */
function parseSaveMode(save, resolved) {
	if (save === void 0 || save === "auto") return resolved.save.enabled ? { kind: "auto" } : { kind: "none" };
	if (save === "none") return { kind: "none" };
	if (save.startsWith("workspace:")) {
		const dir = save.slice(10).trim();
		if (dir === "" || dir === "." || dir === ".." || dir.includes("..")) throw new Error("save must be \"auto\", \"none\", or \"workspace:<relative-dir>\"");
		return {
			kind: "dir",
			dir
		};
	}
	throw new Error("save must be \"auto\", \"none\", or \"workspace:<relative-dir>\"");
}
function relativePath(workspace, path) {
	return relative(workspace, path).split(sep).join("/");
}
/** Keep only scalar passthrough values (strings, numbers, booleans). */
function scalarExtra(extra) {
	const result = {};
	for (const [key, value] of Object.entries(extra)) if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") result[key] = value;
	return result;
}
function formatFromBytes(bytes) {
	const mediaType = sniffMediaType(bytes);
	if (mediaType === "image/png") return "png";
	if (mediaType === "image/webp") return "webp";
	if (mediaType === "image/jpeg") return "jpeg";
	throw new Error("unsupported image type (expected PNG, JPEG, WebP, or GIF)");
}

//#endregion
export { Config, IMAGEN_SETTINGS_NAMESPACE, ImageApiError, ImageClient, PRESENTATION_SCHEMA, REFERENCE_MARKER, REFERENCE_SCHEMA, RESULT_SCHEMA, apply, assertInside, atomicWrite, discoverImageModels, downloadImageUrl, inject, matchesImageModel, modelIdsFromPayload, name, probeDimensions, renderNameTemplate, resolveConfig, resolveSaveDir, saveImageFile, slugify, sniffMediaType, uniquePath, validateBaseUrl };