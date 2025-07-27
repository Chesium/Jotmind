// __tests__/_layout.smoke.test.tsx
// Mock global.css import
jest.mock("../../../global.css", () => ({}));
import { render } from "@testing-library/react-native";
import React from "react";
import RootLayout from "../_layout";

// Mock AuthProvider to simply render children
jest.mock("@/utils/authContext", () => {
  const React = require("react");
  return { AuthProvider: ({ children }: any) => children };
});

// Mock expo-router Stack component
jest.mock("expo-router", () => {
  const Stack = ({ children }: any) => children;
  Stack.Screen = () => null;
  return { Stack };
});

// Mock StatusBar
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));

describe("RootLayout Smoke Test", () => {
  it("renders RootLayout without throwing", () => {
    expect(() => render(<RootLayout />)).not.toThrow();
  });
});
