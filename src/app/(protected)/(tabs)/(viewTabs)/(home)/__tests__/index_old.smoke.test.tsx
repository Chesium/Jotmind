// index_old.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import IndexOldScreen from "../index_old";

// mock 路由、Link、AppText、Button
jest.mock("expo-router", () => ({
  useRouter: () => ({ canGoBack: () => false, back: () => {} }),
  Link: (_: any) => null,
}));
jest.mock("@/components/AppText", () => ({
  __esModule: true,
  AppText: (_: any) => null,
}));
jest.mock("@/components/Button", () => ({
  __esModule: true,
  Button: (_: any) => null,
}));

describe("IndexOldScreen Smoke Test", () => {
  it("renders IndexOldScreen without throwing", () => {
    expect(() => render(<IndexOldScreen />)).not.toThrow();
  });
});
