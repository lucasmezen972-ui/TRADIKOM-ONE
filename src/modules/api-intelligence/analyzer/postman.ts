import { createHash } from "node:crypto";
import { AnalyzerError } from "@/modules/api-intelligence/analyzer/errors";
import {
  postmanCollectionDocumentSchema,
  postmanPreviewSchema,
  type PostmanPreview,
} from "@/modules/api-intelligence/analyzer/schemas";

const maxDocumentBytes = 1024 * 1024;
const maxDepth = 40;
const maxNodes = 20_000;
const maxFolderDepth = 20;
const maxItems = 500;
const maxVariables = 200;
const maxExamples = 500;
const maxScripts = 200;
const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

type AuthDescriptor = {
  type: string;
  attributeKeys: string[];
};

type ParseState = {
  itemCount: number;
  operationKeys: Set<string>;
  authDescriptors: AuthDescriptor[];
  baseUrls: Set<string>;
  operations: PostmanPreview["operations"];
  variables: PostmanPreview["variables"];
  examples: PostmanPreview["examples"];
  scripts: PostmanPreview["scripts"];
};

export function previewPostmanCollection(input: {
  snapshotId: string;
  apiProductId: string;
  sourceHash: string;
  content: string;
}): PostmanPreview {
  if (Buffer.byteLength(input.content) > maxDocumentBytes) {
    throw new AnalyzerError(
      "document_too_complex",
      "Collection Postman trop volumineuse.",
    );
  }
  const raw = parseJson(input.content);
  assertBoundedDocument(raw);
  const parsed = postmanCollectionDocumentSchema.safeParse(raw);
  if (!parsed.success || !isCollectionV21(parsed.data.info.schema)) {
    throw new AnalyzerError(
      "postman_invalid",
      "Collection Postman v2.1 invalide.",
    );
  }

  const collectionAuth = parseAuth(parsed.data.auth);
  const state: ParseState = {
    itemCount: 0,
    operationKeys: new Set(),
    authDescriptors: collectionAuth ? [collectionAuth] : [],
    baseUrls: new Set(),
    operations: [],
    variables: [],
    examples: [],
    scripts: [],
  };
  collectVariables(parsed.data.variable, "collection", "#/variable", state);
  collectScripts(parsed.data.event, "collection", "#/event", state);
  visitItems(parsed.data.item, {
    locator: "#/item",
    folders: [],
    inheritedAuth: collectionAuth,
    depth: 0,
    state,
  });

  const authTypes = [
    ...new Set(
      state.authDescriptors
        .map((auth) => auth.type)
        .filter((type) => type !== "noauth"),
    ),
  ].sort();
  const attributeKeys = [
    ...new Set(state.authDescriptors.flatMap((auth) => auth.attributeKeys)),
  ].sort();
  const baseUrls = [...state.baseUrls].sort();
  const version = normalizeVersion(parsed.data.info.version);

  return postmanPreviewSchema.parse({
    parserVersion: "postman-1",
    snapshotId: input.snapshotId,
    apiProductId: input.apiProductId,
    sourceHash: input.sourceHash,
    title: parsed.data.info.name,
    version,
    baseUrl: baseUrls.length === 1 ? baseUrls[0] : undefined,
    authenticationType:
      authTypes.length === 0
        ? collectionAuth?.type === "noauth"
          ? "none"
          : "unknown"
        : authTypes.length === 1
          ? authTypes[0]
          : "mixed",
    oauthMetadata: {
      source: "postman_collection_v2.1",
      authTypes,
      attributeKeys,
      valuesStored: false,
    },
    scopes: [],
    webhookSupport: false,
    rateLimitLocators: [],
    operations: state.operations,
    schemas: [],
    collectionSchema: "v2.1.0",
    variables: state.variables,
    examples: state.examples,
    scripts: state.scripts,
    blockedScriptCount: state.scripts.length,
  });
}

