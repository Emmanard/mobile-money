#!/usr/bin/env node
/**
 * Mobile Money Admin CLI Tool
 *
 * Provides administrative commands for managing transactions, queues, and batches.
 *
 * Commands:
 *   retry-batch <batch_id>  – re-queue failed or stuck transactions belonging to a batch
 */

import { TransactionStatus } from "../models/transaction";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

dotenv.config();

const isTest = process.env.NODE_ENV === "test";
const colors = {
  reset: isTest ? "" : "\x1b[0m",
  bold: isTest ? "" : "\x1b[1m",
  green: isTest ? "" : "\x1b[32m",
  yellow: isTest ? "" : "\x1b[33m",
  red: isTest ? "" : "\x1b[31m",
  cyan: isTest ? "" : "\x1b[36m",
  gray: isTest ? "" : "\x1b[90m",
};

let activePool: { end: () => Promise<void> } | undefined;
let activeTransactionQueue: { close: () => Promise<void> } | undefined;

type SetupConfig = {
  databaseUrl: string;
  redisUrl: string;
  stellarIssuerSecret: string;
  stellarNetwork: "testnet" | "mainnet";
  stellarHorizonUrl: string;
};

const DEFAULT_SETUP_CONFIG: SetupConfig = {
  databaseUrl: "postgresql://postgres:postgres@localhost:5432/mobile_money",
  redisUrl: "redis://localhost:6379",
  stellarIssuerSecret: "",
  stellarNetwork: "testnet",
  stellarHorizonUrl: "https://horizon-testnet.stellar.org",
};

const CONFIG_KEYS: Record<keyof SetupConfig, string> = {
  databaseUrl: "DATABASE_URL",
  redisUrl: "REDIS_URL",
  stellarIssuerSecret: "STELLAR_ISSUER_SECRET",
  stellarNetwork: "STELLAR_NETWORK",
  stellarHorizonUrl: "STELLAR_HORIZON_URL",
};

function getEnvPath(args: string[]): string {
  const fileIndex = args.findIndex((arg) => arg === "--file" || arg === "-f");
  const configuredPath = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  return path.resolve(process.cwd(), configuredPath || ".env");
}

function validateUrl(value: string, label: string): void {
  try {
    new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
}

function normalizeNetwork(value: string): "testnet" | "mainnet" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "testnet" || normalized === "mainnet") {
    return normalized;
  }

  throw new Error("Stellar network must be testnet or mainnet.");
}

function horizonUrlForNetwork(network: "testnet" | "mainnet"): string {
  return network === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}

async function readEnvFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }

    throw err;
  }
}

