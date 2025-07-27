import { render } from "@testing-library/react-native";
import React from "react";
import FourthScreen from "../table";

// Mock useRouter
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: () => {} }),
}));

// Mock AppText and Button
jest.mock("@/components/AppText", () => ({
  __esModule: true,
  AppText: (_: any) => null,
}));
jest.mock("@/components/Button", () => ({
  __esModule: true,
  Button: (_: any) => null,
}));

describe("FourthScreen (Table) Smoke Test", () => {
  it("renders FourthScreen without throwing", () => {
    expect(() => render(<FourthScreen />)).not.toThrow();
  });
});
