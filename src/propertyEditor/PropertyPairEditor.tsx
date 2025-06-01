import * as React from 'react';
import {View, TextInput,Text, StyleSheet} from 'react-native';
import type {
  Properties,
  OnSetPropertyKey,
  OnSetPropertyValue,
} from './PropertiesEditor';

export function PropertyPairEditor({
  properties,
  keyname,
  onSetPropertyKey,
  onSetPropertyValue,
}: {
  properties: Properties;
  keyname: string;
  onSetPropertyKey: OnSetPropertyKey;
  onSetPropertyValue: OnSetPropertyValue;
}) {
  const [currentKey, setCurrentKey] = React.useState(keyname);
  const [currentValue, setCurrentValue] = React.useState(properties[keyname]);
  return (
    <View style={style.propertyPairEditor}>
    <TextInput
      style={style.propertyKeyInput}
      placeholder="[Key]"
      value={currentKey}
      onChangeText={newKey => {
        onSetPropertyKey(currentKey, newKey);
        setCurrentKey(newKey);
      }}></TextInput>
    <TextInput style={style.middleColon} editable={false} value={":"}></TextInput>
    <TextInput
      style={style.propertyValueInput}
      placeholder="[Value]"
      value={currentValue}
      onChangeText={newValue => {
        onSetPropertyValue(currentKey, newValue);
        setCurrentValue(newValue);
      }}></TextInput>
    </View>
  );
}

const style = StyleSheet.create({
  middleColon:{
    height: 50,
    fontSize: 15,
  },
  propertyPairEditor: {
    width:330,
    flexDirection:"row",
    borderBottomWidth: 2,
    borderBottomColor: '#dedede',
    borderTopWidth: 2,
    borderTopColor: '#dedede',
    textAlign:"right",
  },
  propertyKeyInput: {
    flex:1,
    height: 50,
    fontSize: 15,
    textAlign:"right"
  },
  propertyValueInput: {
    flex:1,
    height: 50,
    fontSize: 15,
  },
});
