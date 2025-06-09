import * as React from "react";
// import { X } from "lucide-react-native";
import { View, TextInput, Text, StyleSheet } from "react-native";
import type {
  Properties,
  OnSetPropertyKey,
  OnSetPropertyValue,
  OnDeleteProperty,
} from "./PropertiesEditor";
import { PersonNodeData } from "@/utils/neo4jconnector";
import { MaterialCommunityIcons } from "@expo/vector-icons";

export function PropertyPairEditor({
  data,
  keyname,
  onSetPropertyKey,
  onSetPropertyValue,
  onDeleteProperty,
}: {
  data: PersonNodeData;
  keyname: string;
  onSetPropertyKey: OnSetPropertyKey;
  onSetPropertyValue: OnSetPropertyValue;
  onDeleteProperty: OnDeleteProperty;
}) {
  const [currentKey, setCurrentKey] = React.useState(keyname);
  const [currentValue, setCurrentValue] = React.useState(
    data.properties[keyname]
  );

  React.useEffect(() => {
    setCurrentKey(keyname);
    setCurrentValue(data.properties[keyname]);
  }, [keyname, data]);

  return (
    <View style={style.propertyPairEditor}>
      <TextInput
        style={style.propertyKeyInput}
        placeholder="[Key]"
        value={currentKey}
        onChangeText={(newKey) => {
          onSetPropertyKey(currentKey, newKey);
          setCurrentKey(newKey);
        }}
      ></TextInput>
      <TextInput
        style={style.middleColon}
        editable={false}
        value={":"}
      ></TextInput>
      <TextInput
        style={style.propertyValueInput}
        placeholder="[Value]"
        value={currentValue}
        onChangeText={(newValue) => {
          onSetPropertyValue(currentKey, newValue);
          setCurrentValue(newValue);
        }}
      ></TextInput>
      <MaterialCommunityIcons
        name="window-close"
        style={style.addProperyIcon}
        size={20}
        color="#666666"
        onPress={(e) => {
          onDeleteProperty(keyname);
        }}
      />
    </View>
  );
}

const style = StyleSheet.create({
  middleColon: {
    height: 50,
    fontSize: 15,
  },
  propertyPairEditor: {
    width: 330,
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: "#dedede",
    borderTopWidth: 2,
    borderTopColor: "#dedede",
    textAlign: "right",
    alignItems: "center",
  },
  propertyKeyInput: {
    flex: 1,
    height: 50,
    fontSize: 15,
    textAlign: "right",
  },
  propertyValueInput: {
    flex: 1,
    height: 50,
    fontSize: 15,
  },
  addProperyIcon: {
    marginLeft: "auto",
  },
});
