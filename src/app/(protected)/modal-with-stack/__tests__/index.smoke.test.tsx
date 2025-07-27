// __tests__/index.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import SecondScreen from "../index";

// Mock expo-router hooks and Link
jest.mock("expo-router", () => ({
  useRouter: () => ({ canGoBack: () => false, navigate: () => {} }),
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

describe("SecondScreen (index) Smoke Test", () => {
  it("renders SecondScreen without throwing", () => {
    expect(() => render(<SecondScreen />)).not.toThrow();
  });
});