function visitItems(
  items: unknown[],
  input: {
    locator: string;
    folders: string[];
    inheritedAuth?: AuthDescriptor;
    depth: number;
    state: ParseState;
  },
) {
  if (input.depth > maxFolderDepth) {
    throw new AnalyzerError(
      "document_too_complex",
      "Collection Postman trop profonde.",
    );
  }
  for (const [index, value] of items.entries()) {
    input.state.itemCount += 1;
    if (input.state.itemCount > maxItems) {
      throw new AnalyzerError(
        "document_too_complex",
        "Collection Postman avec trop de requetes.",
      );
    }
    if (!isRecord(value)) {
      throw new AnalyzerError("postman_invalid", "Element Postman invalide.");
    }
    const locator = `${input.locator}/${index}`;
    if (!("request" in value) && Array.isArray(value.item)) {
      const folderName = safeText(value.name, "Dossier sans nom", 240);
      const folderAuth = parseAuth(value.auth) ?? input.inheritedAuth;
      if (folderAuth) input.state.authDescriptors.push(folderAuth);
      collectVariables(value.variable, "folder", `${locator}/variable`, input.state);
      collectScripts(value.event, "folder", `${locator}/event`, input.state);
      visitItems(value.item, {
        locator: `${locator}/item`,
        folders: [...input.folders, folderName].slice(-20),
        inheritedAuth: folderAuth,
        depth: input.depth + 1,
        state: input.state,
      });
      continue;
    }
    parseRequestItem(value, locator, input);
  }
}

function parseRequestItem(
  item: Record<string, unknown>,
  locator: string,
  input: {
    folders: string[];
    inheritedAuth?: AuthDescriptor;
    state: ParseState;
  },
) {
  const request = item.request;
  if (typeof request !== "string" && !isRecord(request)) {
    throw new AnalyzerError("postman_invalid", "Requete Postman invalide.");
  }
  const requestRecord = typeof request === "string" ? undefined : request;
  const method = safeMethod(requestRecord?.method);
  const requestUrl = typeof request === "string" ? request : request.url;
  const path = normalizeRequestPath(requestUrl);
  const baseUrl = extractSafeBaseUrl(requestUrl);
  if (baseUrl) input.state.baseUrls.add(baseUrl);
  const requestAuth = parseAuth(requestRecord?.auth) ?? input.inheritedAuth;
  if (requestAuth) input.state.authDescriptors.push(requestAuth);
  const summary = safeText(item.name, `${method} ${path}`, 500);
  const operationKey = uniqueOperationKey(
    `${method.toLowerCase()}:${path}`,
    [...input.folders, summary].join("/"),
    input.state.operationKeys,
  );
  const responses = Array.isArray(item.response) ? item.response : [];

  input.state.operations.push({
    operationKey,
    method,
    path,
    summary,
    tags: input.folders,
    capability: readMethods.has(method) ? "read" : "write",
    deprecated: false,
    securityRequirements: authRequirements(requestAuth),
    locator,
    exampleCount: responses.length,
  });
  collectVariables(item.variable, "request", `${locator}/variable`, input.state);
  collectVariables(
    isRecord(requestUrl) ? requestUrl.variable : undefined,
    "url",
    `${locator}/request/url/variable`,
    input.state,
  );
  collectScripts(item.event, "request", `${locator}/event`, input.state);
  collectExamples(responses, operationKey, `${locator}/response`, input.state);
}

