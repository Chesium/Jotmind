// src/app/(protected)/(tabs)/__tests__/account.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import FourthScreen from "../account";

// Mock useRouter hook
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: () => {} }),
}));

// Mock AuthContext by requiring React inside factory
jest.mock("@/utils/authContext", () => {
  const React = require("react");
  return {
    AuthContext: React.createContext({ username: "user", logOut: () => {} }),
  };
});

// Mock AppText and Button components
jest.mock("@/components/AppText", () => ({
  __esModule: true,
  AppText: (_: any) => null,
}));
jest.mock("@/components/Button", () => ({
  __esModule: true,
  Button: (_: any) => null,
}));

// Mock expo-image
jest.mock("expo-image", () => ({ Image: () => null }));

// Mock cn utility
jest.mock("@/utils/cn", () => ({ cn: (...args: any[]) => "" }));

// Mock require of avatar image
jest.mock("../avatarDefault2.jpg", () => 1);

describe("FourthScreen (Account) Smoke Test", () => {
  it("renders FourthScreen without throwing", () => {
    expect(() => render(<FourthScreen />)).not.toThrow();
  });
});
