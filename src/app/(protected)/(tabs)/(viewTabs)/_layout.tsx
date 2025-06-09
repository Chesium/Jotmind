import { Tabs } from "expo-router";
import React from "react";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

export default function BottomTabsLayout() {
  return (
    <Tabs
      screenOptions={{ tabBarActiveTintColor: "teal" }}
      backBehavior="order"
    >
      <Tabs.Screen
        name="(home)"
        options={{
          title: "Graph View",
          headerShown: false,
          tabBarLabel: "Graph",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="graph" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cards"
        options={{
          title: "Cards",
          headerShown: false,
          popToTopOnBlur: true,
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="view-sequential"
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="table"
        options={{
          // tabBarBadge: 2,
          tabBarBadgeStyle: {
            backgroundColor: "tomato",
            color: "white",
          },
          title: "Table",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="table" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
