// __tests__/_layout.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import BottomTabsLayout from "../_layout";

// Mock expo-router Tabs component
jest.mock("expo-router", () => {
  const Tabs = ({ children }: any) => children;
  Tabs.Screen = () => null;
  return { Tabs };
});

// Mock MaterialCommunityIcons icon component
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => () => null);

describe("BottomTabsLayout Smoke Test", () => {
  it("renders BottomTabsLayout without throwing", () => {
    expect(() => render(<BottomTabsLayout />)).not.toThrow();
  });
});
