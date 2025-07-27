// src/app/(protected)/(tabs)/(viewTabs)/cards/__tests__/index.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import PersonCardView from "../index";

jest.mock("expo-router", () => ({
  useRouter: () => ({ canGoBack: () => false, navigate: () => {} }),
}));

jest.mock("@/utils/CardViewStore", () => ({
  __esModule: true,
  default: (selector: any) => selector({ map: {}, updateNode: () => {} }),
}));

jest.mock("@rneui/themed", () => ({ SearchBar: () => null }));
jest.mock("@/components/personCard", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/AddPersonButton", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("lunr", () => () => ({}));

describe("PersonCardView Smoke Test", () => {
  it("renders PersonCardView without throwing", () => {
    expect(() => render(<PersonCardView />)).not.toThrow();
  });
});
