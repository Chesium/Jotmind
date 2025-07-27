// __tests__/also-nested.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import SecondAlsoNestedScreen from "../also-nested";

// Mock AppText
jest.mock("@/components/AppText", () => ({
  __esModule: true,
  AppText: (_: any) => null,
}));

describe("SecondAlsoNestedScreen Smoke Test", () => {
  it("renders SecondAlsoNestedScreen without throwing", () => {
    expect(() => render(<SecondAlsoNestedScreen />)).not.toThrow();
  });
});
