// __tests__/modal.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import ModalScreen from "../modal";

// Mock AppText component
jest.mock("@/components/AppText", () => ({
  __esModule: true,
  AppText: (_: any) => null,
}));

describe("ModalScreen Smoke Test", () => {
  it("renders ModalScreen without throwing", () => {
    expect(() => render(<ModalScreen />)).not.toThrow();
  });
});
