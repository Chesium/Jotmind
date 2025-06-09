import PersonCard from "@/components/personCard";
import { PropertiesEditor } from "@/components/PropertiesEditor";
import { Neo4jId, Properties } from "@/utils/dataType";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { useCardViewStore } from ".";
import { StyleSheet } from "react-native";
import { useEffect } from "react";

export default function PersonFocus() {
  // route params
  const params = useLocalSearchParams();
  const id = params.id as Neo4jId;
  // zustand states & states
  const data = useCardViewStore((state) => state.map[id]);
  const setDataProp = useCardViewStore((state) => state.updateProp);
  // zundo states & actions
  const { pastStates, futureStates, undo, redo, clear } =
    useCardViewStore.temporal.getState();
  const canUndo = pastStates.length > 0;
  const canRedo = futureStates.length > 0;

  useEffect(() => {
    clear();
  }, []);

  return (
    <ScrollView contentContainerStyle={style.personFocus}>
      <PersonCard data={data} onFocus={(e) => {}}></PersonCard>
      <View style={style.propertiesEditorToolbar}>
        <MaterialCommunityIcons
          name="undo"
          style={style.undo}
          size={20}
          color={canUndo ? "#666666" : "#cccccc"}
          onPress={(e) => {
            if (canUndo) {
              console.log("undo");
              console.log(pastStates);
              undo();
              // undoDataProp();
              // dispatch(ActionCreators.undo());
            } else {
              console.log("cannot undo");
            }
          }}
        />
        <MaterialCommunityIcons
          name="redo"
          style={style.redo}
          size={20}
          color={canRedo ? "#666666" : "#cccccc"}
          onPress={
            // redoDataProp
            (e) => {
              if (canRedo) {
                console.log("redo");
                redo();
              } else {
                console.log("cannot redo");
              }
              // dispatch(ActionCreators.redo());
            }
          }
        />
        <MaterialCommunityIcons
          name="plus"
          style={style.plus}
          size={20}
          color="#666666"
          onPress={(e) => {
            var i = 1;
            while (data.properties[`newProp${i}`] !== undefined) {
              i++;
            }
            var nprop: Properties = {};
            nprop[`newProp${i}`] = "";
            setDataProp(id, Object.assign({ ...nprop }, data.properties));
          }}
        />
      </View>
      <PropertiesEditor
        data={data}
        onChangeProperty={(o, n) => {
          setDataProp(id, n);
          console.log(n);
        }}
        onSetPropertyKey={(o, n) => {
          console.log(`change key: ${o}=>${n}`);
        }}
        onSetPropertyValue={(k, v) => {
          console.log(`change value: Prop[${k}]<-${v}`);
        }}
      ></PropertiesEditor>
    </ScrollView>
  );
}

const style = StyleSheet.create({
  personFocus: {
    alignItems: "center",
    paddingVertical: 15,
  },
  propertiesEditorToolbar: {
    paddingVertical: 10,
    width: 330,
    justifyContent: "flex-start",
    flexDirection: "row",
    gap: 10,
  },
  undo: {
    // marginRight:"auto",
  },
  redo: {
    // marginRight:"auto",
  },
  plus: {
    marginLeft: "auto",
  },
});
