import express from "express";
import { createServer } from "http";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import cors from "cors";
import { auth, db } from "./auth";
import { Neo4jWrapper } from "./neo4j";
import { ZUpdateData } from "@my-repo/shared-types";
import { $ZodError, treeifyError } from "zod/v4/core";

const app = express();

const host = process.env.HOST;
const port = process.env.DEV_API_PORT;

async function openGraphSession(headers: Headers) {
  const sess = await auth.api.getSession({ headers });
  if (!sess) throw new Error("unauthenticated");
  const wrapper = new Neo4jWrapper(sess.neo4jDb);
  await wrapper.initialize();
  return wrapper;
}

const http = createServer(app);

const FRONTEND = `${host}:${process.env.DEV_WEB_PORT}`;

app.use(
  cors({
    origin: FRONTEND,      // exact host – not "*"
    credentials: true,     // needed if you send cookies / auth headers
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ── 1) Mount Better-Auth
app.all("/api/auth/{*any}", toNodeHandler(auth));
app.use(express.json());


app.get("/healthz", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/fetchall", async (req, res) => {
  try {
    console.log("here");
    const neo = await openGraphSession(fromNodeHeaders(req.headers));
    const records = await neo.getAll();
    await neo.close();
    res.json(records);
  } catch {
    res.status(401).end();
  }
});

app.get("/api/hydratetest", async (req, res) => {
  try {
    console.log("hydratetest");
    const neo = await openGraphSession(fromNodeHeaders(req.headers));
    const records = await neo.hydrateTestData();
    await neo.close();
    const sess = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    db.prepare(
      `UPDATE user SET initialized = 1 WHERE id = ?`
    ).run(sess.user.id);
    res.json(records);
  } catch {
    res.status(401).end();
  }
});

app.post("/api/update", async (req, res) => {
  try {
    console.log(req.body);
    const data = ZUpdateData.parse(req.body);
    const neo = await openGraphSession(fromNodeHeaders(req.headers));
    await neo.update(data);
    await neo.close();
    res.status(201).json(data);
  } catch (err) {
    if (err instanceof $ZodError) {
      return res.status(400).json({
        error: "Invalid request",
        details: treeifyError(err),
      });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

http.listen(port, () => console.log(`API + WS listening on :${port}`));
