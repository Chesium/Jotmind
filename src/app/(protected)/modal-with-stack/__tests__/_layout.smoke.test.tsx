// __tests__/_layout.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import BottomTabsLayout from "../_layout";

// Mock expo-router Stack component
jest.mock("expo-router", () => {
  const Stack = ({ children }: any) => children;
  Stack.Screen = () => null;
  return { Stack };
});

describe("BottomTabsLayout Smoke Test", () => {
  it("renders BottomTabsLayout without throwing", () => {
    expect(() => render(<BottomTabsLayout />)).not.toThrow();
  });
});
