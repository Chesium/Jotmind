import * as React from 'react';
import {View, StyleSheet} from 'react-native';
import {PropertyPairEditor} from './PropertyPairEditor';

export interface Properties {
  [Key: string]: string | undefined;
}

export type OnChangeProperty = (
  oldProp: Properties,
  newProp: Properties,
) => void;

export type OnSetPropertyKey = (oldKey: string, newKey: string) => void;

export type OnSetPropertyValue = (key: string, newValue: string) => void;

export function PropertiesEditor({
  properties,
  onChangeProperty,
  onSetPropertyKey,
  onSetPropertyValue,
}: {
  properties: Properties;
  onChangeProperty: OnChangeProperty;
  onSetPropertyKey: OnSetPropertyKey;
  onSetPropertyValue: OnSetPropertyValue;
}) {
  return (
    <View style={style.propertiesEditor}>
      {Object.keys(properties).map((k, i) => (
        <PropertyPairEditor
          key={`PropertyPairEditor-${i}`}
          properties={properties}
          keyname={k}
          onSetPropertyKey={(o, n) => {
            onSetPropertyKey(o, n);
            let tmpProp = Object.assign(properties, {});
            tmpProp[n] = tmpProp[o];
            delete tmpProp[o];
            onChangeProperty(properties, tmpProp);
          }}
          onSetPropertyValue={(k, v) => {
            onSetPropertyValue(k, v);
            let tmpProp = Object.assign(properties, {});
            tmpProp[k] = v;
            onChangeProperty(properties, tmpProp);
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