function collectVariables(
  value: unknown,
  scope: PostmanPreview["variables"][number]["scope"],
  locator: string,
  state: ParseState,
) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new AnalyzerError("postman_invalid", "Variables Postman invalides.");
  }
  for (const [index, variable] of value.entries()) {
    if (!isRecord(variable)) {
      throw new AnalyzerError("postman_invalid", "Variable Postman invalide.");
    }
    const key = safeOptionalText(variable.key) ?? safeOptionalText(variable.id);
    if (!key) {
      throw new AnalyzerError("postman_invalid", "Variable Postman sans nom.");
    }
    if (state.variables.length >= maxVariables) {
      throw new AnalyzerError(
        "document_too_complex",
        "Collection Postman avec trop de variables.",
      );
    }
    state.variables.push({
      key: key.slice(0, 160),
      type: safeText(variable.type, "any", 40),
      disabled: variable.disabled === true,
      scope,
      locator: `${locator}/${index}`,
    });
  }
}

function collectScripts(
  value: unknown,
  scope: PostmanPreview["scripts"][number]["scope"],
  locator: string,
  state: ParseState,
) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new AnalyzerError("postman_invalid", "Scripts Postman invalides.");
  }
  for (const [index, event] of value.entries()) {
    if (!isRecord(event)) {
      throw new AnalyzerError("postman_invalid", "Script Postman invalide.");
    }
    if (state.scripts.length >= maxScripts) {
      throw new AnalyzerError(
        "document_too_complex",
        "Collection Postman avec trop de scripts.",
      );
    }
    state.scripts.push({
      event: safeText(event.listen, "unknown", 80),
      disabled: event.disabled === true,
      scope,
      locator: `${locator}/${index}`,
    });
  }
}

function collectExamples(
  responses: unknown[],
  operationKey: string,
  locator: string,
  state: ParseState,
) {
  for (const [index, response] of responses.entries()) {
    if (!isRecord(response)) {
      throw new AnalyzerError("postman_invalid", "Exemple Postman invalide.");
    }
    if (state.examples.length >= maxExamples) {
      throw new AnalyzerError(
        "document_too_complex",
        "Collection Postman avec trop d'exemples.",
      );
    }
    const code =
      typeof response.code === "number" &&
      Number.isInteger(response.code) &&
      response.code >= 0 &&
      response.code <= 999
        ? response.code
        : undefined;
    state.examples.push({
      operationKey,
      name: safeText(response.name, `Exemple ${index + 1}`, 240),
      status: safeText(response.status, "", 120),
      code,
      bodyPresent: typeof response.body === "string" && response.body.length > 0,
      locator: `${locator}/${index}`,
    });
  }
}

function parseAuth(value: unknown): AuthDescriptor | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || typeof value.type !== "string" || !value.type.trim()) {
    throw new AnalyzerError("postman_invalid", "Authentification Postman invalide.");
  }
  const type = value.type.trim().toLowerCase().slice(0, 40);
  const attributes = value[type];
  const attributeKeys = Array.isArray(attributes)
    ? attributes.flatMap((attribute) => {
        if (!isRecord(attribute) || typeof attribute.key !== "string") return [];
        const key = attribute.key.trim();
        return key ? [key.slice(0, 80)] : [];
      })
    : [];
  return { type, attributeKeys: [...new Set(attributeKeys)].sort() };
}

function authRequirements(auth?: AuthDescriptor) {
  if (!auth || auth.type === "noauth") return [];
  return [{ [auth.type]: [] }];
}

function parseJson(content: string) {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new AnalyzerError("postman_invalid", "JSON Postman invalide.");
  }
}

function assertBoundedDocument(value: unknown) {
  let nodes = 0;
  const visit = (child: unknown, depth: number) => {
    nodes += 1;
    if (depth > maxDepth || nodes > maxNodes) {
      throw new AnalyzerError(
        "document_too_complex",
        "Collection Postman trop complexe.",
      );
    }
    if (Array.isArray(child)) {
      child.forEach((entry) => visit(entry, depth + 1));
    } else if (isRecord(child)) {
      Object.values(child).forEach((entry) => visit(entry, depth + 1));
    }
  };
  visit(value, 0);
}

