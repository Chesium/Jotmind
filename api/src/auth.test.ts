// auth.test.ts
import {jest} from "@jest/globals";

// Mock dependencies
jest.mock("better-auth", () => ({
  betterAuth: jest.fn(() => "auth-instance"),
}));
jest.mock("better-sqlite3", () => {
  return jest.fn().mockImplementation(() => ({
    prepare: jest.fn().mockReturnValue({
      get: jest.fn(),
      run: jest.fn(),
    }),
  }));
});
jest.mock("better-auth/plugins", () => ({
  createAuthMiddleware: (fn: any) => fn,
  customSession: (fn: any) => fn,
}));
jest.mock("neo4j-driver", () => ({
  driver: jest.fn(() => ({
    session: jest.fn(() => ({
      run: jest.fn(),
      close: jest.fn(),
    })),
  })),
  auth: {
    basic: jest.fn(),
  },
}));
jest.mock("./neo4j", () => {
  return {
    Neo4jWrapper: jest.fn().mockImplementation(() => ({
      initialize: jest.fn(),
      initConstraints: jest.fn(),
    })),
  };
});

// Re-import the module under test after mocks
import * as authModule from "./auth";

describe("auth.ts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("normalizeUsername", () => {
    it("lowercases, replaces non-alphanumeric with dash, and trims dashes", () => {
      const fn = authModule.normalizeUsername;
      expect(fn("User Name!")).toBe("user-name");
      expect(fn("Hello_World")).toBe("hello-world");
      expect(fn("----Trim----")).toBe("trim");
      expect(fn("MiXeD123Case")).toBe("mixed123case");
    });
  });

});