function serializeEnvValue(value: string): string {
  if (/^[A-Za-z0-9_:/@.+,\-=]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

export function upsertEnvContent(
  existingContent: string,
  updates: Record<string, string>,
): string {
  const pending = new Map(Object.entries(updates));
  const lines = existingContent.replace(/\r\n/g, "\n").split("\n");
  const outputLines: string[] = [];

  for (const line of lines) {
    if (!line.trim() && outputLines.length === 0) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && pending.has(match[1])) {
      outputLines.push(`${match[1]}=${serializeEnvValue(pending.get(match[1])!)}`);
      pending.delete(match[1]);
      continue;
    }

    outputLines.push(line);
  }

  while (outputLines.length > 0 && outputLines[outputLines.length - 1] === "") {
    outputLines.pop();
  }

  if (pending.size > 0) {
    if (outputLines.length > 0) {
      outputLines.push("");
    }

    outputLines.push("# Mobile Money setup");
    for (const [key, value] of pending) {
      outputLines.push(`${key}=${serializeEnvValue(value)}`);
    }
  }

  return `${outputLines.join("\n")}\n`;
}

async function writeEnvConfig(filePath: string, config: SetupConfig): Promise<void> {
  const existingContent = await readEnvFile(filePath);
  const content = upsertEnvContent(existingContent, {
    [CONFIG_KEYS.databaseUrl]: config.databaseUrl,
    [CONFIG_KEYS.redisUrl]: config.redisUrl,
    [CONFIG_KEYS.stellarIssuerSecret]: config.stellarIssuerSecret,
    [CONFIG_KEYS.stellarNetwork]: config.stellarNetwork,
    [CONFIG_KEYS.stellarHorizonUrl]: config.stellarHorizonUrl,
  });

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

async function promptValue(
  rl: readline.Interface,
  message: string,
  defaultValue: string,
  validate: (value: string) => void = () => {},
): Promise<string> {
  while (true) {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    const answer = (await rl.question(`${message}${suffix}: `)).trim();
    const value = answer || defaultValue;

    try {
      validate(value);
      return value;
    } catch (err) {
      console.error(
        `${colors.red}${err instanceof Error ? err.message : String(err)}${colors.reset}`,
      );
    }
  }
}

async function promptSetupConfig(): Promise<SetupConfig> {
  const rl = readline.createInterface({ input, output });

  try {
    console.log(`\n${colors.cyan}${colors.bold}Mobile Money Config Setup${colors.reset}`);
    console.log(`${colors.gray}Database${colors.reset}`);

    const databaseUrl = await promptValue(
      rl,
      "PostgreSQL connection URL",
      process.env.DATABASE_URL || DEFAULT_SETUP_CONFIG.databaseUrl,
      (value) => validateUrl(value, "DATABASE_URL"),
    );

    const redisUrl = await promptValue(
      rl,
      "Redis connection URL",
      process.env.REDIS_URL || DEFAULT_SETUP_CONFIG.redisUrl,
      (value) => validateUrl(value, "REDIS_URL"),
    );

    console.log(`\n${colors.gray}Stellar${colors.reset}`);

    const stellarNetwork = normalizeNetwork(
      await promptValue(
        rl,
        "Stellar network",
        process.env.STELLAR_NETWORK || DEFAULT_SETUP_CONFIG.stellarNetwork,
        (value) => {
          normalizeNetwork(value);
        },
      ),
    );

    const stellarHorizonUrl = await promptValue(
      rl,
      "Stellar Horizon URL",
      process.env.STELLAR_HORIZON_URL || horizonUrlForNetwork(stellarNetwork),
      (value) => validateUrl(value, "STELLAR_HORIZON_URL"),
    );

    const stellarIssuerSecret = await promptValue(
      rl,
      "Stellar issuer secret key",
      process.env.STELLAR_ISSUER_SECRET || DEFAULT_SETUP_CONFIG.stellarIssuerSecret,
      (value) => {
        if (!value.trim().startsWith("S")) {
          throw new Error("STELLAR_ISSUER_SECRET should start with S.");
        }
      },
    );

    return {
      databaseUrl,
      redisUrl,
      stellarIssuerSecret,
      stellarNetwork,
      stellarHorizonUrl,
    };
  } finally {
    rl.close();
  }
}

export async function runSetupCommand(args: string[]): Promise<void> {
  const envPath = getEnvPath(args);
  const config = await promptSetupConfig();

  await writeEnvConfig(envPath, config);

  console.log(
    `\n${colors.green}${colors.bold}Saved configuration:${colors.reset} ${envPath}`,
  );
}

export function showHelp() {
  console.log(`
${colors.cyan}${colors.bold}Mobile Money Admin CLI${colors.reset}
${colors.gray}========================${colors.reset}

${colors.bold}Usage:${colors.reset}
  momo-cli <command> [options]

${colors.bold}Commands:${colors.reset}
  ${colors.green}setup${colors.reset}                    Interactive setup for database and Stellar credentials.
  ${colors.green}retry-batch <batch_id>${colors.reset}   Retry all failed or stuck transactions for a specific batch ID (UUID).

${colors.bold}Options:${colors.reset}
  --help, -h             Show this help information.
  --file, -f <path>      Config file path for setup. Defaults to .env.
`);
}

export async function runCli(args: string[]): Promise<void> {
  const command = args[0];
  const batchId = args[1];

  if (!command || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  if (command === "setup") {
    await runSetupCommand(args.slice(1));
    return;
  }

  if (command === "retry-batch") {
    if (!batchId) {
      console.error(
        `${colors.red}Error: Missing batch ID argument.${colors.reset}`,
      );
      console.log(`Usage: momo-cli retry-batch <batch_id>`);
      process.exitCode = 1;
      return;
    }

    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(batchId)) {
      console.error(
        `${colors.red}Error: Invalid batch ID format. Must be a valid UUID.${colors.reset}`,
      );
      process.exitCode = 1;
      return;
    }

    const [{ pool }, queueModule, transactionQueueModule] = await Promise.all([
      import("../config/database"),
      import("../queue/index.js"),
      import("../queue/transactionQueue.js"),
    ]);
    const { addTransactionJob } = queueModule;
    activePool = pool;
    activeTransactionQueue = transactionQueueModule.transactionQueue;

    console.log(
      `${colors.cyan}Searching for transactions in batch ${colors.bold}${batchId}${colors.reset}...`,
    );

    try {
      // Find all transactions matching the batchId in tags or metadata
      const query = `
        SELECT id, reference_number AS "referenceNumber", type, amount::text AS amount,
               phone_number AS "phoneNumber", provider, stellar_address AS "stellarAddress",
               status, tags, metadata, retry_count AS "retryCount"
        FROM transactions
        WHERE tags @> ARRAY[$1]::text[] OR metadata @> $2::jsonb
        ORDER BY created_at ASC
      `;
      const result = await pool.query(query, [
        batchId,
        JSON.stringify({ batchId }),
      ]);
      const transactions = result.rows;

      if (transactions.length === 0) {
        console.warn(
          `\n${colors.yellow}✗ No transactions found for batch ID: ${batchId}${colors.reset}`,
        );
        return;
      }

      // Aggregate stats
      const total = transactions.length;
      const completed = transactions.filter(
        (t) => t.status === TransactionStatus.Completed,
      ).length;
      const failed = transactions.filter(
        (t) => t.status === TransactionStatus.Failed,
      ).length;
      const pending = transactions.filter(
        (t) => t.status === TransactionStatus.Pending,
      ).length;
      const cancelled = transactions.filter(
        (t) => t.status === TransactionStatus.Cancelled,
      ).length;

      console.log(`\n${colors.bold}Batch Summary:${colors.reset}`);
      console.log(`  Total Transactions: ${total}`);
      console.log(`  ${colors.green}✓ Completed:${colors.reset} ${completed}`);
      console.log(`  ${colors.red}✗ Failed:${colors.reset} ${failed}`);
      console.log(`  ${colors.yellow}⚠ Pending:${colors.reset} ${pending}`);
      console.log(`  ${colors.gray}⊘ Cancelled:${colors.reset} ${cancelled}`);

      // Filter for retry-eligible transactions (Failed and Pending/Stuck)
      const retriable = transactions.filter(
        (t) =>
          t.status === TransactionStatus.Failed ||
          t.status === TransactionStatus.Pending,
      );

      if (retriable.length === 0) {
        console.log(
          `\n${colors.green}No transactions require retry in this batch.${colors.reset}`,
        );
        return;
      }

      console.log(
        `\n${colors.cyan}Re-queueing ${colors.bold}${retriable.length}${colors.reset} transaction(s) for retry...`,
      );



      for (const tx of retriable) {
        const prevStatus = tx.status;

        // 1. Update status back to pending and increment retry count in DB
        await pool.query(
          "UPDATE transactions SET status = $1, retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
          [TransactionStatus.Pending, tx.id],
        );

        // 2. Add job back to processing queue
        await addTransactionJob({
          transactionId: tx.id,
          type: tx.type,
          amount: tx.amount,
          phoneNumber: tx.phoneNumber,
          provider: tx.provider,
          stellarAddress: tx.stellarAddress,
        });

        console.log(
          `  ${colors.green}✓${colors.reset} Re-queued Ref: ${colors.bold}${tx.referenceNumber}${colors.reset} (ID: ${tx.id}) - status: ${prevStatus} -> pending`,
        );
      }

      console.log(
        `\n${colors.green}${colors.bold}Successfully re-queued all ${retriable.length} transaction(s) for batch ${batchId}.${colors.reset}`,
      );
    } catch (err) {
      console.error(
        `\n${colors.red}Error executing retry-batch command:${colors.reset}`,
        err,
      );
      process.exitCode = 1;
    }
  } else {
    console.error(
      `${colors.red}Error: Unknown command "${command}".${colors.reset}`,
    );
    showHelp();
    process.exitCode = 1;
  }
}

// Self-invocation logic if run directly
if (require.main === module) {
  (async () => {
    try {
      await runCli(process.argv.slice(2));
    } finally {
      // Cleanly shutdown pool and queue connection so CLI exits instantly
      await activePool?.end().catch(() => {});
      await activeTransactionQueue?.close().catch(() => {});
    }
  })();
}
