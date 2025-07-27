// __tests__/nested.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import SecondNestedScreen from "../nested";

// Mock expo-router Link
jest.mock("expo-router", () => ({
  Link: ({ children }: any) => null,
}));

// Mock AppText
jest.mock("@/components/AppText", () => ({
  __esModule: true,
  AppText: (_: any) => null,
}));

// Mock Button
jest.mock("@/components/Button", () => ({
  __esModule: true,
  Button: (_: any) => null,
}));

describe("SecondNestedScreen Smoke Test", () => {
  it("renders SecondNestedScreen without throwing", () => {
    expect(() => render(<SecondNestedScreen />)).not.toThrow();
  });
});
