import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import c, { AnyZodObject, Cypher } from "./cyphers";
import { z } from "zod";
import { ResAll, UpdateData } from "@my-repo/shared-types";

// export const config = {
//     url: NEO4JINFO.url, // URL for the Neo4j instance
//     username: NEO4JINFO.username, // Username for Neo4j authentication
//     password: NEO4JINFO.password, // Password for Neo4j authentication
//     indexName: "vector", // Name of the vector index
//     keywordIndexName: "keyword", // Name of the keyword index if using hybrid search
//     searchType: "vector" as const, // Type of search (e.g., vector, hybrid)
//     nodeLabel: "Chunk", // Label for the nodes in the graph
//     textNodeProperty: "text", // Property of the node containing text
//     embeddingNodeProperty: "embedding", // Property of the node containing embedding
// };

interface Neo4jGraphConfig {
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

    async close() {
        return await this.graph.close();
    }
}


// export async function testQuery() {
//     const exampleQuery = `match (v)-[r]-(u {label:"ARDF"}) return v,r,u`;
//     console.log("begin Neo4jGraph.initialize(config)");
//     const graph = await Neo4jGraph.initialize(config);
//     console.log(`begin graph.query: ${exampleQuery}`);
//     const res = await graph.query(exampleQuery);
//     return res;
// }

// export async function testOpenAIChain() {
//     const model = new OpenAI({ temperature: 0 });
//     const graph = await Neo4jGraph.initialize(config);
//     await graph.refreshSchema();
//     const chain = GraphCypherQAChain.fromLLM({ llm: model, graph });
//     // console.log(graph.getSchema());
//     return graph.getSchema();
//     // const res = await chain.invoke({
//     //     query: "What was the cast of the Casino?",
//     // });
// }