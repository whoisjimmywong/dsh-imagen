window.__ModuleLoader__.load({ id: "dsh-imagen", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react = require("react");
react = __toESM(react);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region src/rpc.ts
/** Private loopback RPC names shared by the Host and browser halves. */
const IMAGEN_RPC_CHANNEL = "/dsh-imagen";
/** Versioned endpoints: live progress, durable image reads, model listing, config. */
const IMAGEN_RPC_ENDPOINT = {
	progress: "imagen/progress",
	image: "imagen/image",
	models: "imagen/models",
	settingsGet: "imagen/settings/get",
	settingsSet: "imagen/settings/set"
};

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
//#region src/client/styles.ts
/** Scoped styles for the dsh-imagen generation card. */
const IMAGEN_STYLES = `
.dshImagen {
  --ig-ratio: 1;
  border: 1px solid var(--ds-inline-border, rgba(127, 127, 127, 0.25));
  border-radius: 12px;
  overflow: hidden;
  background: var(--ds-inline-bg, rgba(127, 127, 127, 0.06));
  font-size: 13px;
  line-height: 1.45;
}
.dshImagen[data-state='error'] { border-color: rgba(220, 60, 60, 0.5); }
.dshImagen__header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
}
.dshImagen__mark { display: inline-flex; color: var(--ds-accent, #7aa2f7); }
.dshImagen__heading { flex: 1; min-width: 0; }
.dshImagen__title { font-weight: 600; }
.dshImagen__subtitle { color: var(--ds-text-muted, rgba(127, 127, 127, 0.85)); font-size: 12px; }
.dshImagen__state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ds-text-muted, rgba(127, 127, 127, 0.85)); white-space: nowrap; }
.dshImagen__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ds-accent, #7aa2f7); }
.dshImagen[data-state='running'] .dshImagen__dot { animation: dshImagenPulse 1.2s ease-in-out infinite; }
.dshImagen[data-state='error'] .dshImagen__dot { background: rgba(220, 60, 60, 0.85); }
.dshImagen[data-state='done'] .dshImagen__dot { background: rgba(80, 190, 120, 0.9); }
@keyframes dshImagenPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.dshImagen__stage {
  position: relative; margin: 0 12px;
  aspect-ratio: var(--ig-ratio);
  max-height: 420px;
  border-radius: 8px;
  overflow: hidden;
  background:
    radial-gradient(circle at 30% 30%, rgba(122, 162, 247, 0.14), transparent 55%),
    radial-gradient(circle at 70% 70%, rgba(122, 162, 247, 0.08), transparent 55%),
    rgba(0, 0, 0, 0.18);
  display: flex; align-items: center; justify-content: center;
}
.dshImagen__image { width: 100%; height: 100%; object-fit: contain; display: block; }
.dshImagen__scan {
  position: absolute; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--ds-accent, #7aa2f7), transparent);
  animation: dshImagenScan 1.6s linear infinite;
  top: 0;
}
@keyframes dshImagenScan { 0% { top: 4%; opacity: 0.2; } 50% { opacity: 1; } 100% { top: 94%; opacity: 0.2; } }
.dshImagen__orb {
  position: absolute; width: 44px; height: 44px; border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--ds-accent, #7aa2f7);
  border-right-color: var(--ds-accent, #7aa2f7);
  animation: dshImagenSpin 1s linear infinite;
  filter: drop-shadow(0 0 6px rgba(122, 162, 247, 0.5));
}
@keyframes dshImagenSpin { to { transform: rotate(360deg); } }
.dshImagen__draft {
  position: absolute; left: 8px; bottom: 8px;
  padding: 2px 8px; border-radius: 999px;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 11px;
  backdrop-filter: blur(4px);
}
.dshImagen__error {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 16px; text-align: center; color: rgba(220, 80, 80, 0.95);
  background: rgba(0, 0, 0, 0.35);
}
.dshImagen__footer { padding: 10px 12px 12px; }
.dshImagen__prompt { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 8px; color: var(--ds-text, inherit); }
.dshImagen__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dshImagen__chip {
  padding: 2px 8px; border-radius: 999px; font-size: 11px;
  background: var(--ds-inline-bg, rgba(127, 127, 127, 0.12));
  color: var(--ds-text-muted, rgba(127, 127, 127, 0.85));
  white-space: nowrap;
}
.dshImagen__saved { max-width: 100%; }
.dshImagen__actions { display: inline-flex; gap: 6px; margin-left: auto; }
.dshImagen__button {
  padding: 4px 12px; border-radius: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--ds-inline-border, rgba(127, 127, 127, 0.3));
  background: var(--ds-inline-bg, rgba(127, 127, 127, 0.1));
  color: inherit;
}
.dshImagen__button:hover { filter: brightness(1.1); }
.dshImagen__gallery { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.dshImagen__thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; cursor: pointer; border: 1px solid var(--ds-inline-border, rgba(127, 127, 127, 0.25)); }
.dshImagen__details { margin-top: 8px; }
.dshImagen__details summary { cursor: pointer; color: var(--ds-text-muted, rgba(127, 127, 127, 0.85)); font-size: 12px; }
.dshImagen__details p { margin: 6px 0 0; font-size: 12px; color: var(--ds-text-muted, rgba(127, 127, 127, 0.85)); white-space: pre-wrap; word-break: break-word; }
.dshImagen__lightbox {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0, 0, 0, 0.8);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  padding: 24px;
}
.dshImagen__lightbox img { max-width: 92vw; max-height: 82vh; object-fit: contain; border-radius: 8px; }
@media (prefers-reduced-motion: reduce) {
  .dshImagen__scan, .dshImagen__orb, .dshImagen__dot { animation: none !important; }
}
`;
/** Scoped styles for the Settings → imagen page. */
const IMAGEN_SETTINGS_STYLES = `
.dshImagenSet__page { max-width: 760px; display: flex; flex-direction: column; gap: 14px; font-size: 13px; }
.dshImagenSet__heading { margin: 0; font-size: 18px; font-weight: 600; }
.dshImagenSet__intro { margin: 0; color: var(--ds-text-muted, rgba(127,127,127,.85)); }
.dshImagenSet__group { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--ds-inline-border, rgba(127,127,127,.25)); border-radius: 10px; background: var(--ds-inline-bg, rgba(127,127,127,.05)); }
.dshImagenSet__groupTitle { margin: 0; font-size: 14px; font-weight: 600; }
.dshImagenSet__sourceCard { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px dashed var(--ds-inline-border, rgba(127,127,127,.35)); border-radius: 8px; }
.dshImagenSet__sourceRow { display: flex; gap: 10px; flex-wrap: wrap; }
.dshImagenSet__field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 180px; }
.dshImagenSet__label { font-size: 12px; color: var(--ds-text-muted, rgba(127,127,127,.85)); }
.dshImagenSet__hint { font-size: 11px; color: var(--ds-text-muted, rgba(127,127,127,.7)); }
.dshImagenSet__input {
  padding: 6px 8px; border-radius: 6px; font-size: 13px;
  border: 1px solid var(--ds-inline-border, rgba(127,127,127,.35));
  background: var(--ds-inline-bg, rgba(127,127,127,.08));
  color: inherit;
}
.dshImagenSet__input:focus { outline: 2px solid var(--ds-accent, #7aa2f7); outline-offset: 0; }
.dshImagenSet__check { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dshImagenSet__button {
  align-self: flex-start; padding: 6px 14px; border-radius: 8px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--ds-inline-border, rgba(127,127,127,.35));
  background: var(--ds-inline-bg, rgba(127,127,127,.1)); color: inherit;
}
.dshImagenSet__button:hover:not(:disabled) { filter: brightness(1.1); }
.dshImagenSet__button:disabled { opacity: .5; cursor: default; }
.dshImagenSet__danger {
  align-self: flex-start; padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;
  border: 1px solid rgba(220,80,80,.4); background: transparent; color: rgba(220,80,80,.9);
}
.dshImagenSet__actions { display: flex; align-items: center; gap: 10px; }
.dshImagenSet__ok { color: rgba(80,190,120,.95); font-size: 12px; }
.dshImagenSet__error { color: rgba(220,80,80,.95); font-size: 12px; }
`;

//#endregion
//#region src/client/settings.tsx
function clampInteger(value, min, max, fallback) {
	if (value === void 0 || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}
function toSources(value) {
	const sources = value?.sources ?? {};
	const rows = [];
	for (const [name, source] of Object.entries(sources)) rows.push({
		name,
		baseUrl: source?.baseUrl ?? "",
		credential: source?.credential ?? "",
		model: source?.model ?? ""
	});
	return rows;
}
function toDraft(sources, value) {
	const built = {};
	for (const row of sources) {
		const name = row.name.trim();
		if (name === "") continue;
		built[name] = {
			baseUrl: row.baseUrl.trim(),
			credential: row.credential.trim(),
			...row.model.trim() === "" ? {} : { model: row.model.trim() }
		};
	}
	return {
		...value,
		sources: built
	};
}
function patternsText(value) {
	return (value?.discovery?.extraPatterns ?? []).join(", ");
}
function parsePatterns(text) {
	return text.split(/[,;\n]/u).map((part) => part.trim()).filter((part) => part !== "");
}
/** One labeled field wrapper. */
function Field({ label, hint, children }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
		className: "dshImagenSet__field",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dshImagenSet__label",
				children: label
			}),
			children,
			hint !== void 0 && hint !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dshImagenSet__hint",
				children: hint
			})
		]
	});
}
function NumberField({ label, value, min, max, onChange }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
		label,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
			className: "dshImagenSet__input",
			type: "number",
			value: String(value),
			min,
			max,
			onChange: (event) => {
				onChange(clampInteger(Number(event.target.value), min, max, value));
			}
		})
	});
}
/** The plugin-config card (Plugins → 插件配置) for dsh-imagen. */
function ImagenSettingsCard({ t, loadConfig, saveConfig }) {
	const [phase, setPhase] = (0, react.useState)("loading");
	const [loadError, setLoadError] = (0, react.useState)("");
	const [value, setValue] = (0, react.useState)();
	const [sourceRows, setSourceRows] = (0, react.useState)([]);
	const [defaultSource, setDefaultSource] = (0, react.useState)("");
	const [saveEnabled, setSaveEnabled] = (0, react.useState)(true);
	const [saveDir, setSaveDir] = (0, react.useState)("generated-images");
	const [nameTemplate, setNameTemplate] = (0, react.useState)("{prompt}-{timestamp}");
	const [discoveryEnabled, setDiscoveryEnabled] = (0, react.useState)(true);
	const [extraPatterns, setExtraPatterns] = (0, react.useState)("");
	const [defaultSize, setDefaultSize] = (0, react.useState)("");
	const [defaultQuality, setDefaultQuality] = (0, react.useState)("");
	const [defaultFormat, setDefaultFormat] = (0, react.useState)("png");
	const [defaultN, setDefaultN] = (0, react.useState)(1);
	const [timeoutMs, setTimeoutMs] = (0, react.useState)(12e4);
	const [maxRetries, setMaxRetries] = (0, react.useState)(2);
	const [retryBaseMs, setRetryBaseMs] = (0, react.useState)(1e3);
	const [maxConcurrent, setMaxConcurrent] = (0, react.useState)(2);
	const [maxImageBytes, setMaxImageBytes] = (0, react.useState)(2e7);
	const [maxReferenceBytes, setMaxReferenceBytes] = (0, react.useState)(1e7);
	const [busy, setBusy] = (0, react.useState)(false);
	const [message, setMessage] = (0, react.useState)();
	(0, react.useEffect)(() => {
		let live = true;
		setPhase("loading");
		setLoadError("");
		loadConfig().then((config) => {
			if (!live) return;
			setValue(config);
			setSourceRows(toSources(config));
			setDefaultSource(config.defaultSource ?? "");
			setSaveEnabled(config.save?.enabled ?? true);
			setSaveDir(config.save?.dir ?? "generated-images");
			setNameTemplate(config.save?.nameTemplate ?? "{prompt}-{timestamp}");
			setDiscoveryEnabled(config.discovery?.enabled ?? true);
			setExtraPatterns(patternsText(config));
			setDefaultSize(config.defaults?.size ?? "");
			setDefaultQuality(config.defaults?.quality ?? "");
			setDefaultFormat(config.defaults?.outputFormat ?? "png");
			setDefaultN(config.defaults?.n ?? 1);
			setTimeoutMs(config.limits?.timeoutMs ?? 12e4);
			setMaxRetries(config.limits?.maxRetries ?? 2);
			setRetryBaseMs(config.limits?.retryBaseMs ?? 1e3);
			setMaxConcurrent(config.limits?.maxConcurrent ?? 2);
			setMaxImageBytes(config.limits?.maxImageBytes ?? 2e7);
			setMaxReferenceBytes(config.limits?.maxReferenceBytes ?? 1e7);
			setPhase("ready");
		}).catch((error) => {
			if (!live) return;
			setLoadError(error instanceof Error ? error.message : String(error));
			setPhase("error");
		});
		return () => {
			live = false;
		};
	}, []);
	const buildDraft = () => {
		const defaultSourceValue = defaultSource.trim();
		const sizeValue = defaultSize.trim();
		const qualityValue = defaultQuality.trim();
		return {
			...toDraft(sourceRows, value),
			...defaultSourceValue === "" ? {} : { defaultSource: defaultSourceValue },
			save: {
				enabled: saveEnabled,
				dir: saveDir.trim(),
				nameTemplate: nameTemplate.trim()
			},
			discovery: {
				enabled: discoveryEnabled,
				extraPatterns: parsePatterns(extraPatterns)
			},
			defaults: {
				...sizeValue === "" ? {} : { size: sizeValue },
				...qualityValue === "" ? {} : { quality: qualityValue },
				outputFormat: defaultFormat,
				n: defaultN
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
	};
	const dirty = (0, react.useMemo)(() => JSON.stringify(buildDraft()) !== JSON.stringify(value ?? {}), [
		sourceRows,
		defaultSource,
		saveEnabled,
		saveDir,
		nameTemplate,
		discoveryEnabled,
		extraPatterns,
		defaultSize,
		defaultQuality,
		defaultFormat,
		defaultN,
		timeoutMs,
		maxRetries,
		retryBaseMs,
		maxConcurrent,
		maxImageBytes,
		maxReferenceBytes,
		value
	]);
	const updateRow = (index, patch) => {
		setSourceRows((rows) => rows.map((row, at) => at === index ? {
			...row,
			...patch
		} : row));
	};
	const save = async () => {
		setBusy(true);
		setMessage(void 0);
		try {
			await saveConfig(buildDraft());
			setMessage({
				kind: "ok",
				text: t("settingsSaved")
			});
		} catch (error) {
			setMessage({
				kind: "error",
				text: error instanceof Error ? error.message : t("settingsSaveFailed")
			});
		} finally {
			setBusy(false);
		}
	};
	if (phase === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "dshImagenSet__page",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settingsLoading") })
	});
	if (phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "dshImagenSet__page",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			className: "dshImagenSet__error",
			children: loadError || t("settingsLoadFailed")
		})
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dshImagenSet__page",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
				className: "dshImagenSet__heading",
				children: t("settingsTitle")
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dshImagenSet__intro",
				children: t("settingsIntro")
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dshImagenSet__group",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dshImagenSet__groupTitle",
						children: t("settingsSources")
					}),
					sourceRows.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshImagenSet__hint",
						children: t("settingsNoSources")
					}),
					sourceRows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshImagenSet__sourceCard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshImagenSet__sourceRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: t("settingsSourceName"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dshImagenSet__input",
										value: row.name,
										onChange: (event) => {
											updateRow(index, { name: event.target.value });
										},
										placeholder: "myprovider"
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: t("settingsSourceBaseUrl"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dshImagenSet__input",
										value: row.baseUrl,
										onChange: (event) => {
											updateRow(index, { baseUrl: event.target.value });
										},
										placeholder: "https://api.example.com/v1"
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshImagenSet__sourceRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: t("settingsSourceCredential"),
									hint: t("settingsCredentialHint"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dshImagenSet__input",
										value: row.credential,
										onChange: (event) => {
											updateRow(index, { credential: event.target.value });
										},
										placeholder: "IMAGE_API_KEY"
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: t("settingsSourceModel"),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dshImagenSet__input",
										value: row.model,
										onChange: (event) => {
											updateRow(index, { model: event.target.value });
										},
										placeholder: t("settingsModelPlaceholder")
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dshImagenSet__danger",
								onClick: () => {
									setSourceRows((rows) => rows.filter((_, at) => at !== index));
								},
								children: t("settingsRemove")
							})
						]
					}, `${row.name || "source"}-${index}`)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshImagenSet__button",
						onClick: () => {
							setSourceRows((rows) => [...rows, {
								name: "",
								baseUrl: "",
								credential: "",
								model: ""
							}]);
						},
						children: t("settingsAddSource")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("settingsDefaultSource"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dshImagenSet__input",
							value: defaultSource,
							onChange: (event) => {
								setDefaultSource(event.target.value);
							},
							placeholder: "myprovider"
						})
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dshImagenSet__group",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dshImagenSet__groupTitle",
						children: t("settingsSave")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dshImagenSet__check",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: saveEnabled,
							onChange: (event) => {
								setSaveEnabled(event.target.checked);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settingsSaveEnabled") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshImagenSet__sourceRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							label: t("settingsSaveDir"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dshImagenSet__input",
								value: saveDir,
								onChange: (event) => {
									setSaveDir(event.target.value);
								}
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							label: t("settingsNameTemplate"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dshImagenSet__input",
								value: nameTemplate,
								onChange: (event) => {
									setNameTemplate(event.target.value);
								}
							})
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dshImagenSet__group",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dshImagenSet__groupTitle",
						children: t("settingsDiscovery")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dshImagenSet__check",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: discoveryEnabled,
							onChange: (event) => {
								setDiscoveryEnabled(event.target.checked);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settingsDiscoveryEnabled") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("settingsPatterns"),
						hint: t("settingsPatternsHint"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dshImagenSet__input",
							value: extraPatterns,
							onChange: (event) => {
								setExtraPatterns(event.target.value);
							}
						})
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dshImagenSet__group",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dshImagenSet__groupTitle",
						children: t("settingsDefaults")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshImagenSet__sourceRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							label: t("settingsDefaultSize"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dshImagenSet__input",
								value: defaultSize,
								onChange: (event) => {
									setDefaultSize(event.target.value);
								},
								placeholder: "1024x1024"
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							label: t("settingsDefaultQuality"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: "dshImagenSet__input",
								value: defaultQuality,
								onChange: (event) => {
									setDefaultQuality(event.target.value);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: t("settingsProviderDefault")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "auto",
										children: "auto"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "low",
										children: "low"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "medium",
										children: "medium"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "high",
										children: "high"
									})
								]
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshImagenSet__sourceRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							label: t("settingsDefaultFormat"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: "dshImagenSet__input",
								value: defaultFormat,
								onChange: (event) => {
									setDefaultFormat(event.target.value);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "png",
										children: "PNG"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "jpeg",
										children: "JPEG"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "webp",
										children: "WebP"
									})
								]
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("settingsDefaultCount"),
							value: defaultN,
							min: 1,
							max: 4,
							onChange: setDefaultN
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dshImagenSet__group",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dshImagenSet__groupTitle",
						children: t("settingsLimits")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshImagenSet__sourceRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("settingsTimeoutMs"),
							value: timeoutMs,
							min: 1e4,
							max: 6e5,
							onChange: setTimeoutMs
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("settingsMaxRetries"),
							value: maxRetries,
							min: 0,
							max: 5,
							onChange: setMaxRetries
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshImagenSet__sourceRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("settingsRetryBaseMs"),
							value: retryBaseMs,
							min: 100,
							max: 3e4,
							onChange: setRetryBaseMs
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("settingsMaxConcurrent"),
							value: maxConcurrent,
							min: 1,
							max: 8,
							onChange: setMaxConcurrent
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshImagenSet__sourceRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("settingsMaxImageBytes"),
							value: maxImageBytes,
							min: 65536,
							max: 268435456,
							onChange: setMaxImageBytes
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("settingsMaxReferenceBytes"),
							value: maxReferenceBytes,
							min: 16384,
							max: 268435456,
							onChange: setMaxReferenceBytes
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshImagenSet__actions",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshImagenSet__button",
						disabled: busy || !dirty,
						onClick: () => {
							save();
						},
						children: t("settingsSave")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshImagenSet__button",
						disabled: busy,
						onClick: () => {
							setMessage(void 0);
						},
						children: t("settingsDiscard")
					}),
					message !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: message.kind === "ok" ? "dshImagenSet__ok" : "dshImagenSet__error",
						children: message.text
					})
				]
			})
		]
	});
}
/** Register the official plugin-config card (slot lifecycle is fiber-owned). */
function installPluginCard(ctx, t, call) {
	const signal = new AbortController().signal;
	const loadConfig = async () => {
		const value = await call("imagen/settings/get", {}, signal);
		if (typeof value !== "object" || value === null) throw new Error("Host returned invalid settings");
		return value;
	};
	const saveConfig = async (config) => {
		await call("imagen/settings/set", { config }, signal);
	};
	ctx.slots.inject("settings.plugin.item", function* () {
		yield ctx.slots.register({
			name: "settings.plugin.item",
			id: "imagen",
			order: 30,
			inject: () => ({
				t,
				loadConfig,
				saveConfig
			})
		}, ImagenSettingsCard);
	});
}

