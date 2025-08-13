import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { createAuthMiddleware, customSession } from "better-auth/plugins";
import neo4j from "neo4j-driver";

const db = new Database("./sqlite.db", { verbose: console.log });

console.log(process.env.NEO4J_URL);

const driver = neo4j.driver(
    process.env.NEO4J_URL as string,
    neo4j.auth.basic(process.env.NEO4J_USERNAME as string, process.env.NEO4J_PASSWORD as string)
)

function slugify(raw: string) {
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

async function newNeo4jDB(name: string) {
    const neo4jDb = slugify(name);
    const sys = driver.session({ database: "system" });
    try {
        await sys.run(`CREATE DATABASE \`${neo4jDb}\` IF NOT EXISTS`);
    } finally {
        await sys.close();
    }
    return neo4jDb
}

const host = process.env.HOST;
const FRONTEND = `${host}:${process.env.DEV_WEB_PORT}`;

export const auth = betterAuth({
    database: db,
    trustedOrigins: [FRONTEND],
    emailAndPassword: {
        enabled: true,
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
        SELECT neo4j_db
        FROM   user
        WHERE  id = ?
        LIMIT  1
      `);

            // better-sqlite3 的 .get() 直接返回行对象或 undefined
            const meta = stmt.get(session.userId) as
                | { neo4j_db: string | null; enc_token: string | null }
                | undefined;

            // ③ 组装自定义 Session 对象
            return {
                user,                    // Better-Auth 默认字段
                session,                 // 同上
                neo4jDb: meta?.neo4j_db ?? undefined,
            };
        }),
    ],
    hooks: {
        after: createAuthMiddleware(async (ctx) => {
            if (!ctx.path.startsWith("/sign-up")) return;

            const newSession = ctx.context.newSession;  // newly created session
            if (!newSession) return;

            const uid = newSession.user.id;
            const displayName = newSession.user.name ?? `user_${uid}`;

            const neo4jDb = await newNeo4jDB(displayName);

            // 2-b) persist db-name in SQLite
            db.prepare(
                `UPDATE user SET neo4j_db = ? WHERE id = ?`
            ).run(neo4jDb, uid);
        }),
    },
})