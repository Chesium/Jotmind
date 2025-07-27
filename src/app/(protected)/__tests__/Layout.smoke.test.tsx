// __tests__/protectedLayout.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import ProtectedLayout from "../_layout";

// Mock AuthContext
jest.mock("@/utils/authContext", () => {
  const React = require("react");
  return {
    AuthContext: React.createContext({ isReady: true, isLoggedIn: true }),
  };
});

// Mock expo-router Stack and Redirect
jest.mock("expo-router", () => {
  const Stack = ({ children }: any) => children;
  Stack.Screen = () => null;
  const Redirect = () => null;
  return { Stack, Redirect };
});

describe("ProtectedLayout Smoke Test", () => {
  it("renders ProtectedLayout without throwing", () => {
    expect(() => render(<ProtectedLayout />)).not.toThrow();
  });
});
