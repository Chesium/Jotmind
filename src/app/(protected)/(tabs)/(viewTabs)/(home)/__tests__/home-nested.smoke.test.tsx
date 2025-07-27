// src/app/(protected)/(tabs)/(viewTabs)/(home)/__tests__/home-nested.smoke.test.tsx

import { render } from "@testing-library/react-native";
import React from "react";
import HomeNestedScreen from "../home-nested";

describe("HomeNestedScreen Smoke Test", () => {
  it("should render without throwing", () => {
    expect(() => render(<HomeNestedScreen />)).not.toThrow();
  });
});
