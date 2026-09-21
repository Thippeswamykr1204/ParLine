import { browserReader, type ReadText } from "./sources";
import { makeApiReader } from "./api-source";

/** "static" (default): read public/data/*.csv.  "api": read the Tier 6 FastAPI backend. */
export const DATA_SOURCE: "static" | "api" = process.env.NEXT_PUBLIC_DATA_SOURCE === "api" ? "api" : "static";
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export const activeReader: ReadText = DATA_SOURCE === "api" ? makeApiReader(API_BASE_URL) : browserReader;
