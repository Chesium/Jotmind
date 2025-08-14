import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import c, { AnyZodObject, Cypher } from "./cyphers";
import { z } from "zod";
import { ResAll, UpdateData } from "@my-repo/shared-types";
import { testDataCypher } from "./testDataCypher";

export interface Neo4jGraphConfig {
    url: string;
    username: string;
    password: string;
    database?: string;
    timeoutMs?: number;
    enhancedSchema?: boolean;
}

export class Neo4jWrapper {
    private graph: Neo4jGraph;
    private config: Neo4jGraphConfig;
    private initialized: boolean;
    constructor(database: string | undefined) {
        this.config = {
            url: process.env.NEO4J_URL as string,
            username: process.env.NEO4J_USERNAME as string,
            password: process.env.NEO4J_PASSWORD as string,
            database
        };
        this.initialized = false;
        // this.graph = await Neo4jGraph.initialize(config)
    }
    async initialize() {
        this.graph = await Neo4jGraph.initialize(this.config);
        this.initialized = true;
    }
    async query(string: string) {
        if (!this.initialized) {
            throw "Error: Neo4jWrapper instance has not been initialized."
        }
        return await this.graph.query(string);
    }

    async runCypher<P extends AnyZodObject, R extends z.ZodTypeAny | void = void>(
        c: Cypher<P, R>,
        p: z.input<P> // <- this is the dependent type
    ): Promise<z.output<R extends z.ZodTypeAny ? R : z.ZodTypeAny>> {
        const params = c.parameters.parse(p);
        const res = await this.graph.query(c.code, params);
        if (c.returns) {
            try {
                console.log("res:", JSON.stringify(res));
                return c.returns.parse(res) as z.output<R extends z.ZodTypeAny ? R : z.ZodTypeAny>
            } catch (e) {
                console.log(e);
            }
        } else {
            return res as z.output<R extends z.ZodTypeAny ? R : z.ZodTypeAny>;
        }
    }

    async getAll(): Promise<ResAll> {
        const entities = await this.runCypher(c.getEntities, {});
        const claims = await this.runCypher(c.getClaims, {});
        return {
            entities: entities.map(e => e.entity),
            claims: claims.map(r => { return { ...r.claim, args: r.args } })
        }
    }

    async update(data: UpdateData): Promise<void> {
        await this.runCypher(c.deleteAllClaims, { uuid: data.entity.uuid })
        await this.runCypher(c.updateEntity, data.entity)
        for (const claim of data.claims) {
            await this.runCypher(c.updateClaim, claim)
        }
    }

    async initConstraints(): Promise<void> {
        const cyphers =
            [`CREATE CONSTRAINT IF NOT EXISTS FOR (n:Person)  REQUIRE n.uuid IS UNIQUE`,
                `CREATE CONSTRAINT IF NOT EXISTS FOR (n:Event)   REQUIRE n.uuid IS UNIQUE`,
                `CREATE CONSTRAINT IF NOT EXISTS FOR (n:Concept) REQUIRE n.uuid IS UNIQUE`,
                `CREATE CONSTRAINT IF NOT EXISTS FOR (n:Place)   REQUIRE n.uuid IS UNIQUE`,
                `CREATE CONSTRAINT IF NOT EXISTS FOR (n:Claim)   REQUIRE n.uuid IS UNIQUE`,
                `CREATE CONSTRAINT IF NOT EXISTS FOR (n:Predicate) REQUIRE n.key IS UNIQUE`,
                `CREATE FULLTEXT INDEX entityText IF NOT EXISTS  FOR (n:Person|Event|Concept|Place) ON EACH [n.name, n.description]`,
                `CREATE FULLTEXT INDEX claimText IF NOT EXISTS  FOR (c:Claim) ON EACH [c.predicate, c.description, c.value_str]`]
        for (const cypher of cyphers) {
            await this.query(cypher);
        }
    }

    async hydrateTestData(): Promise<void> {
        await this.runCypher(testDataCypher, {});
    }

    async close() {
        return await this.graph.close();
    }
}