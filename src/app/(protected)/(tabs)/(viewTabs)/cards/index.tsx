import { Neo4jId, Properties } from "@/utils/dataType";
import {
  PersonNodeData,
  PersonNodeMap,
  retrieveInfoAsMap,
} from "@/utils/neo4jconnector";
import { create } from "zustand";
import { temporal } from "zundo";
import { Session } from "neo4j-driver";
import PersonCard from "@/components/personCard";
import { ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useContext, useEffect } from "react";
import { AuthContext } from "@/utils/authContext";

type UpdateType = PersonNodeData | { id: Neo4jId; nprop: Properties };

interface CardViewState {
  updateHistory: UpdateType[];
  map: PersonNodeMap;
  fetchMap: (session: Session) => void;
  syncUpdates: (session: Session) => void;
  updateNode: (newNode: PersonNodeData) => void;
  updateProp: (id: Neo4jId, nprop: Properties) => void;
}

export const useCardViewStore = create<CardViewState>()(
  temporal(
    (set) => ({
      updateHistory: [],
      map: {},
      fetchMap: async (session) => {
        console.log("begin fetching PersonNodeMap from Neo4j");
        set({ updateHistory: [], map: await retrieveInfoAsMap(session) });
      },
      syncUpdates: async (session) => {
        // todo
      },
      updateNode: (newNode) =>
        set((state) => ({
          updateHistory: state.updateHistory,
          map: { ...state.map, [newNode.elementId]: newNode },
        })),
      updateProp: (id, nprop) =>
        set((state) => ({
          updateHistory: state.updateHistory,
          map: { ...state.map, [id]: { ...state.map[id], properties: nprop } },
        })),
    }),
    {
      partialize: (state) => {
        const { updateHistory, map, ...rest } = state;
        return { updateHistory, map };
      },
    }
  )
);

export default function PersonCardView() {
  // {
  //   data,
  //   onFocus,
  // }: {
  //   data: PersonNodeMap;
  //   onFocus: OnFocus;
  // }
  const router = useRouter();
  const dataMap = useCardViewStore((state) => state.map);
  // const fetchMap = useCardViewStore((state) => state.fetchMap);

  // const authContext = useContext(AuthContext);
  // useEffect(() => {
  //   if (authContext.session !== null) {
  //     fetchMap(authContext.session);
  //   } else {
  //     console.log("ERR: authContext.session is nulls");
  //   }
  // }, []);

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      {Object.values(dataMap).map((nodeData, i) => (
        <PersonCard
          data={nodeData}
          key={`PersonCard${i}`}
          onFocus={(id) => {
            router.navigate({
              pathname: "/(protected)/(tabs)/(viewTabs)/cards/CardViewFocus",
              params: { id: id },
            });
          }}
        ></PersonCard>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    paddingVertical: 20,
    alignItems: "center",
    gap: 20,
  },
});
