import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { createAuthMiddleware, customSession } from "better-auth/plugins";
import neo4j from "neo4j-driver";
import { Neo4jWrapper } from "./neo4j";

export const db = new Database("./sqlite.db", { verbose: console.log });

console.log(process.env.NEO4J_URL);

const driver = neo4j.driver(
    process.env.NEO4J_URL as string,
    neo4j.auth.basic(process.env.NEO4J_USERNAME as string, process.env.NEO4J_PASSWORD as string)
)

async function newNeo4jDB(name: string) {
    // const neo4jDb = slugify(name);
    const sys = driver.session({ database: "system" });
    try {
        await sys.run(`CREATE DATABASE \`${name}\` IF NOT EXISTS`);
    } finally {
        await sys.close();
    }
    const wrapper = new Neo4jWrapper(name);
    await wrapper.initialize();
    await wrapper.initConstraints();
    return name
}

const host = process.env.HOST;
const FRONTEND = `${host}:${process.env.DEV_WEB_PORT}`;

function normalizeUsername(username: string): string {
  return username
    .toLowerCase()               // 转换成小写
    .replace(/[^a-z0-9]+/g, "-")  // 非字母数字替换为 dash
    .replace(/^-+|-+$/g, "");     // 去掉首尾多余的 dash
}

export const auth = betterAuth({
    database: db,
    trustedOrigins: [FRONTEND],
    emailAndPassword: {
        enabled: true,
        autoSignIn: true,
    },
    socialProviders: {
        github: {
            clientId: process.env.GITHUB_CLIENT_ID as string,
            clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
        },
    },
    plugins: [
        customSession(async ({ user, session }) => {
            // ② 同步查询用户自定义字段
            const stmt = db.prepare(`
        SELECT neo4j_db, initialized
        FROM   user
        WHERE  id = ?
        LIMIT  1
      `);

            // better-sqlite3 的 .get() 直接返回行对象或 undefined
            const meta = stmt.get(session.userId) as
                | { neo4j_db: string | null; enc_token: string | null; initialized : boolean | null }
                | undefined;

            // ③ 组装自定义 Session 对象
            return {
                user,                    // Better-Auth 默认字段
                session,                 // 同上
                neo4jDb: meta?.neo4j_db ?? undefined,
                initialized: meta?.initialized ?? undefined,
            };
        }),
    ],
    hooks: {
        after: createAuthMiddleware(async (ctx) => {
            if (!ctx.path.startsWith("/sign-up")) return;

            const newSession = ctx.context.newSession;  // newly created session
            if (!newSession) return;

            const uid = newSession.user.id;
            
            const displayName = `user-${normalizeUsername(newSession.user.name)}-${uid}`;

            
            db.prepare(
                `UPDATE user SET neo4j_db = ?, initialized = 0 WHERE id = ?`
            ).run(displayName, uid);

            await newNeo4jDB(displayName);

            // 2-b) persist db-name in SQLite
        }),
    },
})