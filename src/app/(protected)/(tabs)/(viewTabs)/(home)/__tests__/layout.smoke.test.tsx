// layout.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import Layout from "../_layout";

jest.mock("expo-router", () => {
  // 简易 Stack，忽略 children
  const StackComp = ({ children }: any) => children;
  // 必须有 Screen 属性，返回 null 避免渲染
  StackComp.Screen = () => null;
  return { Stack: StackComp };
});

describe("Layout Smoke Test", () => {
  it("renders Layout without throwing", () => {
    expect(() => render(<Layout />)).not.toThrow();
  });
});
