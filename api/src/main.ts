import express from "express";
import { createServer } from "http";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import cors from "cors";
import { auth } from "./auth";
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
  // return driver.session({ database: sess.neo4jDb });
}

const http = createServer(app);
// const io = new SocketIOServer(http);

// app.options('{*any}', cors());
// const io = new SocketIOServer(http, { cors: { origin: client_url, credentials: true }});


const FRONTEND = `${host}:${process.env.DEV_WEB_PORT}`;
// const FRONTEND = `http://localhost:5173`;

app.use(
  cors({
    origin: FRONTEND,      // exact host – not "*"
    credentials: true,     // needed if you send cookies / auth headers
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ── 1) Mount Better-Auth
app.all("/api/auth/{*any}", toNodeHandler(auth));           // official snippet

// JSON middleware comes *after* the auth handler
app.use(express.json());
// app.use(express.json(), cors({ origin: client_url, credentials: true }));

// ── 2) Neo4j driver (one driver for REST + WS)
// const wrapper = new Neo4jWrapper(config);
// const driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "password"));

// ── 3) Protected REST endpoint example


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

app.post("/api/update", async (req, res) => {
  try {
    // 运行时校验
    // console.log("body:",req);
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

// import { fileURLToPath } from 'url';
// import { dirname } from 'path';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

// const distDir = path.join(__dirname, "..", "client");
// app.use(express.static(distDir));
// app.get("/{*any}", (_, res) => res.sendFile(path.join(distDir, "index.html")));

// const PORT = process.env.PORT || 8080;
// app.listen(PORT, () => console.log(`listening on http://localhost:${PORT}`));

// ── 4) WebSocket namespace (re-uses same Neo4j driver)
// io.of("/neo4j").use(async (socket, next) => {
//   // Simple cookie auth guard
//   const headers = new Headers([["cookie", socket.request.headers.cookie ?? ""]]);
//   const s = await auth.api.getSession({ headers });
//   if (!s) return next(new Error("unauthenticated"));
//   socket.data.user = s.user;
//   next();
// });

// io.of("/neo4j").on("connection", (socket) => {
//   socket.on("cypher", async (query: string, ack) => {
//     try {
//     //   const neo = driver.session();
//       const res = await wrapper.query(query);
//     //   await neo.close();
//       ack(null, res);
//     } catch (e) {
//       ack(e);
//     }
//   });
// });

http.listen(port, () => console.log(`API + WS listening on :${port}`));
