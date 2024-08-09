import * as lancedb from "@lancedb/lancedb";
import {
  Schema,
  Field,
  Float32,
  FixedSizeList,
  Utf8,
  Float64,
} from "apache-arrow";

import readline from "readline";
import fs from "fs";
import path from "path";

const schema = new Schema([
  new Field("create_time", new Float64(), true),
  new Field("title", new Utf8(), true),
  new Field("url", new Utf8(), true),
  new Field("image", new Utf8(), true),
  new Field("text", new Utf8(), true),
  new Field(
    "vector",
    new FixedSizeList(384, new Field("item", new Float32())),
    true
  ),
]);

async function getConnection() {
  const bucket = process.env.AWS_BUCKET || "";
  if (bucket) {
    return await lancedb.connect(bucket, {
      storageOptions: {
        awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        s3Express: "true",
        region: process.env.AWS_REGION || "",
        awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      },
    });
  } else {
    // Let open source users could one click deploy
    const localDirectory = process.cwd();
    return await lancedb.connect(localDirectory);
  }
}

async function getTable(db: any, tableName: string): Promise<lancedb.Table> {
  if ((await db.tableNames()).includes(tableName)) {
    return await db.openTable(tableName);
  } else {
    return await db.createEmptyTable(tableName, schema);
  }
}

export async function append(tableName: string, data: lancedb.Data) {
  const db = await getConnection();
  const table = await getTable(db, tableName);
  await table.add(data);
  return table;
}

export async function readFromJsonlFile(
  url: string
): Promise<Array<Record<string, unknown>>> {
  const sanitizedUrl = url.replace(/\//g, "-");
  const filePath = path.join(process.cwd(), `${sanitizedUrl}.jsonl`);

  console.log(`Reading from ${filePath}`);

  const data: Array<Record<string, unknown>> = [];

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim()) {
      data.push(JSON.parse(line));
    }
  }

  return data;
}

export async function ingest_jsonl(url: string, userId: string) {
  const data = await readFromJsonlFile(url);
  const table = await append(userId, data);
  if (Math.random() < 1 / 10) {
    await table.optimize({ cleanupOlderThan: new Date() });
    console.log(`${userId} table optimized`);
  } else {
    console.log(`${userId} table not optimized this time`);
  }
}

export async function handleRequest(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  const { method } = req;

  if (path === "/api/index/jsonl" && method === "POST") {
    const { url, userId } = await req.json();
    try {
      await ingest_jsonl(url, userId);
      return Response.json("Success");
    } catch (error) {
      console.error(error);
      return Response.json("Failed to index markdown", { status: 500 });
    }
  }

  if (path === "/") return Response.json("Welcome to memfree vector service!");
  return Response.json("Page not found", { status: 404 });
}
const server = Bun.serve({
  port: process.env.PORT || 3001,
  fetch: handleRequest,
});

console.log(`Listening on ${server.url}`);
