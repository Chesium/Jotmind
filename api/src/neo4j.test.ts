// Mock @langchain/community/graphs/neo4j_graph
const mockGraphInstance = {
  query: jest.fn(),
  close: jest.fn(),
};
jest.mock("@langchain/community/graphs/neo4j_graph", () => ({
  Neo4jGraph: {
    initialize: jest.fn(() => Promise.resolve(mockGraphInstance)),
  },
}));

// Mock cyphers module
const mockCypherObj = (name: string) => ({
  code: `${name}-code`,
  parameters: { parse: jest.fn((p) => p) },
  returns: { parse: jest.fn((r) => r) },
});
jest.mock("./cyphers", () => ({
  __esModule: true,
  default: {
    getEntities: { code: "getEntities", parameters: { parse: jest.fn(() => ({})) }, returns: { parse: jest.fn((r) => r) } },
    getClaims: { code: "getClaims", parameters: { parse: jest.fn(() => ({})) }, returns: { parse: jest.fn((r) => r) } },
    deleteAllClaims: mockCypherObj("deleteAllClaims"),
    updateEntity: mockCypherObj("updateEntity"),
    updateClaim: mockCypherObj("updateClaim"),
  },
}));

// Mock testDataCypher
jest.mock("./testDataCypher", () => ({
  testDataCypher: { code: "testData", parameters: { parse: jest.fn(() => ({})) } },
}));

import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import c from "./cyphers";
import { testDataCypher } from "./testDataCypher";
import { Neo4jWrapper } from "./neo4j";

describe("Neo4jWrapper", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("initialize() should call Neo4jGraph.initialize with correct config", async () => {
    process.env.NEO4J_URL = "url";
    process.env.NEO4J_USERNAME = "user";
    process.env.NEO4J_PASSWORD = "pass";
    const wrapper = new Neo4jWrapper("testdb");

    await wrapper.initialize();

    expect(Neo4jGraph.initialize).toHaveBeenCalledWith({
      url: "url",
      username: "user",
      password: "pass",
      database: "testdb",
    });
  });

  it("query() should throw if not initialized", async () => {
    const wrapper = new Neo4jWrapper(undefined);
    await expect(wrapper.query("MATCH (n) RETURN n")).rejects.toMatch(
      /not been initialized/
    );
  });

  it("query() should call graph.query when initialized", async () => {
    const wrapper = new Neo4jWrapper(undefined);
    await wrapper.initialize();
    mockGraphInstance.query.mockResolvedValueOnce("result");

    const res = await wrapper.query("MATCH (n)");
    expect(mockGraphInstance.query).toHaveBeenCalledWith("MATCH (n)");
    expect(res).toBe("result");
  });

  it("runCypher() should parse params, query graph, and parse results", async () => {
    const wrapper = new Neo4jWrapper(undefined);
    await wrapper.initialize();

    const mockC = {
      code: "some-code",
      parameters: { parse: jest.fn(() => ({ parsed: "params" })) },
      returns: { parse: jest.fn(() => "parsed-result") },
    };
    mockGraphInstance.query.mockResolvedValueOnce("raw-result");

    const result = await wrapper.runCypher(mockC as any, { input: "data" });

    expect(mockC.parameters.parse).toHaveBeenCalledWith({ input: "data" });
    expect(mockGraphInstance.query).toHaveBeenCalledWith("some-code", {
      parsed: "params",
    });
    expect(mockC.returns.parse).toHaveBeenCalledWith("raw-result");
    expect(result).toBe("parsed-result");
  });

  it("getAll() should return entities and claims mapped correctly", async () => {
    const wrapper = new Neo4jWrapper(undefined);
    await wrapper.initialize();

    (wrapper.runCypher as any) = jest
      .fn()
      .mockResolvedValueOnce([{ entity: "E1" }])
      .mockResolvedValueOnce([{ claim: { id: 1 }, args: [1, 2] }]);

    const res = await wrapper.getAll();

    expect(res).toEqual({
      entities: ["E1"],
      claims: [{ id: 1, args: [1, 2] }],
    });
  });

  it("update() should call runCypher for deleteAllClaims, updateEntity, and each claim", async () => {
    const wrapper = new Neo4jWrapper(undefined);
    await wrapper.initialize();
    const runSpy = jest.spyOn(wrapper as any, "runCypher").mockResolvedValue({});

    const data = {
      entity: { uuid: "uuid1" },
      claims: [{ id: 1 }, { id: 2 }],
    } as any;

    await wrapper.update(data);

    expect(runSpy).toHaveBeenNthCalledWith(1, c.deleteAllClaims, {
      uuid: "uuid1",
    });
    expect(runSpy).toHaveBeenNthCalledWith(2, c.updateEntity, data.entity);
    expect(runSpy).toHaveBeenNthCalledWith(3, c.updateClaim, { id: 1 });
    expect(runSpy).toHaveBeenNthCalledWith(4, c.updateClaim, { id: 2 });
  });

  it("initConstraints() should run all constraint cyphers", async () => {
    const wrapper = new Neo4jWrapper(undefined);
    await wrapper.initialize();
    const querySpy = jest.spyOn(wrapper as any, "query").mockResolvedValue({});

    await wrapper.initConstraints();

    expect(querySpy).toHaveBeenCalledTimes(8);
    expect(querySpy.mock.calls[0][0]).toMatch(/CREATE CONSTRAINT/);
  });

  it("hydrateTestData() should run testDataCypher", async () => {
    const wrapper = new Neo4jWrapper(undefined);
    await wrapper.initialize();
    const runSpy = jest.spyOn(wrapper as any, "runCypher").mockResolvedValue({});

    await wrapper.hydrateTestData();

    expect(runSpy).toHaveBeenCalledWith(testDataCypher, {});
  });

  it("close() should call graph.close", async () => {
    const wrapper = new Neo4jWrapper(undefined);
    await wrapper.initialize();

    await wrapper.close();

    expect(mockGraphInstance.close).toHaveBeenCalled();
  });
});