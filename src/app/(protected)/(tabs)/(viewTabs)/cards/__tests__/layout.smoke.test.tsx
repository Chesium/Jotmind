// src/app/(protected)/(tabs)/(viewTabs)/cards/__tests__/layout.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import Layout from "../_layout";

jest.mock("expo-router", () => {
  // 最小化 Stack，包含 Screen 属性
  const Stack = ({ children }: any) => children;
  Stack.Screen = () => null;
  const usePathname = () => "/";
  return { Stack, usePathname };
});

describe("Cards Layout Smoke Test", () => {
  it("renders Layout without throwing", () => {
    expect(() => render(<Layout />)).not.toThrow();
  });
});
