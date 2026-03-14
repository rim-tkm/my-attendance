import path from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import type { WorkRecord, OpenRecord } from "./attendance";

const DATA_DIR = path.join(process.cwd(), "data");
const RECORDS_DIR = path.join(DATA_DIR, "records");

function recordsPath(userId: string): string {
  return path.join(RECORDS_DIR, `${userId}.json`);
}

function openPath(userId: string): string {
  return path.join(RECORDS_DIR, `${userId}-open.json`);
}

export function getRecords(userId: string): WorkRecord[] {
  try {
    const filePath = recordsPath(userId);
    if (existsSync(filePath)) {
      const json = readFileSync(filePath, "utf-8");
      return JSON.parse(json);
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveRecords(userId: string, records: WorkRecord[]): void {
  try {
    if (!existsSync(RECORDS_DIR)) {
      mkdirSync(RECORDS_DIR, { recursive: true });
    }
    writeFileSync(
      recordsPath(userId),
      JSON.stringify(records, null, 0),
      "utf-8"
    );
  } catch (e) {
    console.error("Failed to save records:", e);
    throw e;
  }
}

export function getOpenRecord(userId: string): OpenRecord | null {
  try {
    const filePath = openPath(userId);
    if (existsSync(filePath)) {
      const json = readFileSync(filePath, "utf-8");
      return JSON.parse(json);
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveOpenRecord(userId: string, record: OpenRecord | null): void {
  try {
    if (!existsSync(RECORDS_DIR)) {
      mkdirSync(RECORDS_DIR, { recursive: true });
    }
    const filePath = openPath(userId);
    if (record === null) {
      if (existsSync(filePath)) {
        const fs = require("fs");
        fs.unlinkSync(filePath);
      }
    } else {
      writeFileSync(filePath, JSON.stringify(record), "utf-8");
    }
  } catch (e) {
    console.error("Failed to save open record:", e);
    throw e;
  }
}