//#endregion
//#region src/client/index.tsx
const NS = "dsh.imagen";
const POLL_MS = 650;
const en = {
	generating: "Generating image",
	generated: "Image generated",
	failed: "Image generation failed",
	discovering: "Discovering image models",
	requesting: "Contacting image API",
	rendering: "Rendering pixels",
	saving: "Saving image files",
	waiting: "Preparing",
	ready: "Saved to workspace",
	preview: "Preview",
	download: "Download",
	close: "Close",
	details: "Prompt & details",
	loading: "Loading final image",
	unavailable: "The saved image is unavailable. Reload the page or check Host logs.",
	noOutput: "The provider did not return a usable image.",
	savedTo: "Saved to",
	images: "images",
	settingsNav: "Image generation",
	settingsTitle: "Image generation (dsh-imagen)",
	settingsIntro: "Configure the OpenAI-compatible image sources the agent may use, automatic workspace saving, model discovery, and operation limits. Secrets stay in DSH credentials — only the credential name is stored here.",
	settingsSources: "Sources",
	settingsNoSources: "No source configured yet. Add at least one source, then store its API key in DSH credentials and enter the credential name below.",
	settingsSourceName: "Source name",
	settingsSourceBaseUrl: "Base URL",
	settingsSourceCredential: "Credential",
	settingsCredentialHint: "Name of the DSH credential holding the API key (e.g. IMAGE_API_KEY).",
	settingsSourceModel: "Model (optional)",
	settingsModelPlaceholder: "auto-discover",
	settingsRemove: "Remove",
	settingsAddSource: "Add source",
	settingsDefaultSource: "Default source (optional)",
	settingsSave: "Save",
	settingsSaveEnabled: "Automatically save generated images to the workspace",
	settingsSaveDir: "Save directory",
	settingsNameTemplate: "Name template",
	settingsDiscovery: "Model discovery",
	settingsDiscoveryEnabled: "Discover image models via GET /v1/models",
	settingsPatterns: "Extra name patterns",
	settingsPatternsHint: "Comma-separated regexes appended to the built-in image-model matcher.",
	settingsDefaults: "Defaults",
	settingsDefaultSize: "Default size",
	settingsDefaultQuality: "Default quality",
	settingsProviderDefault: "Provider default",
	settingsDefaultFormat: "Output format",
	settingsDefaultCount: "Images per call (1-4)",
	settingsLimits: "Limits",
	settingsTimeoutMs: "Timeout (ms)",
	settingsMaxRetries: "Max retries",
	settingsRetryBaseMs: "Retry base (ms)",
	settingsMaxConcurrent: "Max concurrent",
	settingsMaxImageBytes: "Max image bytes",
	settingsMaxReferenceBytes: "Max reference bytes",
	settingsDiscard: "Discard",
	settingsSaved: "Settings saved.",
	settingsSaveFailed: "Failed to save settings.",
	settingsLoadFailed: "Failed to load settings from the Host.",
	settingsLoading: "Loading settings…"
};
const zh = {
	generating: "正在生成图片",
	generated: "图片已生成",
	failed: "图片生成失败",
	discovering: "正在发现生图模型",
	requesting: "正在连接图片 API",
	rendering: "正在渲染像素",
	saving: "正在保存图片文件",
	waiting: "正在准备",
	ready: "已保存到工作区",
	preview: "预览",
	download: "下载",
	close: "关闭",
	details: "提示词与详情",
	loading: "正在加载最终图片",
	unavailable: "无法读取已保存图片。请刷新页面或查看 Host 日志。",
	noOutput: "服务未返回可用图片。",
	savedTo: "已保存到",
	images: "张",
	settingsNav: "图片生成",
	settingsTitle: "图片生成（dsh-imagen）",
	settingsIntro: "配置 Agent 可用的 OpenAI 兼容生图源、工作区自动保存、模型发现与运行边界。密钥始终存放在 DSH 凭据中——这里只保存凭据名称。",
	settingsSources: "生图源（Sources）",
	settingsNoSources: "尚未配置生图源。请至少添加一个源，先把 API Key 存进 DSH 凭据，再在此填写凭据名称。",
	settingsSourceName: "源名称",
	settingsSourceBaseUrl: "Base URL",
	settingsSourceCredential: "凭据",
	settingsCredentialHint: "持有 API Key 的 DSH 凭据名称（如 IMAGE_API_KEY）。",
	settingsSourceModel: "模型（可选）",
	settingsModelPlaceholder: "自动发现",
	settingsRemove: "移除",
	settingsAddSource: "添加生图源",
	settingsDefaultSource: "默认源（可选）",
	settingsSave: "保存",
	settingsSaveEnabled: "生成后自动保存图片到工作区",
	settingsSaveDir: "保存目录",
	settingsNameTemplate: "命名模板",
	settingsDiscovery: "模型发现",
	settingsDiscoveryEnabled: "通过 GET /v1/models 自动发现生图模型",
	settingsPatterns: "额外名称模式",
	settingsPatternsHint: "逗号分隔的正则，追加到内置生图模型匹配器之后。",
	settingsDefaults: "默认参数",
	settingsDefaultSize: "默认尺寸",
	settingsDefaultQuality: "默认质量",
	settingsProviderDefault: "厂商默认",
	settingsDefaultFormat: "输出格式",
	settingsDefaultCount: "每次张数（1-4）",
	settingsLimits: "运行边界",
	settingsTimeoutMs: "超时（毫秒）",
	settingsMaxRetries: "最大重试",
	settingsRetryBaseMs: "重试基数（毫秒）",
	settingsMaxConcurrent: "最大并发",
	settingsMaxImageBytes: "单图字节上限",
	settingsMaxReferenceBytes: "参考图字节上限",
	settingsDiscard: "放弃修改",
	settingsSaved: "设置已保存。",
	settingsSaveFailed: "保存设置失败。",
	settingsLoadFailed: "从 Host 读取设置失败。",
	settingsLoading: "正在加载设置…"
};
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
function resultOf(block) {
	if ("kind" in block) {
		if (isRecord(block.meta) && block.meta.schema === PRESENTATION_SCHEMA && isRecord(block.meta.result)) {
			const result = block.meta.result;
			if (result.schema === RESULT_SCHEMA && result.callId === block.callId) return block.meta.result;
		}
		const marker = block.content.filter((item) => item.type === "text").map((item) => item.type === "text" ? referenceFromText(item.text) : void 0).find((item) => item !== void 0 && item.callId === block.callId);
		if (marker !== void 0) return {
			schema: RESULT_SCHEMA,
			callId: marker.callId,
			source: marker.source,
			model: marker.model,
			prompt: "",
			images: marker.images,
			savedTo: marker.savedTo,
			outputFormat: marker.outputFormat,
			elapsedMs: marker.elapsedMs,
			...marker.size === void 0 ? {} : { size: marker.size },
			...marker.quality === void 0 ? {} : { quality: marker.quality },
			...marker.usage === void 0 ? {} : { usage: marker.usage }
		};
	}
}
function resultError(block, fallback) {
	if (!("kind" in block) || !block.isError) return "";
	return block.content.filter((item) => item.type === "text").map((item) => item.type === "text" ? item.text : "").join("\n").trim() || fallback;
}
function dataUrl(mediaType, data) {
	return `data:${mediaType};base64,${data}`;
}
function blobUrl(mediaType, data) {
	if (typeof URL.createObjectURL !== "function") return dataUrl(mediaType, data);
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return URL.createObjectURL(new Blob([bytes], { type: mediaType }));
}
function aspectRatio(result, index) {
	const image = result?.images[index];
	if (image !== void 0 && image.width !== void 0 && image.height !== void 0 && image.width > 0 && image.height > 0) return image.width / image.height;
	return 1;
}
function elapsedLabel(ms) {
	if (ms < 6e4) return `${Math.max(0, Math.round(ms / 1e3))}s`;
	return `${Math.floor(ms / 6e4)}m ${Math.round(ms % 6e4 / 1e3)}s`;
}
function ImageMark() {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: "dshImagen__mark",
		"aria-hidden": true,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			viewBox: "0 0 24 24",
			width: "16",
			height: "16",
			fill: "none",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3",
					y: "4",
					width: "18",
					height: "14",
					rx: "2.5",
					stroke: "currentColor",
					strokeWidth: "1.6"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "8.5",
					cy: "9",
					r: "1.6",
					fill: "currentColor"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4 16.5l4.4-4.2a1.2 1.2 0 0 1 1.7 0l3.2 3.1 1.9-1.8a1.2 1.2 0 0 1 1.7 0L20 16.5",
					stroke: "currentColor",
					strokeWidth: "1.6",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M17.4 4.6l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z",
					fill: "currentColor",
					opacity: ".8"
				})
			]
		})
	});
}
/** The session-scoped card for one generate_image call. */
function ImagenCard({ sessionId, callId, block, t, requestProgress, requestImage }) {
	const result = (0, react.useMemo)(() => resultOf(block), [block]);
	const settled = "kind" in block;
	const failed = settled && (block.isError || result === void 0);
	const [progress, setProgress] = (0, react.useState)();
	const [images, setImages] = (0, react.useState)([]);
	const [loadError, setLoadError] = (0, react.useState)(false);
	const [lightbox, setLightbox] = (0, react.useState)();
	const [active, setActive] = (0, react.useState)(0);
	(0, react.useEffect)(() => {
		if (settled) return;
		const controller = new AbortController();
		let live = true;
		let timer;
		const poll = async () => {
			try {
				const next = await requestProgress(sessionId, callId, controller.signal);
				if (!live) return;
				setProgress(next);
			} catch {
				if (!controller.signal.aborted && live) setProgress(void 0);
			}
			if (live) timer = setTimeout(() => {
				poll();
			}, POLL_MS);
		};
		poll();
		return () => {
			live = false;
			controller.abort();
			if (timer !== void 0) clearTimeout(timer);
		};
	}, [
		callId,
		requestProgress,
		sessionId,
		settled
	]);
	(0, react.useEffect)(() => {
		if (result === void 0 || result.images.length === 0) return;
		const controller = new AbortController();
		let live = true;
		const objectUrls = [];
		setLoadError(false);
		setImages([]);
		Promise.all(result.images.map((image) => requestImage(sessionId, callId, image.path, controller.signal))).then((loaded) => {
			if (!live) return;
			setImages(loaded.map((item) => ({
				url: blobUrl(item.mediaType, item.data),
				mediaType: item.mediaType
			})));
		}).catch(() => {
			if (live) setLoadError(true);
		});
		return () => {
			live = false;
			controller.abort();
			for (const url of objectUrls) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
		};
	}, [
		callId,
		requestImage,
		result,
		sessionId
	]);
	(0, react.useEffect)(() => {
		if (lightbox === void 0) return;
		const close = (event) => {
			if (event.key === "Escape") setLightbox(void 0);
		};
		document.addEventListener("keydown", close);
		return () => {
			document.removeEventListener("keydown", close);
		};
	}, [lightbox]);
	const prompt = result?.prompt || "";
	const partial = !settled && progress?.partial !== void 0 ? dataUrl(progress.partial.format === "jpeg" ? "image/jpeg" : `image/${progress.partial.format}`, progress.partial.data) : void 0;
	const src = images[active]?.url ?? partial;
	const ratio = aspectRatio(result, active);
	const state = failed ? "error" : settled ? "done" : "running";
	const phase = progress?.state === "discovering" ? t("discovering") : progress?.state === "requesting" ? t("requesting") : progress?.state === "generating" ? t("rendering") : progress?.state === "saving" ? t("saving") : settled && images.length > 0 ? t("ready") : settled && result !== void 0 && !loadError ? t("loading") : t("waiting");
	const title = failed ? t("failed") : settled ? t("generated") : t("generating");
	const startedAt = progress?.startedAt || ("time" in block ? block.time : Date.now());
	const elapsed = result?.elapsedMs ?? Math.max(0, Date.now() - startedAt);
	const error = failed ? settled && block.isError ? resultError(block, t("noOutput")) : t("noOutput") : loadError ? t("unavailable") : "";
	const download = (index) => {
		const item = images[index];
		const ref = result?.images[index];
		if (item === void 0 || ref === void 0) return;
		const anchor = document.createElement("a");
		anchor.href = item.url;
		anchor.download = ref.relPath.split("/").pop() || `image-${index + 1}`;
		anchor.click();
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
		className: "dshImagen",
		"data-state": state,
		"aria-busy": !settled,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: "dshImagen__header",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageMark, {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshImagen__heading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshImagen__title",
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshImagen__subtitle",
							children: failed ? result?.model ?? "" : phase
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dshImagen__state",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshImagen__dot" }), elapsedLabel(elapsed)]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshImagen__stage",
				style: { "--ig-ratio": String(ratio) },
				children: [
					!settled && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshImagen__scan" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshImagen__orb" })] }),
					src !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
						className: "dshImagen__image",
						src,
						alt: prompt || title
					}, src.slice(-32)),
					partial !== void 0 && images.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshImagen__draft",
						children: t("rendering")
					}),
					error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshImagen__error",
						role: "alert",
						children: error
					})
				]
			}),
			images.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshImagen__gallery",
				children: images.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: "dshImagen__thumb",
					src: item.url,
					alt: `${index + 1}`,
					style: { border: index === active ? "2px solid var(--ds-accent, #7aa2f7)" : void 0 },
					onClick: () => {
						setActive(index);
					}
				}, item.url))
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
				className: "dshImagen__footer",
				children: [
					prompt !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshImagen__prompt",
						children: prompt
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshImagen__meta",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshImagen__chip",
								children: result?.source ?? ""
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshImagen__chip",
								children: result?.model ?? ""
							}),
							result?.size !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshImagen__chip",
								children: result.size
							}),
							result?.quality !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshImagen__chip",
								children: result.quality
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshImagen__chip",
								children: (result?.outputFormat ?? "png").toUpperCase()
							}),
							result !== void 0 && result.images.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dshImagen__chip",
								children: [result.images.length, t("images")]
							}),
							progress !== void 0 && progress.attempt > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dshImagen__chip",
								children: ["attempt ", progress.attempt]
							}),
							images.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dshImagen__actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dshImagen__button",
									onClick: () => {
										setLightbox(active);
									},
									children: t("preview")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dshImagen__button",
									onClick: () => {
										download(active);
									},
									children: t("download")
								})]
							})
						]
					}),
					result !== void 0 && result.savedTo.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshImagen__saved dshImagen__chip",
						title: result.savedTo.join("\n"),
						children: [
							t("savedTo"),
							" ",
							result.savedTo.join(", ")
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "dshImagen__details",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("details") }),
							prompt !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: prompt }),
							result?.usage !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: `${result.model} · ${result.usage.totalTokens} tokens · ${elapsedLabel(result.elapsedMs)}` })
						]
					})
				]
			}),
			lightbox !== void 0 && images[lightbox] !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshImagen__lightbox",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": t("preview"),
				onClick: () => {
					setLightbox(void 0);
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: images[lightbox].url,
					alt: prompt || title,
					onClick: (event) => {
						event.stopPropagation();
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dshImagen__button",
					onClick: () => {
						setLightbox(void 0);
					},
					children: t("close")
				})]
			})
		]
	});
}
function decodeProgress(value) {
	if (!isRecord(value) || value.state !== "missing" && value.state !== "discovering" && value.state !== "requesting" && value.state !== "generating" && value.state !== "saving" || typeof value.revision !== "number" || typeof value.attempt !== "number" || typeof value.startedAt !== "number") throw new Error("Host returned invalid image progress");
	return value;
}
function decodeImage(value) {
	if (!isRecord(value) || typeof value.data !== "string" || typeof value.mediaType !== "string") throw new Error("Host returned invalid image data");
	return {
		mediaType: value.mediaType,
		data: value.data,
		...typeof value.width === "number" ? { width: value.width } : {},
		...typeof value.height === "number" ? { height: value.height } : {}
	};
}
/** Register the localized keyed tool card, the settings card, and lifecycle CSS. */
const inject = [
	"slots",
	"locale",
	"connection"
];
/** Browser Cordis plugin entry. */
function apply(ctx) {
	const connection = ctx.get("connection");
	if (connection === void 0) throw new Error("dsh-imagen requires the Client connection service");
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "dsh-imagen: locale dictionaries");
	ctx.effect(() => {
		const style = document.createElement("style");
		style.dataset.plugin = "dsh-imagen";
		style.textContent = `${IMAGEN_STYLES}\n${IMAGEN_SETTINGS_STYLES}`;
		document.head.append(style);
		return () => {
			style.remove();
		};
	}, "dsh-imagen: card styles");
	const t = ctx.locale.bind(NS);
	const call = async (endpoint, payload, signal) => {
		if (!connection.isLoopback) throw new Error("Image previews are available only from the local DSH page");
		const result = await connection.rpc.call(IMAGEN_RPC_CHANNEL, endpoint, payload, signal);
		if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
		return result.value;
	};
	ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
		name: "tool.call.toolview",
		key: "generate_image",
		locale: NS,
		inject: () => ({
			t,
			requestProgress: async (sessionId, callId, signal) => decodeProgress(await call(IMAGEN_RPC_ENDPOINT.progress, {
				sessionId: String(sessionId),
				callId
			}, signal)),
			requestImage: async (sessionId, callId, path, signal) => decodeImage(await call(IMAGEN_RPC_ENDPOINT.image, {
				sessionId: String(sessionId),
				callId,
				path
			}, signal))
		})
	}, ImagenCard));
	try {
		installPluginCard(ctx, t, call);
	} catch (error) {
		console.error("[dsh-imagen] settings card skipped:", error);
	}
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });
//# sourceMappingURL=client.js.map