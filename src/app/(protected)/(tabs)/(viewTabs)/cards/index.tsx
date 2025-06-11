import { Neo4jId, Properties } from "@/utils/dataType";
import { create } from "zustand";
// import { temporal } from "zundo";
import { Session } from "neo4j-driver";
import PersonCard from "@/components/personCard";
import { ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useContext, useEffect } from "react";
import { AuthContext } from "@/utils/authContext";
import { immer } from "zustand/middleware/immer";
import { devtools } from "zustand/middleware";
import useCardViewStore from "@/utils/CardViewStore";
import { Button } from "@/components/Button";
import AddPersonButton from "@/components/AddPersonButton";

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
  const updateNode = useCardViewStore((state) => state.updateNode);
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
    <View>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {Object.keys(dataMap).map((id, i) => (
          <PersonCard
            id={id}
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
      <AddPersonButton
        callback={() => {
          // todo : add person node
        }}
      ></AddPersonButton>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    paddingVertical: 20,
    alignItems: "center",
    gap: 20,
  },
});
