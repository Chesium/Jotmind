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

type UpdateNodeRecord = {
  type: "UpdateNode";
  oldNode: PersonNodeData;
  newNode: PersonNodeData;
};

type UpdatePropRecord = {
  type: "UpdateProp";
  id: Neo4jId;
  oldProp: Properties;
  newProp: Properties;
};

type UpdateRecord = UpdateNodeRecord | UpdatePropRecord;

interface CardViewState {
  actionHistoryPast: UpdateRecord[];
  actionHistoryFuture: UpdateRecord[];
  map: PersonNodeMap;
  fetchMap: (session: Session) => void;
  syncUpdates: (session: Session) => void;

  undo: () => void;
  redo: () => void;

  updateNode: (newNode: PersonNodeData) => void;
  updateProp: (id: Neo4jId, nprop: Properties) => void;
}

export const useCardViewStore = create<CardViewState>()(
  temporal(
    (set) => {
      const updateNode = (newNode: PersonNodeData) =>
        set((state) => {
          let id = newNode.elementId;
          return {
            actionHistoryPast: [
              ...state.actionHistoryPast,
              { type: "UpdateNode", oldNode: state.map[id], newNode: newNode },
            ],
            actionHistoryFuture: [], // maintaining zero branch
            map: { ...state.map, [id]: newNode },
          };
        });
      const updateProp = (id: Neo4jId, nprop: Properties) =>
        set((state) => {
          return {
            actionHistoryPast: [
              ...state.actionHistoryPast,
              {
                type: "UpdateProp",
                id: id,
                oldProp: state.map[id].properties,
                newProp: nprop,
              },
            ],
            actionHistoryFuture: [], // maintaining zero branch
            map: {
              ...state.map,
              [id]: { ...state.map[id], properties: nprop },
            },
          };
        });
      return {
        actionHistoryPast: [],
        actionHistoryFuture: [],
        map: {},
        fetchMap: async (session) => {
          console.log("begin fetching PersonNodeMap from Neo4j");
          set({
            actionHistoryPast: [],
            actionHistoryFuture: [],
            map: await retrieveInfoAsMap(session),
          });
        },
        syncUpdates: async (session) => {
          // todo
        },

        undo: () => {
          set((state) => {
            var length = state.actionHistoryPast.length;
            if (length >= 1) {
              var action = state.actionHistoryPast[length - 1];
              if (action.type == "UpdateNode") {
                let id = action.newNode.elementId;
                return {};
              } else {
              }
            } else {
              return state;
            }
          });
        },
        redo: () => {},
        updateNode: updateNode,
        updateProp: updateProp,
        // set((state) => ({
        //   updateHistory: state.updateHistory,
        //   map: { ...state.map, [id]: { ...state.map[id], properties: nprop } },
        // })),
      };
    }
    // {
    //   partialize: (state) => {
    //     const { updateHistory, map, ...rest } = state;
    //     return { updateHistory, map };
    //   },
    // }
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
