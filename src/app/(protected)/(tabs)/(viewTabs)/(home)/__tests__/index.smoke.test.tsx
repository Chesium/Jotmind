// index.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import IndexScreen from "../index";

// mock 路由、WebView、store
jest.mock("expo-router", () => ({
  useRouter: () => ({ canGoBack: () => false, navigate: () => {} }),
}));
jest.mock("react-native-webview", () => ({ WebView: () => null }));
jest.mock("@/utils/CardViewStore", () => ({
  __esModule: true,
  default: () => ({ map: {}, graphEdges: [] }),
}));

describe("IndexScreen Smoke Test", () => {
  it("renders IndexScreen without throwing", () => {
    expect(() => render(<IndexScreen />)).not.toThrow();
  });
});
