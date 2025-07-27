// src/app/(protected)/(tabs)/(viewTabs)/(home)/__tests__/graphFocus.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import GraphFocus from "../graphFocus";

// 注意：这里从 __tests__ 目录跳两级到 viewTabs，再进 cards
jest.mock("../../cards/CardViewFocus", () => ({
  __esModule: true,
  default: () => null,
}));

describe("GraphFocus Smoke Test", () => {
  it("renders GraphFocus without throwing", () => {
    expect(() => render(<GraphFocus />)).not.toThrow();
  });
});
