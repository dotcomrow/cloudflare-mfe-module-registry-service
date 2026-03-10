#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

const DEFAULT_CONFIG_PATH = "wrangler.jsonc";
const DEFAULT_OUTPUT_PATH = "wrangler.resolved.jsonc";
const PLACEHOLDER_UUID_PATTERN =
  /^0{8}-0{4}-0{4}-0{4}-0{12}$/i;

function parseArgs(argv) {
  const options = {
    input: DEFAULT_CONFIG_PATH,
    output: DEFAULT_OUTPUT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/resolve-wrangler-d1-ids.mjs [options]

Options:
  --input <path>    Wrangler config path (default: ${DEFAULT_CONFIG_PATH})
  --output <path>   Resolved config output path (default: ${DEFAULT_OUTPUT_PATH})`);
      process.exit(0);
    }

    if (arg === "--input" || arg === "--config") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}.`);
      }
      options.input = value;
      index += 1;
      continue;
    }

    if (arg === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --output.");
      }
      options.output = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function stripJsonComments(input) {
  let output = "";
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        output += char;
      }
      continue;
    }

    if (inMultiLineComment) {
      if (char === "*" && next === "/") {
        inMultiLineComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += char;

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inSingleLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inMultiLineComment = true;
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function parseJsonc(raw, sourcePath) {
  const withoutComments = stripJsonComments(raw);
  const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(withoutTrailingCommas);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    throw new Error(`Unable to parse ${sourcePath}: ${message}`);
  }
}

function getD1Bindings(config) {
  const bindings = [];

  if (Array.isArray(config.d1_databases)) {
    bindings.push(
      ...config.d1_databases
        .filter((item) => item && typeof item === "object")
        .map((item, index) => ({
          scope: "root",
          index,
          binding: item,
        })),
    );
  }

  if (config.env && typeof config.env === "object") {
    for (const [envName, envConfig] of Object.entries(config.env)) {
      if (!envConfig || typeof envConfig !== "object") {
        continue;
      }

      if (!Array.isArray(envConfig.d1_databases)) {
        continue;
      }

      bindings.push(
        ...envConfig.d1_databases
          .filter((item) => item && typeof item === "object")
          .map((item, index) => ({
            scope: `env.${envName}`,
            index,
            binding: item,
          })),
      );
    }
  }

  return bindings;
}

function hasRuntimeAuth() {
  return Boolean(
    process.env.CLOUDFLARE_API_TOKEN ||
      process.env.CF_API_TOKEN,
  );
}

function listD1Databases() {
  const runner = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    runner,
    ["wrangler", "d1", "list", "--json"],
    {
      encoding: "utf8",
      env: process.env,
    },
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      [
        "Failed to run `wrangler d1 list --json`.",
        stderr || stdout || "No command output.",
      ].join(" "),
    );
  }

  const raw = result.stdout?.trim();
  if (!raw) {
    throw new Error("Wrangler returned no JSON output for `d1 list`.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    throw new Error(`Unable to parse \`wrangler d1 list --json\` output: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Unexpected `wrangler d1 list --json` output shape.");
  }

  return parsed;
}

function isPlaceholderUuid(value) {
  return typeof value === "string" && PLACEHOLDER_UUID_PATTERN.test(value.trim());
}

function resolveD1Ids(config, d1List) {
  const idByName = new Map();
  for (const entry of d1List) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const id =
      typeof entry.uuid === "string"
        ? entry.uuid.trim()
        : typeof entry.id === "string"
          ? entry.id.trim()
          : "";

    if (name && id) {
      idByName.set(name, id);
    }
  }

  const bindings = getD1Bindings(config);
  const missing = [];
  let resolvedCount = 0;

  for (const item of bindings) {
    const binding =
      item.binding && typeof item.binding === "object"
        ? item.binding
        : null;
    if (!binding) {
      continue;
    }

    const databaseName =
      typeof binding.database_name === "string"
        ? binding.database_name.trim()
        : "";
    const bindingName =
      typeof binding.binding === "string"
        ? binding.binding
        : `index-${item.index}`;

    if (!databaseName) {
      missing.push(
        `${item.scope} d1_databases[${item.index}] (${bindingName}) is missing database_name`,
      );
      continue;
    }

    const resolvedId = idByName.get(databaseName);
    if (!resolvedId) {
      missing.push(
        `${item.scope} d1_databases[${item.index}] (${bindingName}) references unknown D1 database "${databaseName}"`,
      );
      continue;
    }

    const currentId =
      typeof binding.database_id === "string" ? binding.database_id.trim() : "";
    if (currentId !== resolvedId || isPlaceholderUuid(currentId) || !currentId) {
      binding.database_id = resolvedId;
      resolvedCount += 1;
    }
  }

  if (missing.length > 0) {
    const known = Array.from(idByName.keys()).sort();
    throw new Error(
      [
        "Unable to resolve one or more D1 bindings by name:",
        ...missing.map((entry) => `- ${entry}`),
        known.length > 0
          ? `Known D1 database names in this account: ${known.join(", ")}`
          : "No D1 databases were returned by `wrangler d1 list --json`.",
      ].join("\n"),
    );
  }

  return {
    resolvedCount,
    bindingCount: bindings.length,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = resolve(options.input);
  const outputPath = resolve(options.output);
  const rawConfig = readFileSync(inputPath, "utf8");
  const parsedConfig = parseJsonc(rawConfig, options.input);
  const d1Bindings = getD1Bindings(parsedConfig);

  if (d1Bindings.length === 0) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(parsedConfig, null, 2) + "\n", "utf8");
    console.log(
      `[resolve-d1] No d1_databases bindings found. Wrote ${relative(process.cwd(), outputPath)}.`,
    );
    return;
  }

  if (!hasRuntimeAuth()) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(parsedConfig, null, 2) + "\n", "utf8");
    console.warn(
      [
        "[resolve-d1] CLOUDFLARE_API_TOKEN is not set.",
        "Skipping dynamic D1 ID lookup and writing config unchanged.",
      ].join(" "),
    );
    return;
  }

  const d1List = listD1Databases();
  const summary = resolveD1Ids(parsedConfig, d1List);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(parsedConfig, null, 2) + "\n", "utf8");
  console.log(
    [
      `[resolve-d1] Resolved ${summary.resolvedCount} of ${summary.bindingCount} D1 binding(s) by name.`,
      `Wrote ${relative(process.cwd(), outputPath)}.`,
    ].join(" "),
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`[resolve-d1] ${message}`);
  process.exit(1);
}
