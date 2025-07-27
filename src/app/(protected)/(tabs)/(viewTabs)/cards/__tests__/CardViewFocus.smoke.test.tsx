// src/app/(protected)/(tabs)/(viewTabs)/cards/__tests__/CardViewFocus.smoke.test.tsx
import { render } from "@testing-library/react-native";
import React from "react";
import PersonFocus from "../CardViewFocus";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "id" }),
  useNavigation: () => ({
    addListener: () => {},
    removeListener: () => {},
    dispatch: () => {},
  }),
}));

jest.mock("@/utils/CardViewStore", () => ({
  __esModule: true,
  default: (selector: any) =>
    selector({
      map: { id: { properties: {} } },
      updateProp: () => {},
      undo: () => {},
      redo: () => {},
      syncUpdates: async () => {},
      actionHistoryPast: [],
      actionHistoryFuture: [],
    }),
}));

jest.mock("@/utils/authContext", () => ({ AuthContext: {} }));
jest.mock("@expo/vector-icons", () => ({ MaterialCommunityIcons: () => null }));
jest.mock("@/components/personCard", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/PropertiesEditor", () => ({
  __esModule: true,
  PropertiesEditor: () => null,
}));
jest.mock("@/components/AppText", () => ({
  __esModule: true,
  AppText: () => null,
}));

describe("CardViewFocus (PersonFocus) Smoke Test", () => {
  it("renders PersonFocus without throwing", () => {
    expect(() => render(<PersonFocus />)).not.toThrow();
  });
});
