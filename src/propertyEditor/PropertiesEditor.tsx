import * as React from 'react';
import {View, StyleSheet} from 'react-native';
import {PropertyPairEditor} from './PropertyPairEditor';
import useUndo from '../lib/use-undo';
import {PersonNodeData} from '../neo4jconnector';

export interface Properties {
  [Key: string]: string | undefined;
}

export type OnChangeProperty = (
  oldProp: Properties,
  newProp: Properties,
) => void;

export type OnSetPropertyKey = (oldKey: string, newKey: string) => void;

export type OnSetPropertyValue = (key: string, newValue: string) => void;

export type OnDeleteProperty = (key: string) => void;

export function PropertiesEditor({
  data,
  onChangeProperty,
  onSetPropertyKey,
  onSetPropertyValue,
}: {
  data: PersonNodeData;
  onChangeProperty: OnChangeProperty;
  onSetPropertyKey: OnSetPropertyKey;
  onSetPropertyValue: OnSetPropertyValue;
}) {
  return (
    <View style={style.propertiesEditor}>
      {Object.keys(data.properties).map((k, i) => (
        <PropertyPairEditor
          key={`PropertyPairEditor-${i}`}
          data={data}
          keyname={k}
          onSetPropertyKey={(o, n) => {
            onSetPropertyKey(o, n);
            let tmpProp = Object.assign(data.properties, {});
            tmpProp[n] = tmpProp[o];
            delete tmpProp[o];
            onChangeProperty(data.properties, tmpProp);
          }}
          onSetPropertyValue={(k, v) => {
            onSetPropertyValue(k, v);
            let tmpProp = Object.assign(data.properties, {});
            tmpProp[k] = v;
            onChangeProperty(data.properties, tmpProp);
          }}
          onDeleteProperty={k => {
            let tmpProp = Object.assign(data.properties, {});
            delete tmpProp[k];
            onChangeProperty(data.properties, tmpProp);
          }}></PropertyPairEditor>
      ))}
    </View>
  );
}

const style = StyleSheet.create({
  propertiesEditor: {
    alignItems: 'center',
  },
});
