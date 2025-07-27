// __tests__/signup.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import SignupScreen from "../signup";

// Mock useRouter hook
jest.mock("expo-router", () => ({ useRouter: () => ({ push: () => {} }) }));

// Mock AuthContext
jest.mock("@/utils/authContext", () => {
  const React = require("react");
  return {
    AuthContext: React.createContext({
      logIn: (_: any) => {},
      connector: { connectToNeo4j: () => {}, createUser: async () => {} },
    }),
  };
});

// Mock UI components
jest.mock("@/components/AppText", () => ({
  __esModule: true,
  AppText: () => null,
}));
jest.mock("@/components/Button", () => ({
  __esModule: true,
  Button: () => null,
}));

// Mock react-hook-form
jest.mock("react-hook-form", () => ({
  useForm: () => ({
    control: {},
    handleSubmit: (fn: any) => fn,
    formState: { errors: {} },
  }),
  Controller: ({ render }: any) =>
    render({ field: { onChange: () => {}, onBlur: () => {}, value: "" } }),
}));

describe("SignupScreen Smoke Test", () => {
  it("renders SignupScreen without throwing", () => {
    expect(() => render(<SignupScreen />)).not.toThrow();
  });
});