function normalizeRequestPath(value: unknown) {
  let candidate = "";
  if (typeof value === "string") {
    candidate = pathFromRawUrl(value);
  } else if (isRecord(value)) {
    if (Array.isArray(value.path)) {
      candidate = `/${value.path.map(normalizePathSegment).join("/")}`;
    } else if (typeof value.path === "string") {
      candidate = `/${value.path.replace(/^\/+/, "")}`;
    } else if (typeof value.raw === "string") {
      candidate = pathFromRawUrl(value.raw);
    }
  }
  const normalized = candidate
    .split(/[?#]/, 1)[0]!
    .replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, "{$1}")
    .replace(/(^|\/)\:([A-Za-z0-9_.-]+)(?=\/|$)/g, "$1{$2}")
    .replace(/\/{2,}/g, "/");
  return (normalized.startsWith("/") ? normalized : `/${normalized || ""}`).slice(
    0,
    500,
  );
}

function normalizePathSegment(value: unknown) {
  if (typeof value === "string") return value.replaceAll("/", "");
  if (isRecord(value) && typeof value.value === "string") {
    const name = /^[A-Za-z0-9_.-]{1,80}$/.test(value.value)
      ? value.value
      : "parametre";
    return `{${name}}`;
  }
  return "parametre";
}

function pathFromRawUrl(value: string) {
  const trimmed = value.trim().slice(0, 2_000);
  if (!trimmed.includes("{{")) {
    try {
      return new URL(trimmed).pathname || "/";
    } catch {
      // Relative URLs are handled below.
    }
  }
  const withoutBaseVariable = trimmed.replace(/^\{\{[^}]+\}\}/, "");
  if (withoutBaseVariable.startsWith("/")) return withoutBaseVariable;
  return withoutBaseVariable.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "") || "/";
}

function extractSafeBaseUrl(value: unknown) {
  let raw: string | undefined;
  if (typeof value === "string") raw = value;
  else if (isRecord(value)) {
    if (typeof value.raw === "string") raw = value.raw;
    else if (value.protocol === "https") {
      const host = Array.isArray(value.host)
        ? value.host.filter((part): part is string => typeof part === "string").join(".")
        : typeof value.host === "string"
          ? value.host
          : "";
      raw = host ? `https://${host}` : undefined;
    }
  }
  if (!raw || raw.includes("{{")) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !/^(?!localhost$)(?=.{3,253}$)[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function normalizeVersion(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  if (isRecord(value)) {
    const parts = [value.major, value.minor, value.patch];
    if (parts.every((part) => Number.isInteger(part) && Number(part) >= 0)) {
      const version = parts.join(".");
      return typeof value.identifier === "string" && value.identifier.trim()
        ? `${version}-${value.identifier.trim().slice(0, 10)}`
        : version;
    }
  }
  return "non-versionnee";
}

function uniqueOperationKey(base: string, discriminator: string, keys: Set<string>) {
  if (!keys.has(base)) {
    keys.add(base);
    return base;
  }
  const digest = createHash("sha256").update(discriminator).digest("hex").slice(0, 10);
  let candidate = `${base}#${digest}`;
  let suffix = 2;
  while (keys.has(candidate)) candidate = `${base}#${digest}-${suffix++}`;
  keys.add(candidate);
  return candidate;
}

function safeMethod(value: unknown) {
  const method = typeof value === "string" ? value.trim().toUpperCase() : "GET";
  return (/^[A-Z][A-Z0-9_-]{0,19}$/.test(method) ? method : "GET").slice(0, 20);
}

function safeText(value: unknown, fallback: string, maxLength: number) {
  const text = safeOptionalText(value);
  return (text || fallback).slice(0, maxLength);
}

function safeOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isCollectionV21(value: string) {
  try {
    const url = new URL(value);
    return (
      ["schema.getpostman.com", "schema.postman.com"].includes(url.hostname) &&
      /(?:\/json\/collection\/v2\.1\.0\/|\/collection\/json\/v2\.1\.0\/|\/collection\/v2\.1\.0\/)/.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
